import "server-only";
import { and, count, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { agentConversations, agentMessages, agentTaskOutbox, agentTasks, campaign, getDb } from "@/db";
import { AGENT_INSTRUCTIONS, AGENT_RESPONSE_GUIDELINES } from "@/lib/agent-instructions";
import { getGeminiClient, GEMINI_MODEL, GEMINI_REQUEST_OPTIONS } from "@/lib/gemini";
import { selectSpecialistModel } from "@/lib/gemini-model-selection";
import { nextOccurrence, occurrenceKey, type RepeatRule } from "@/lib/repeat-rules";
import { resolveDependencyStatus } from "@/lib/task-state";
import { isTransientTaskError } from "@/lib/task-retry";
import { EXECUTION_HEARTBEAT_MS, EXECUTION_LEASE_MS, executionLeaseMatches } from "@/lib/task-recovery-policy";
import { isComputerEligible, HumanTakeoverActiveError } from "@/lib/computer-types";

export class TaskExecutionError extends Error {
  constructor(readonly category: string, readonly status?: number, options?: ErrorOptions) {
    super(category, options);
    this.name = "TaskExecutionError";
  }
  get transient() { return isTransientTaskError(this.category, this.status); }
}

export class TaskLeaseLostError extends Error {
  constructor() {
    super("task_execution_lease_lost");
    this.name = "TaskLeaseLostError";
  }
}

export async function loadAndClaimTask(taskId: unknown, eventScope: { authUserId?: unknown; assignedAgentId?: unknown }) {
  if (!Number.isSafeInteger(taskId) || (taskId as number) < 1) throw new TaskExecutionError("invalid_task_id");
  const db = getDb();
  const [task] = await db.select().from(agentTasks).innerJoin(campaign, and(
    eq(campaign.id, agentTasks.campaignId), eq(campaign.authUserId, agentTasks.authUserId),
  )).where(eq(agentTasks.id, taskId as number)).limit(1).then((rows) => rows.map(({ agent_tasks }) => agent_tasks));
  if (!task) throw new TaskExecutionError("task_not_found");
  if (eventScope.authUserId !== task.authUserId || eventScope.assignedAgentId !== task.assignedAgentId) throw new TaskExecutionError("event_scope_mismatch");
  // Receiving the event proves delivery even if the dispatcher crashed before recording it.
  await db.update(agentTaskOutbox).set({ status: "sent", dispatchClaimToken: null, lastError: null, updatedAt: new Date() })
    .where(and(eq(agentTaskOutbox.taskId, task.id), inArray(agentTaskOutbox.status, ["pending", "dispatching", "dead_letter"])));
  if (task.status !== "queued") return { claimed: false as const, reason: "stale_or_duplicate" };
  if (!Object.hasOwn(AGENT_INSTRUCTIONS, task.assignedAgentId)) {
    await db.update(agentTasks).set({ status: "failed", error: "invalid_assigned_agent", updatedAt: new Date() })
      .where(and(eq(agentTasks.id, task.id), eq(agentTasks.status, "queued")));
    return { claimed: false as const, reason: "invalid_assigned_agent" };
  }
  if (task.dependencies.length) {
    const prerequisites = await db.select({ id: agentTasks.id, status: agentTasks.status }).from(agentTasks).where(and(
      inArray(agentTasks.id, task.dependencies), eq(agentTasks.authUserId, task.authUserId), eq(agentTasks.campaignId, task.campaignId),
    ));
    const dependencyStatus = resolveDependencyStatus(task.dependencies, prerequisites);
    if (dependencyStatus !== "pending") {
      const terminal = dependencyStatus === "failed";
      await db.update(agentTasks).set({ status: terminal ? "failed" : "blocked", error: terminal ? "A required prerequisite failed." : null, updatedAt: new Date() })
        .where(and(eq(agentTasks.id, task.id), eq(agentTasks.status, "queued")));
      return { claimed: false as const, reason: terminal ? "prerequisite_failed" : "prerequisites_incomplete" };
    }
  }
  const leaseToken = randomUUID();
  const now = new Date();
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx.update(agentTasks).set({
      status: "running",
      executionLeaseToken: leaseToken,
      executionLeaseExpiresAt: new Date(now.getTime() + EXECUTION_LEASE_MS),
      updatedAt: now,
    })
      .where(and(eq(agentTasks.id, task.id), eq(agentTasks.status, "queued")))
      .returning({ id: agentTasks.id, executionLeaseToken: agentTasks.executionLeaseToken });
    return row;
  });
  if (!claimed) return { claimed: false as const, reason: "concurrent_claim" };
  if (!claimed.executionLeaseToken) throw new Error("execution_lease_token_missing_after_claim");
  return { claimed: true as const, taskId: task.id, leaseToken: claimed.executionLeaseToken };
}

