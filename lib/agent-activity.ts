import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  agentComputers,
  agentComputerTasks,
  agentTaskArtifacts,
  agentTasks,
  campaign,
  getDb,
} from "@/db";
import { isComputerEligible } from "@/lib/computer-types";
import { AGENT_NAMES } from "@/lib/agent-instructions";

export type AgentExecutionStatus =
  | "idle"
  | "ready"
  | "queued"
  | "running"
  | "waiting_for_user"
  | "completed"
  | "failed";

export type AgentComputerStatus =
  | "running"
  | "paused"
  | "stopped"
  | "waiting"
  | "not_applicable";

export type AgentActivityData = {
  agentId: string;
  agentRole: string;
  agentName: string;
  executionStatus: AgentExecutionStatus;
  currentTask: {
    id: number;
    title: string;
    instructions: string;
    status: string;
    startedAt: string | null;
    elapsedMs: number | null;
  } | null;
  computerStatus: AgentComputerStatus;
  controlMode: "agent" | "human";
  artifactsCount: number;
  lastActiveAt: string | null;
};

export type CampaignActivityResponse = {
  campaignId: number;
  campaignStatus: string;
  agents: Record<string, AgentActivityData>;
};

const KNOWN_AGENT_ROLES: Record<string, { role: string; name: string }> = {
  "master-agent": { role: "Master Agent", name: "Master Agent" },
  "seat-1": { role: "Research Specialist", name: "Research Agent" },
  "seat-mvj4q0fn": { role: "Content Specialist", name: "Content Creator Agent" },
  "seat-mvj4q1b7": { role: "Scheduler Specialist", name: "Scheduler Agent" },
  "seat-mvj4q1mo": { role: "Analytics Specialist", name: "Analytics Agent" },
};

