/**
 * SOTO AI — Task Checkpointing & Idempotent Artifact Management Layer
 *
 * Persists intermediate execution progress, enables seamless resumption
 * without repeating completed steps, and guarantees zero duplicate artifacts or drafts.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, agentTasks, agentTaskArtifacts, agentComputerTasks, agentComputerCheckpoints } from "../../db/index.ts";

export type TaskCheckpointData = {
  taskId: number;
  stepIndex: number;
  completedTools: string[];
  partialOutput?: string;
  savedArtifactIds: number[];
  updatedAt: string;
};

/**
 * Checks if an artifact with the exact same filename or hash already exists for this task.
 * Prevents duplicate ImageKit uploads and duplicate DB records on retry.
 */
export async function findExistingArtifact(
  taskId: number,
  filename: string,
): Promise<{
  id: number;
  filename: string;
  imagekitUrl: string | null;
  sandboxPath: string | null;
  isVerified: boolean;
} | null> {
  const db = getDb();
  const [existing] = await db
    .select({
      id: agentTaskArtifacts.id,
      filename: agentTaskArtifacts.filename,
      imagekitUrl: agentTaskArtifacts.imagekitUrl,
      sandboxPath: agentTaskArtifacts.sandboxPath,
      isVerified: agentTaskArtifacts.isVerified,
    })
    .from(agentTaskArtifacts)
    .where(
      and(
        eq(agentTaskArtifacts.taskId, taskId),
        eq(agentTaskArtifacts.filename, filename),
      ),
    )
    .limit(1);

  return existing ?? null;
}

/**
 * Loads the latest checkpoint for an active task.
 */
export async function loadLatestTaskCheckpoint(taskId: number): Promise<TaskCheckpointData | null> {
  try {
    const db = getDb();

    // Check computer checkpoints if computer task exists
    const [cTask] = await db
      .select({ id: agentComputerTasks.id, currentStepIndex: agentComputerTasks.currentStepIndex, activityDescription: agentComputerTasks.activityDescription })
      .from(agentComputerTasks)
      .where(eq(agentComputerTasks.taskId, taskId))
      .limit(1);

    if (cTask) {
      const [latestCheckpoint] = await db
        .select({
          stepIndex: agentComputerCheckpoints.stepIndex,
          actionsLog: agentComputerCheckpoints.actionsLog,
          createdAt: agentComputerCheckpoints.createdAt,
        })
        .from(agentComputerCheckpoints)
        .where(eq(agentComputerCheckpoints.computerTaskId, cTask.id))
        .orderBy(sql`${agentComputerCheckpoints.stepIndex} DESC`)
        .limit(1);

      const artifacts = await db
        .select({ id: agentTaskArtifacts.id })
        .from(agentTaskArtifacts)
        .where(eq(agentTaskArtifacts.taskId, taskId));

      if (latestCheckpoint) {
        return {
          taskId,
          stepIndex: latestCheckpoint.stepIndex,
          completedTools: (latestCheckpoint.actionsLog || []).map((a) => a.tool),
          partialOutput: cTask.activityDescription ?? undefined,
          savedArtifactIds: artifacts.map((a) => a.id),
          updatedAt: latestCheckpoint.createdAt.toISOString(),
        };
      }
    }

    return null;
  } catch (err: unknown) {
    console.error("[task-checkpoint] Error loading checkpoint for task", taskId, err);
    return null;
  }
}

/**
 * Saves a progress checkpoint for any agent task.
 */
export async function saveTaskCheckpoint(
  taskId: number,
  computerId: number | null,
  stepIndex: number,
  actionsLog: Array<{
    tool: string;
    params: Record<string, unknown>;
    attempted: boolean;
    verified: boolean;
    resultSummary: string;
    timestamp: string;
  }>,
  partialOutput?: string,
): Promise<void> {
  try {
    const db = getDb();
    if (!computerId) return;

    // Ensure computer task row exists
    const [existing] = await db
      .select({ id: agentComputerTasks.id })
      .from(agentComputerTasks)
      .where(
        and(
          eq(agentComputerTasks.computerId, computerId),
          eq(agentComputerTasks.taskId, taskId),
        ),
      )
      .limit(1);

    let computerTaskId = existing?.id;
    if (!computerTaskId) {
      const [taskRow] = await db
        .select({ authUserId: agentTasks.authUserId, campaignId: agentTasks.campaignId, title: agentTasks.title })
        .from(agentTasks)
        .where(eq(agentTasks.id, taskId))
        .limit(1);

      if (taskRow) {
        const [inserted] = await db
          .insert(agentComputerTasks)
          .values({
            taskId,
            computerId,
            authUserId: taskRow.authUserId,
            campaignId: taskRow.campaignId,
            status: "active",
            currentStepIndex: stepIndex,
            activityDescription: partialOutput ?? `Executing step ${stepIndex}`,
          })
          .returning({ id: agentComputerTasks.id });
        computerTaskId = inserted?.id;
      }
    } else {
      await db
        .update(agentComputerTasks)
        .set({
          currentStepIndex: stepIndex,
          activityDescription: partialOutput ?? `Executing step ${stepIndex}`,
          updatedAt: new Date(),
        })
        .where(eq(agentComputerTasks.id, computerTaskId));
    }

    if (computerTaskId) {
      await db
        .insert(agentComputerCheckpoints)
        .values({
          computerTaskId,
          stepIndex,
          messages: [],
          actionsLog,
        })
        .onConflictDoNothing();
    }
  } catch (err: unknown) {
    console.error("[task-checkpoint] Failed to persist task checkpoint:", err);
  }
}

/**
 * Verifies that a task produced its required outputs before marking as completed.
 */
export function verifyTaskCompletionDeliverables(
  assignedAgentId: string,
  response: string,
  artifactsCount: number,
): { isDeliverableValid: boolean; reason?: string } {
  const trimmed = response.trim();

  // Research Agent should have substantial text or report artifact
  if (assignedAgentId === "seat-1" && trimmed.length < 30 && artifactsCount === 0) {
    return {
      isDeliverableValid: false,
      reason: "Research Agent task completed without findings, source citations, or research report artifact.",
    };
  }

  // Content Creator should have creative copy or media
  if (assignedAgentId === "seat-mvj4q0fn" && trimmed.length < 20 && artifactsCount === 0) {
    return {
      isDeliverableValid: false,
      reason: "Content Creator task completed without copy, hashtags, or visual deliverables.",
    };
  }

  // Scheduler should have calendar schedule details
  if (assignedAgentId === "seat-mvj4q1b7" && trimmed.length < 20) {
    return {
      isDeliverableValid: false,
      reason: "Scheduler task completed without calendar schedule or timeline details.",
    };
  }

  // Analytics should have performance analysis or KPI recommendations
  if (assignedAgentId === "seat-mvj4q1mo" && trimmed.length < 20) {
    return {
      isDeliverableValid: false,
      reason: "Analytics task completed without performance analysis or KPI recommendations.",
    };
  }

  if (trimmed.length === 0 && artifactsCount === 0) {
    return {
      isDeliverableValid: false,
      reason: "Task completed with empty response and zero verified artifacts.",
    };
  }

  return { isDeliverableValid: true };
}