export async function renewTaskExecutionLease(taskId: number, leaseToken: string, now = new Date()) {
  const db = getDb();
  const [renewed] = await db.update(agentTasks).set({
    executionLeaseExpiresAt: new Date(now.getTime() + EXECUTION_LEASE_MS),
    updatedAt: now,
  }).where(and(
    eq(agentTasks.id, taskId),
    eq(agentTasks.status, "running"),
    eq(agentTasks.executionLeaseToken, leaseToken),
  )).returning({ id: agentTasks.id });
  return Boolean(renewed);
}

export async function generateTaskResponse(taskId: number, leaseToken: string) {
  const db = getDb();
  const [task] = await db.select().from(agentTasks).where(and(
    eq(agentTasks.id, taskId),
    eq(agentTasks.status, "running"),
    eq(agentTasks.executionLeaseToken, leaseToken),
  )).limit(1);
  if (!task || !executionLeaseMatches(task.status, task.executionLeaseToken, leaseToken)) throw new TaskLeaseLostError();
  if (!await renewTaskExecutionLease(taskId, leaseToken)) throw new TaskLeaseLostError();
  const [campaignRow] = await db.select({ name: campaign.name }).from(campaign).where(and(eq(campaign.id, task.campaignId), eq(campaign.authUserId, task.authUserId))).limit(1);
  if (!campaignRow) throw new TaskExecutionError("campaign_scope_invalid");
  let dependencyContext = "";
  if (task.dependencies.length) {
    const rows = await db.select({ id: agentTasks.id, title: agentTasks.title, response: agentTasks.response, status: agentTasks.status }).from(agentTasks)
      .where(and(inArray(agentTasks.id, task.dependencies), eq(agentTasks.authUserId, task.authUserId), eq(agentTasks.campaignId, task.campaignId)));
    if (rows.length !== task.dependencies.length || rows.some((row) => row.status !== "completed")) throw new TaskExecutionError("prerequisites_incomplete");
    dependencyContext = rows.map((row) => `Task ${row.id} (${row.title}): ${row.response ?? ""}`).join("\n\n");
  }
  let heartbeatBusy = false;
  let leaseLost = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy || leaseLost) return;
    heartbeatBusy = true;
    try {
      leaseLost = !await renewTaskExecutionLease(taskId, leaseToken);
      if (!leaseLost && isComputerEligible(task.assignedAgentId)) {
        const { getActiveSandbox } = await import("./computer-registry.ts");
        const { renewSandboxTimeout } = await import("./computer-service.ts");
        const activeSbx = getActiveSandbox(task.campaignId, task.assignedAgentId);
        if (activeSbx) {
          await renewSandboxTimeout(activeSbx);
        }
      }
    } catch {
      // A transient heartbeat error does not fail the task. Persistence remains fenced by the token.
    } finally {
      heartbeatBusy = false;
    }
  }, EXECUTION_HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    let computerTaskRecordId: number | null = null;
    let computerRecordId: number | null = null;

    if (isComputerEligible(task.assignedAgentId)) {
      const { agentComputers, agentComputerTasks } = await import("@/db");
      const { getOrCreateComputerRecord } = await import("./computer-lifecycle.ts");

      const computerRecord = await getOrCreateComputerRecord(
        task.authUserId,
        task.campaignId,
        task.assignedAgentId as any,
      );
      computerRecordId = computerRecord.id;

      const [existingComputerTask] = await db
        .select({ id: agentComputerTasks.id })
        .from(agentComputerTasks)
        .where(
          and(
            eq(agentComputerTasks.computerId, computerRecord.id),
            eq(agentComputerTasks.taskId, task.id),
          ),
        )
        .limit(1);

      if (existingComputerTask) {
        computerTaskRecordId = existingComputerTask.id;
        await db
          .update(agentComputerTasks)
          .set({
            status: "active",
            currentStepIndex: 0,
            activityDescription: `Executing: ${task.title}`,
            updatedAt: new Date(),
          })
          .where(eq(agentComputerTasks.id, existingComputerTask.id));
      } else {
        const [insertedTask] = await db
          .insert(agentComputerTasks)
          .values({
            taskId: task.id,
            computerId: computerRecord.id,
            authUserId: task.authUserId,
            campaignId: task.campaignId,
            status: "active",
            currentStepIndex: 0,
            activityDescription: `Executing: ${task.title}`,
          })
          .returning({ id: agentComputerTasks.id });
        computerTaskRecordId = insertedTask?.id ?? null;
      }

      await db
        .update(agentComputers)
        .set({
          status: "running",
          activeTaskId: task.id,
          lastActiveAt: new Date(),
        })
        .where(eq(agentComputers.id, computerRecord.id));

      const { getActiveSandbox } = await import("./computer-registry.ts");
      const { reconnectSandboxService } = await import("./computer-service.ts");
      let sandbox: any = getActiveSandbox(task.campaignId, task.assignedAgentId);
      if (!sandbox && computerRecord.sandboxId && computerRecord.status === "running") {
        sandbox = (await reconnectSandboxService(task.authUserId, task.campaignId, task.assignedAgentId).catch(() => undefined)) ?? undefined;
      }
      if (!sandbox) {
        try {
          const { startComputerService } = await import("./computer-service.ts");
          await startComputerService(task.authUserId, task.assignedAgentId, task.campaignId);
          sandbox = getActiveSandbox(task.campaignId, task.assignedAgentId);
        } catch {
          sandbox = undefined;
        }
        if (!sandbox) {
          await db
            .update(agentComputers)
            .set({
              status: "stopped",
              activeTaskId: null,
              updatedAt: new Date(),
            })
            .where(eq(agentComputers.id, computerRecord.id));
        }
      }

      if (sandbox) {
        const {
          runComputerAgentLoop,
          getComputerLoopMaxSteps,
          getComputerLoopMaxDurationMs,
        } = await import("./computer-agent-loop.ts");
        const outcome = await runComputerAgentLoop(
          {
            authUserId: task.authUserId,
            campaignId: task.campaignId,
            agentId: task.assignedAgentId as any,
            taskId: task.id,
            computerId: computerRecord.id,
          },
          task.title,
          `${task.instructions}${dependencyContext ? `\nCompleted dependencies:\n${dependencyContext}` : ""}`,
          sandbox,
          {
            maxSteps: getComputerLoopMaxSteps(),
            maxDurationMs: getComputerLoopMaxDurationMs(),
          },
          {
            renewLease: async (id) => {
              const renewed = await renewTaskExecutionLease(id, leaseToken);
              if (sandbox) {
                const { renewSandboxTimeout } = await import("./computer-service.ts");
                await renewSandboxTimeout(sandbox);
              }
              return renewed;
            },
          },
        );

        if (leaseLost) throw new TaskLeaseLostError();

        if (outcome.outcome === "waiting_for_user") {
          if (computerTaskRecordId) {
            await db
              .update(agentComputerTasks)
              .set({
                status: "waiting_for_user",
                waitingReason: "Control yielded to human takeover",
                updatedAt: new Date(),
              })
              .where(eq(agentComputerTasks.id, computerTaskRecordId));
          }
          throw new HumanTakeoverActiveError("Control yielded to human takeover");
        }
        if (outcome.outcome === "error") {
          if (computerTaskRecordId) {
            await db
              .update(agentComputerTasks)
              .set({
                status: "failed",
                activityDescription: outcome.error || "Model provider error during computer execution",
                updatedAt: new Date(),
              })
              .where(eq(agentComputerTasks.id, computerTaskRecordId));
          }
          throw new TaskExecutionError("provider_error", undefined, {
            cause: new Error(outcome.error || outcome.result?.summary || "Provider error in computer loop"),
          });
        }
        if (outcome.outcome === "aborted") {
          if (computerTaskRecordId) {
            await db
              .update(agentComputerTasks)
              .set({ status: "aborted", updatedAt: new Date() })
              .where(eq(agentComputerTasks.id, computerTaskRecordId));
          }
          throw new TaskExecutionError("campaign_ended_abort");
        }
        if (outcome.outcome === "timed_out" || outcome.outcome === "step_limit_reached") {
          if (computerTaskRecordId) {
            await db
              .update(agentComputerTasks)
              .set({
                status: "completed",
                activityDescription: outcome.result?.summary ?? "Reached step/time limit with partial output",
                updatedAt: new Date(),
              })
              .where(eq(agentComputerTasks.id, computerTaskRecordId));
          }
        }

        if (computerTaskRecordId) {
          await db
            .update(agentComputerTasks)
            .set({
              status: "completed",
              activityDescription: outcome.result.summary,
              updatedAt: new Date(),
            })
            .where(eq(agentComputerTasks.id, computerTaskRecordId));
        }
        await db
          .update(agentComputers)
          .set({ activeTaskId: null, lastActiveAt: new Date() })
          .where(eq(agentComputers.id, computerRecord.id));

        const formattedResponse = [
          `**Computer Task Summary:** ${outcome.result.summary}`,
          `**Findings:** ${outcome.result.findings}`,
          outcome.result.artifacts.length > 0
            ? `**Generated Artifacts:**\n${outcome.result.artifacts.map((a) => `- ${a.filename} (${a.artifactType})`).join("\n")}`
            : "",
          `**Actions Executed:** ${outcome.result.actions.length} verified actions.`,
        ]
          .filter(Boolean)
          .join("\n\n");

        return formattedResponse;
      }
    }

    const modelToUse = selectSpecialistModel({
      agentId: task.assignedAgentId,
      defaultModel: GEMINI_MODEL,
      selectedSpecialistId: process.env.GEMINI_TEST_SPECIALIST_ID,
      testModel: process.env.GEMINI_TEST_SPECIALIST_MODEL,
      specialistIds: Object.keys(AGENT_INSTRUCTIONS),
    });

    const { getSpecialistToolDeclarations, executeSpecialistTool } = await import("./specialist-tools.ts");
    const { executeResilientGeminiLoop } = await import("./recovery/resilient-gemini.ts");
    const specialistTools = getSpecialistToolDeclarations(task.assignedAgentId);
    let response = "";

    const systemInstruction = `${AGENT_INSTRUCTIONS[task.assignedAgentId]} ${AGENT_RESPONSE_GUIDELINES}`;
    const initialPrompt = `This assignment comes from the Master Agent. Complete it for campaign ${campaignRow.name}.\nTask: ${task.title}\nInstructions: ${task.instructions}${dependencyContext ? `\nCompleted dependencies:\n${dependencyContext}` : ""}`;

    const loopResult = await executeResilientGeminiLoop({
      model: modelToUse,
      systemInstruction,
      initialPrompt,
      tools: specialistTools as unknown as any[],
      maxTurns: 5,
      perTurnTimeoutMs: 25_000,
      executeTool: async (name, args) => {
        if (leaseLost) throw new TaskLeaseLostError();
        const toolResult = await executeSpecialistTool(
          name,
          args,
          {
            authUserId: task.authUserId,
            campaignId: task.campaignId,
            taskId: task.id,
            agentId: task.assignedAgentId,
            computerId: computerRecordId,
          },
        );
        return {
          success: toolResult.success,
          output: toolResult.output,
          publicUrl: toolResult.publicUrl,
          data: toolResult.data,
        };
      },
    });

    if (leaseLost) throw new TaskLeaseLostError();
    response = loopResult.finalText;

    if (!response) throw new TaskExecutionError("empty_provider_response");

    if (computerTaskRecordId) {
      const { agentComputerTasks, agentComputers } = await import("@/db");
      await db
        .update(agentComputerTasks)
        .set({
          status: "completed",
          activityDescription: "Completed task instructions via specialist model",
          updatedAt: new Date(),
        })
        .where(eq(agentComputerTasks.id, computerTaskRecordId));
      if (computerRecordId) {
        await db
          .update(agentComputers)
          .set({ activeTaskId: null, lastActiveAt: new Date() })
          .where(eq(agentComputers.id, computerRecordId));
      }
    }

    return response;
  } catch (error) {
    if (error instanceof TaskExecutionError || error instanceof TaskLeaseLostError || error instanceof HumanTakeoverActiveError) throw error;
    const { classifyError } = await import("./recovery/error-classifier.ts");
    const classified = classifyError(error);
    throw new TaskExecutionError(classified.category, classified.httpStatus, { cause: error });
  } finally {
    clearInterval(heartbeat);
  }
}