export async function getCampaignAgentsActivity(
  authUserId: string,
  campaignId: number,
): Promise<CampaignActivityResponse> {
  const db = getDb();

  // Validate campaign ownership
  const [camp] = await db
    .select({ id: campaign.id, status: campaign.status })
    .from(campaign)
    .where(and(eq(campaign.id, campaignId), eq(campaign.authUserId, authUserId)))
    .limit(1);

  if (!camp) {
    throw new Error("Campaign not found or access denied.");
  }

  // Fetch all tasks for this campaign
  const tasks = await db
    .select({
      id: agentTasks.id,
      assignedAgentId: agentTasks.assignedAgentId,
      title: agentTasks.title,
      instructions: agentTasks.instructions,
      status: agentTasks.status,
      createdAt: agentTasks.createdAt,
      updatedAt: agentTasks.updatedAt,
      dispatchClaimedAt: agentTasks.dispatchClaimedAt,
    })
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.campaignId, campaignId),
        eq(agentTasks.authUserId, authUserId),
      ),
    )
    .orderBy(desc(agentTasks.createdAt), desc(agentTasks.id));

  // Fetch computers for this campaign
  const computers = await db
    .select({
      id: agentComputers.id,
      agentId: agentComputers.agentId,
      status: agentComputers.status,
      controlMode: agentComputers.controlMode,
      activeTaskId: agentComputers.activeTaskId,
      lastActiveAt: agentComputers.lastActiveAt,
    })
    .from(agentComputers)
    .where(
      and(
        eq(agentComputers.campaignId, campaignId),
        eq(agentComputers.authUserId, authUserId),
      ),
    );

  const computerByAgentId = new Map(computers.map((c) => [c.agentId, c]));

  // Fetch verified artifacts count per computer / task
  const artifacts = await db
    .select({
      id: agentTaskArtifacts.id,
      taskId: agentTaskArtifacts.taskId,
      computerId: agentTaskArtifacts.computerId,
      isVerified: agentTaskArtifacts.isVerified,
    })
    .from(agentTaskArtifacts)
    .where(
      and(
        eq(agentTaskArtifacts.campaignId, campaignId),
        eq(agentTaskArtifacts.authUserId, authUserId),
        eq(agentTaskArtifacts.isVerified, true),
      ),
    );

  // Group tasks by assignedAgentId
  const tasksByAgent = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const list = tasksByAgent.get(t.assignedAgentId) ?? [];
    list.push(t);
    tasksByAgent.set(t.assignedAgentId, list);
  }

  const now = Date.now();
  const agentMap: Record<string, AgentActivityData> = {};

  const allAgentIds = [
    "master-agent",
    "seat-1",
    "seat-mvj4q0fn",
    "seat-mvj4q1b7",
    "seat-mvj4q1mo",
  ];

  for (const agentId of allAgentIds) {
    const meta = KNOWN_AGENT_ROLES[agentId] ?? {
      role: AGENT_NAMES[agentId] ?? agentId,
      name: AGENT_NAMES[agentId] ?? agentId,
    };

    if (agentId === "master-agent") {
      // Master agent execution status is derived from overall campaign state
      const hasRunningSpecialist = tasks.some((t) => t.status === "running");
      const hasQueuedSpecialist = tasks.some(
        (t) => t.status === "queued" || t.status === "pending" || t.status === "blocked",
      );
      const hasWaitingSpecialist = tasks.some(
        (t) => t.status === "waiting_for_user",
      );
      const allTasksCompleted =
        tasks.length > 0 && tasks.every((t) => t.status === "completed");
      const hasFailedSpecialist = tasks.some((t) => t.status === "failed");

      let masterStatus: AgentExecutionStatus = "ready";
      let masterTask: AgentActivityData["currentTask"] = null;

      if (hasWaitingSpecialist) {
        masterStatus = "waiting_for_user";
        const waitingTask = tasks.find((t) => t.status === "waiting_for_user");
        if (waitingTask) {
          masterTask = {
            id: waitingTask.id,
            title: `Team Waiting: ${waitingTask.title}`,
            instructions: waitingTask.instructions,
            status: "waiting_for_user",
            startedAt: waitingTask.updatedAt?.toISOString() ?? null,
            elapsedMs: waitingTask.updatedAt
              ? Math.max(0, now - waitingTask.updatedAt.getTime())
              : null,
          };
        }
      } else if (hasRunningSpecialist) {
        masterStatus = "running";
        const runningTask = tasks.find((t) => t.status === "running");
        if (runningTask) {
          masterTask = {
            id: runningTask.id,
            title: `Coordinating: ${runningTask.title}`,
            instructions: runningTask.instructions,
            status: "running",
            startedAt:
              runningTask.dispatchClaimedAt?.toISOString() ??
              runningTask.updatedAt?.toISOString() ??
              null,
            elapsedMs: runningTask.dispatchClaimedAt
              ? Math.max(0, now - runningTask.dispatchClaimedAt.getTime())
              : runningTask.updatedAt
              ? Math.max(0, now - runningTask.updatedAt.getTime())
              : null,
          };
        }
      } else if (hasQueuedSpecialist) {
        masterStatus = "queued";
        const queuedTask = tasks.find(
          (t) => t.status === "queued" || t.status === "pending" || t.status === "blocked",
        );
        if (queuedTask) {
          masterTask = {
            id: queuedTask.id,
            title: `Queued: ${queuedTask.title}`,
            instructions: queuedTask.instructions,
            status: queuedTask.status,
            startedAt: null,
            elapsedMs: null,
          };
        }
      } else if (allTasksCompleted) {
        masterStatus = "completed";
        const latestTask = tasks[0];
        if (latestTask) {
          masterTask = {
            id: latestTask.id,
            title: `Completed: ${latestTask.title}`,
            instructions: latestTask.instructions,
            status: "completed",
            startedAt: latestTask.dispatchClaimedAt?.toISOString() ?? latestTask.updatedAt?.toISOString() ?? null,
            elapsedMs: null,
          };
        }
      } else if (hasFailedSpecialist) {
        masterStatus = "failed";
        const failedTask = tasks.find((t) => t.status === "failed");
        if (failedTask) {
          masterTask = {
            id: failedTask.id,
            title: `Failed: ${failedTask.title}`,
            instructions: failedTask.instructions,
            status: "failed",
            startedAt: failedTask.updatedAt?.toISOString() ?? null,
            elapsedMs: null,
          };
        }
      }

      agentMap[agentId] = {
        agentId,
        agentRole: meta.role,
        agentName: meta.name,
        executionStatus: masterStatus,
        currentTask: masterTask,
        computerStatus: "not_applicable",
        controlMode: "agent",
        artifactsCount: 0,
        lastActiveAt: tasks[0]?.updatedAt?.toISOString() ?? null,
      };
      continue;
    }

    // Specialist agents
    const specialistTasks = tasksByAgent.get(agentId) ?? [];
    const isEligible = isComputerEligible(agentId);
    const computer = computerByAgentId.get(agentId);

    // Pick top-priority task
    const activeTask =
      specialistTasks.find((t) => t.status === "running") ??
      specialistTasks.find((t) => t.status === "waiting_for_user") ??
      specialistTasks.find(
        (t) => t.status === "queued" || t.status === "pending",
      ) ??
      specialistTasks.find((t) => t.status === "blocked") ??
      specialistTasks.find((t) => t.status === "failed") ??
      specialistTasks.find((t) => t.status === "completed") ??
      specialistTasks[0] ??
      null;

    let executionStatus: AgentExecutionStatus = "ready";
    let currentTask: AgentActivityData["currentTask"] = null;

    if (activeTask) {
      if (activeTask.status === "running") {
        executionStatus = "running";
      } else if (activeTask.status === "waiting_for_user") {
        executionStatus = "waiting_for_user";
      } else if (
        activeTask.status === "queued" ||
        activeTask.status === "pending" ||
        activeTask.status === "blocked"
      ) {
        executionStatus = "queued";
      } else if (activeTask.status === "failed") {
        executionStatus = "failed";
      } else if (activeTask.status === "completed") {
        executionStatus = "completed";
      }

      const startedAt =
        activeTask.dispatchClaimedAt?.toISOString() ??
        activeTask.updatedAt?.toISOString() ??
        null;
      const elapsedMs =
        executionStatus === "running" && activeTask.dispatchClaimedAt
          ? Math.max(0, now - activeTask.dispatchClaimedAt.getTime())
          : executionStatus === "running" && activeTask.updatedAt
          ? Math.max(0, now - activeTask.updatedAt.getTime())
          : null;

      currentTask = {
        id: activeTask.id,
        title: activeTask.title,
        instructions: activeTask.instructions,
        status: activeTask.status,
        startedAt,
        elapsedMs,
      };
    }

    // Computer status & artifact count
    let computerStatus: AgentComputerStatus = "not_applicable";
    let controlMode: "agent" | "human" = "agent";
    let artifactCount = 0;

    if (isEligible) {
      if (computer) {
        controlMode = (computer.controlMode as "agent" | "human") ?? "agent";
        if (computer.controlMode === "human") {
          computerStatus = "waiting";
          if (executionStatus !== "running") {
            executionStatus = "waiting_for_user";
          }
        } else if (computer.status === "running") {
          computerStatus = "running";
        } else if (computer.status === "paused") {
          computerStatus = "paused";
        } else {
          computerStatus = "stopped";
        }

        // Count artifacts for this computer or agent's tasks
        const agentTaskIds = new Set(specialistTasks.map((t) => t.id));
        artifactCount = artifacts.filter(
          (a) =>
            (a.computerId && a.computerId === computer.id) ||
            agentTaskIds.has(a.taskId),
        ).length;
      } else {
        computerStatus = "stopped";
        const agentTaskIds = new Set(specialistTasks.map((t) => t.id));
        artifactCount = artifacts.filter((a) =>
          agentTaskIds.has(a.taskId),
        ).length;
      }
    }

    agentMap[agentId] = {
      agentId,
      agentRole: meta.role,
      agentName: meta.name,
      executionStatus,
      currentTask,
      computerStatus,
      controlMode,
      artifactsCount: artifactCount,
      lastActiveAt: computer?.lastActiveAt?.toISOString() ?? activeTask?.updatedAt?.toISOString() ?? null,
    };
  }

  return {
    campaignId: camp.id,
    campaignStatus: camp.status,
    agents: agentMap,
  };
}