export async function persistTaskSuccess(taskId: number, leaseToken: string, response: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(agentTasks).where(eq(agentTasks.id, taskId)).for("update").limit(1);
    const now = new Date();
    if (!task || !executionLeaseMatches(task.status, task.executionLeaseToken, leaseToken)
      || !task.executionLeaseExpiresAt || task.executionLeaseExpiresAt.getTime() <= now.getTime()) return null;
    const [conversation] = await tx.select({ id: agentConversations.id }).from(agentConversations).where(and(
      eq(agentConversations.authUserId, task.authUserId), eq(agentConversations.campaignId, task.campaignId), eq(agentConversations.agentId, task.assignedAgentId),
    )).limit(1);
    let conversationId = conversation?.id;
    if (!conversationId) {
      const [created] = await tx.insert(agentConversations).values({ authUserId: task.authUserId, campaignId: task.campaignId, agentId: task.assignedAgentId })
        .onConflictDoNothing().returning({ id: agentConversations.id });
      conversationId = created?.id;
      if (!conversationId) {
        const [raced] = await tx.select({ id: agentConversations.id }).from(agentConversations).where(and(
          eq(agentConversations.authUserId, task.authUserId), eq(agentConversations.campaignId, task.campaignId), eq(agentConversations.agentId, task.assignedAgentId),
        )).limit(1);
        conversationId = raced?.id;
      }
    }
    if (!conversationId) throw new Error("Unable to create specialist conversation");

    const { verifyTaskCompletionDeliverables } = await import("./recovery/task-checkpoint.ts");
    const { agentTaskArtifacts } = await import("@/db");
    const [artifactsCountRow] = await tx
      .select({ total: count() })
      .from(agentTaskArtifacts)
      .where(eq(agentTaskArtifacts.taskId, taskId));
    const artifactsCount = artifactsCountRow?.total ?? 0;
    const deliverableCheck = verifyTaskCompletionDeliverables(task.assignedAgentId, response, artifactsCount);
    if (!deliverableCheck.isDeliverableValid) {
      throw new TaskExecutionError("missing_deliverables", undefined, {
        cause: new Error(deliverableCheck.reason),
      });
    }

    const requestKey = `task:${task.id}`;
    await tx.insert(agentMessages).values([
      { conversationId, role: "master", content: `[Task ${task.id}] ${task.title}: ${task.instructions}`, requestKey },
      { conversationId, role: "assistant", content: response, requestKey },
    ]).onConflictDoNothing();
    await tx.update(agentConversations).set({ updatedAt: new Date() }).where(eq(agentConversations.id, conversationId));
    await tx.update(agentTasks).set({
      status: "completed", response, error: null, executionLeaseToken: null, executionLeaseExpiresAt: null, updatedAt: now,
    }).where(and(
      eq(agentTasks.id, taskId),
      eq(agentTasks.status, "running"),
      eq(agentTasks.executionLeaseToken, leaseToken),
    ));
    const { agentComputerTasks, agentComputers } = await import("@/db");
    await tx
      .update(agentComputerTasks)
      .set({ status: "completed", updatedAt: now })
      .where(
        and(
          eq(agentComputerTasks.taskId, taskId),
          inArray(agentComputerTasks.status, ["active", "waiting_for_user"]),
        ),
      );
    await tx
      .update(agentComputers)
      .set({ activeTaskId: null, lastActiveAt: now })
      .where(eq(agentComputers.activeTaskId, taskId));
    if (task.repeatRule && task.repeatSeriesId !== null) await createNextOccurrence(tx, task);
    const released = await releaseDependents(tx, task.authUserId, task.campaignId, new Date());
    try {
      const { checkAndTriggerMasterSynthesis } = await import("./master-agent-synthesis.ts");
      checkAndTriggerMasterSynthesis(taskId).catch((e) => console.error("Synthesis error:", e));
    } catch {}
    return released;
  });
}

async function releaseDependents(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], authUserId: string, campaignId: number, now: Date) {
  const released: number[] = [];
  let changed: boolean;
  do {
    changed = false;
    const blocked = await tx.select().from(agentTasks).where(and(eq(agentTasks.status, "blocked"), eq(agentTasks.authUserId, authUserId), eq(agentTasks.campaignId, campaignId)));
    for (const task of blocked) {
      const prerequisites = await tx.select({ id: agentTasks.id, status: agentTasks.status }).from(agentTasks).where(and(inArray(agentTasks.id, task.dependencies), eq(agentTasks.authUserId, authUserId), eq(agentTasks.campaignId, campaignId)));
      const dependencyStatus = resolveDependencyStatus(task.dependencies, prerequisites);
      if (dependencyStatus === "failed") {
        const result = await tx.update(agentTasks).set({ status: "failed", error: "A required prerequisite failed.", updatedAt: now }).where(and(eq(agentTasks.id, task.id), eq(agentTasks.status, "blocked"))).returning({ id: agentTasks.id });
        changed ||= result.length > 0;
      } else if (dependencyStatus === "pending") {
        const result = await tx.update(agentTasks).set({ status: "pending", updatedAt: now }).where(and(eq(agentTasks.id, task.id), eq(agentTasks.status, "blocked"))).returning({ id: agentTasks.id });
        if (result.length) { released.push(task.id); changed = true; }
      }
    }
  } while (changed && (await tx.select({ id: agentTasks.id }).from(agentTasks).where(and(eq(agentTasks.status, "blocked"), eq(agentTasks.authUserId, authUserId), eq(agentTasks.campaignId, campaignId)))).length > 0);
  return released;
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
async function createNextOccurrence(tx: Tx, task: typeof agentTasks.$inferSelect) {
  if (task.repeatSeriesId === null) throw new TaskExecutionError("repeat_series_missing");
  const rule = task.repeatRule as RepeatRule;
  if (rule.occurrences !== undefined) {
    const [seriesRows] = await tx.select({ total: count() }).from(agentTasks).where(eq(agentTasks.repeatSeriesId, task.repeatSeriesId));
    if ((seriesRows?.total ?? 0) >= rule.occurrences) {
      await tx.update(agentTasks).set({ nextRunAt: null, updatedAt: new Date() }).where(eq(agentTasks.id, task.repeatSeriesId));
      return;
    }
  }
  const nextAt = nextOccurrence(task.scheduledAt, rule);
  const key = occurrenceKey(task.repeatSeriesId, nextAt);
  await tx.update(agentTasks).set({ nextRunAt: nextAt, updatedAt: new Date() }).where(eq(agentTasks.id, task.repeatSeriesId));
  const prerequisites = task.dependencies.length
    ? await tx.select({ status: agentTasks.status }).from(agentTasks).where(and(inArray(agentTasks.id, task.dependencies), eq(agentTasks.authUserId, task.authUserId), eq(agentTasks.campaignId, task.campaignId)))
    : [];
  const ready = resolveDependencyStatus(task.dependencies, prerequisites) === "pending";
  await tx.insert(agentTasks).values({
    authUserId: task.authUserId,
    campaignId: task.campaignId,
    masterConversationId: task.masterConversationId,
    assignedAgentId: task.assignedAgentId,
    title: task.title,
    instructions: task.instructions,
    dependencies: task.dependencies,
    status: ready ? "pending" : "blocked",
    scheduledAt: nextAt,
    timeZone: rule.timeZone,
    repeatRule: rule,
    nextRunAt: null,
    repeatSeriesId: task.repeatSeriesId,
    occurrenceKey: key,
  }).onConflictDoNothing();
}

export async function persistTaskFailure(taskId: number, leaseToken: string, error: TaskExecutionError) {
  const { formatHumanReadableExplanation } = await import("./recovery/execution-logger.ts");
  const humanReason = formatHumanReadableExplanation(error.category, error.message);
  const safeError = `${humanReason}${error.status ? ` (HTTP ${error.status})` : ""}`;
  const db = getDb();
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(agentTasks).where(eq(agentTasks.id, taskId)).for("update").limit(1);
    const now = new Date();
    if (!task || !executionLeaseMatches(task.status, task.executionLeaseToken, leaseToken)
      || !task.executionLeaseExpiresAt || task.executionLeaseExpiresAt.getTime() <= now.getTime()) return false;
    await tx.update(agentTasks).set({
      status: "failed", error: safeError, executionLeaseToken: null, executionLeaseExpiresAt: null, updatedAt: now,
    }).where(and(
      eq(agentTasks.id, taskId),
      eq(agentTasks.status, "running"),
      eq(agentTasks.executionLeaseToken, leaseToken),
    ));
    const { agentComputerTasks, agentComputers } = await import("@/db");
    await tx
      .update(agentComputerTasks)
      .set({
        status: "failed",
        activityDescription: safeError,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentComputerTasks.taskId, taskId),
          inArray(agentComputerTasks.status, ["active", "waiting_for_user"]),
        ),
      );
    await tx
      .update(agentComputers)
      .set({
        status: "stopped",
        controlMode: "agent",
        activeTaskId: null,
        updatedAt: now,
      })
      .where(eq(agentComputers.activeTaskId, taskId));
    try {
      const { removeActiveSandbox } = await import("./computer-registry.ts");
      removeActiveSandbox(task.campaignId, task.assignedAgentId);
    } catch {}
    await releaseDependents(tx, task.authUserId, task.campaignId, new Date());
    try {
      const { checkAndTriggerMasterSynthesis } = await import("./master-agent-synthesis.ts");
      checkAndTriggerMasterSynthesis(taskId).catch((e) => console.error("Synthesis error:", e));
    } catch {}
    return true;
  });
}

export async function persistTaskWaitingForUser(taskId: number, leaseToken: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(agentTasks).where(eq(agentTasks.id, taskId)).for("update").limit(1);
    const now = new Date();
    if (!task || !executionLeaseMatches(task.status, task.executionLeaseToken, leaseToken)
      || !task.executionLeaseExpiresAt || task.executionLeaseExpiresAt.getTime() <= now.getTime()) return false;
    await tx.update(agentTasks).set({
      status: "waiting_for_user",
      executionLeaseToken: null,
      executionLeaseExpiresAt: null,
      updatedAt: now,
    }).where(and(
      eq(agentTasks.id, taskId),
      eq(agentTasks.status, "running"),
      eq(agentTasks.executionLeaseToken, leaseToken),
    ));
    const { agentComputerTasks, agentComputers } = await import("@/db");
    await tx
      .update(agentComputerTasks)
      .set({
        status: "waiting_for_user",
        waitingReason: "Control yielded to human takeover",
        updatedAt: now,
      })
      .where(
        and(
          eq(agentComputerTasks.taskId, taskId),
          eq(agentComputerTasks.status, "active"),
        ),
      );
    await tx
      .update(agentComputers)
      .set({ controlMode: "human", lastActiveAt: now })
      .where(eq(agentComputers.activeTaskId, taskId));
    return true;
  });
}
