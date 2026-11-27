import "server-only";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { agentTaskOutbox, agentTasks, campaign, getDb } from "@/db";
import { inngest } from "@/lib/inngest/client";
import { resolveDependencyStatus } from "@/lib/task-state";
import { DISPATCH_WINDOW_MS, dispatchEventId } from "@/lib/dispatch-window";
import { deliverClaimedOutbox, type OutboxDeliveryEvent } from "@/lib/outbox-delivery";
import {
  OUTBOX_DISPATCH_LEASE_MS,
  OUTBOX_MAX_ATTEMPTS,
  canManuallyRetryOutbox,
  outboxClaimAction,
  outboxRetryAt,
  safeOutboxError,
} from "@/lib/task-recovery-policy";

export const TASK_EXECUTION_EVENT = "soto/agent-task.execute";
const STALE_DISPATCH_CLAIM_MS = 5 * 60_000;

type TaskEvent = { taskId: number; authUserId: string; assignedAgentId: string; outboxId: string };
type ClaimedOutboxEvent = OutboxDeliveryEvent;

/** Claims and records delivery intent in one Neon transaction. Both cron and immediate dispatch use this. */
export async function claimDueTasks(now = new Date(), requestedIds?: number[]) {
  const db = getDb();
  const until = new Date(now.getTime() + DISPATCH_WINDOW_MS);
  return db.transaction(async (tx) => {
    let changed: boolean;
    do {
      changed = false;
      const blocked = await tx.select().from(agentTasks).where(eq(agentTasks.status, "blocked"));
      for (const task of blocked) {
        const prerequisites = task.dependencies.length
          ? await tx.select({ id: agentTasks.id, status: agentTasks.status }).from(agentTasks).where(and(inArray(agentTasks.id, task.dependencies), eq(agentTasks.authUserId, task.authUserId), eq(agentTasks.campaignId, task.campaignId)))
          : [];
        const status = resolveDependencyStatus(task.dependencies, prerequisites);
        if (status === "failed") {
          const updated = await tx.update(agentTasks).set({ status: "failed", error: "A required prerequisite failed.", updatedAt: now })
            .where(and(eq(agentTasks.id, task.id), eq(agentTasks.status, "blocked"))).returning({ id: agentTasks.id });
          changed ||= updated.length > 0;
        } else if (status === "pending") {
          const updated = await tx.update(agentTasks).set({ status: "pending", updatedAt: now })
            .where(and(eq(agentTasks.id, task.id), eq(agentTasks.status, "blocked"))).returning({ id: agentTasks.id });
          changed ||= updated.length > 0;
        }
      }
    } while (changed);

    const selected = await tx.select({ id: agentTasks.id }).from(agentTasks)
      .innerJoin(campaign, and(eq(campaign.id, agentTasks.campaignId), eq(campaign.authUserId, agentTasks.authUserId)))
      .where(and(
        eq(agentTasks.status, "pending"),
        lte(agentTasks.scheduledAt, until),
        requestedIds ? inArray(agentTasks.id, requestedIds) : sql`true`,
        sql`NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${agentTasks.dependencies}) AS dependency_id(value)
          LEFT JOIN agent_tasks prerequisite ON prerequisite.id = dependency_id.value::integer
            AND prerequisite.auth_user_id = ${agentTasks.authUserId}
            AND prerequisite.campaign_id = ${agentTasks.campaignId}
          WHERE prerequisite.id IS NULL OR prerequisite.status <> 'completed'
        )`,
      )).for("update", { skipLocked: true }).limit(100);
    const ids = selected.map((row) => row.id);
    if (!ids.length) return [] as TaskEvent[];

    const claimed = await tx.update(agentTasks).set({ status: "queued", dispatchClaimedAt: now, updatedAt: now })
      .where(and(inArray(agentTasks.id, ids), eq(agentTasks.status, "pending")))
      .returning({ id: agentTasks.id, authUserId: agentTasks.authUserId, assignedAgentId: agentTasks.assignedAgentId });
    const events: TaskEvent[] = [];
    for (const task of claimed) {
      const outboxId = randomUUID();
      await tx.insert(agentTaskOutbox).values({ id: outboxId, taskId: task.id, status: "pending", nextAttemptAt: now });
      events.push({ taskId: task.id, authUserId: task.authUserId, assignedAgentId: task.assignedAgentId, outboxId });
    }
    return events;
  });
}

/** Expired executions are re-queued, never failed. The token fences any worker that wakes later. */
async function recoverExpiredExecutions(now: Date) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const expired = await tx.select({ id: agentTasks.id })
      .from(agentTasks)
      .where(and(eq(agentTasks.status, "running"), lte(agentTasks.executionLeaseExpiresAt!, now)))
      .for("update", { skipLocked: true })
      .limit(100);
    let recovered = 0;
    for (const { id } of expired) {
      const [task] = await tx.update(agentTasks).set({
        status: "queued",
        executionLeaseToken: null,
        executionLeaseExpiresAt: null,
        dispatchClaimedAt: now,
        updatedAt: now,
      }).where(and(
        eq(agentTasks.id, id),
        eq(agentTasks.status, "running"),
        lte(agentTasks.executionLeaseExpiresAt!, now),
      )).returning({ id: agentTasks.id, authUserId: agentTasks.authUserId, assignedAgentId: agentTasks.assignedAgentId });
      if (!task) continue;
      await tx.insert(agentTaskOutbox).values({ taskId: task.id, status: "pending", nextAttemptAt: now })
        .onConflictDoNothing();
      recovered++;
    }
    return recovered;
  });
}

/** Reissues a queued task if its previous event was accepted but never claimed. */
async function recoverStaleQueuedDispatches(now: Date) {
  const db = getDb();
  const staleBefore = new Date(now.getTime() - STALE_DISPATCH_CLAIM_MS);
  return db.transaction(async (tx) => {
    const stale = await tx.select({ id: agentTasks.id })
      .from(agentTasks)
      .where(and(eq(agentTasks.status, "queued"), lte(agentTasks.dispatchClaimedAt!, staleBefore)))
      .for("update", { skipLocked: true })
      .limit(100);
    let recovered = 0;
    for (const { id } of stale) {
      const [task] = await tx.select({ id: agentTasks.id, authUserId: agentTasks.authUserId, assignedAgentId: agentTasks.assignedAgentId })
        .from(agentTasks).where(and(eq(agentTasks.id, id), eq(agentTasks.status, "queued"))).limit(1);
      if (!task) continue;
      await tx.insert(agentTaskOutbox).values({ taskId: task.id, status: "pending", nextAttemptAt: now }).onConflictDoNothing();
      await tx.update(agentTasks).set({ dispatchClaimedAt: now, updatedAt: now })
        .where(and(eq(agentTasks.id, task.id), eq(agentTasks.status, "queued")));
      recovered++;
    }
    return recovered;
  });
}

/** Claims delivery rows with row locks before making a network call. */
async function claimOutboxEvents(now: Date): Promise<{ events: ClaimedOutboxEvent[]; deadLetteredIds: string[] }> {
  const db = getDb();
  const dispatchExpiredBefore = new Date(now.getTime() - OUTBOX_DISPATCH_LEASE_MS);
  return db.transaction(async (tx) => {
    const candidates = await tx.select({
      outboxId: agentTaskOutbox.id,
      taskId: agentTaskOutbox.taskId,
      status: agentTaskOutbox.status,
      attempts: agentTaskOutbox.attempts,
      updatedAt: agentTaskOutbox.updatedAt,
      nextAttemptAt: agentTaskOutbox.nextAttemptAt,
      dispatchClaimToken: agentTaskOutbox.dispatchClaimToken,
      authUserId: agentTasks.authUserId,
      assignedAgentId: agentTasks.assignedAgentId,
    }).from(agentTaskOutbox).innerJoin(agentTasks, eq(agentTasks.id, agentTaskOutbox.taskId))
      .where(and(
        eq(agentTasks.status, "queued"),
        or(
          and(eq(agentTaskOutbox.status, "pending"), lte(agentTaskOutbox.nextAttemptAt, now)),
          and(eq(agentTaskOutbox.status, "dispatching"), lte(agentTaskOutbox.updatedAt, dispatchExpiredBefore)),
        ),
      )).for("update", { of: agentTaskOutbox, skipLocked: true }).limit(100);

    const claimed: ClaimedOutboxEvent[] = [];
    const deadLetteredIds: string[] = [];
    for (const candidate of candidates) {
      const action = outboxClaimAction(candidate, now);
      if (action === "wait") continue;
      if (action === "dead_letter") {
        const [deadLettered] = await tx.update(agentTaskOutbox).set({
          status: "dead_letter",
          dispatchClaimToken: null,
          lastError: candidate.status === "dispatching" ? "Dispatch claim expired after retry limit." : "Retry limit reached.",
          updatedAt: now,
        }).where(and(eq(agentTaskOutbox.id, candidate.outboxId), eq(agentTaskOutbox.status, candidate.status)))
          .returning({ id: agentTaskOutbox.id });
        if (deadLettered) deadLetteredIds.push(candidate.outboxId);
        continue;
      }

      const claimToken = randomUUID();
      const [row] = await tx.update(agentTaskOutbox).set({
        status: "dispatching",
        attempts: candidate.attempts + 1,
        dispatchClaimToken: claimToken,
        updatedAt: now,
      }).where(and(eq(agentTaskOutbox.id, candidate.outboxId), eq(agentTaskOutbox.status, candidate.status)))
        .returning({ id: agentTaskOutbox.id });
      if (!row) continue;
      claimed.push({
        taskId: candidate.taskId,
        authUserId: candidate.authUserId,
        assignedAgentId: candidate.assignedAgentId,
        outboxId: candidate.outboxId,
        claimToken,
        attempts: candidate.attempts + 1,
      });
    }
    return { events: claimed, deadLetteredIds };
  });
}

export async function dispatchTaskIds(taskIds: number[]) {
  if (!taskIds.length) return;
  return runDispatchCycle(taskIds);
}

export async function dispatchScheduledTasks() {
  return runDispatchCycle();
}

/** Creates fresh delivery intent only for an operator-reviewed dead letter whose task remains queued. */
export async function retryDeadLetterOutbox(outboxId: string) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx.select({
      outboxStatus: agentTaskOutbox.status,
      taskId: agentTaskOutbox.taskId,
      taskStatus: agentTasks.status,
    }).from(agentTaskOutbox).innerJoin(agentTasks, eq(agentTasks.id, agentTaskOutbox.taskId))
      .where(eq(agentTaskOutbox.id, outboxId)).for("update", { skipLocked: true }).limit(1);
    if (!row || !canManuallyRetryOutbox(row.outboxStatus, row.taskStatus)) return null;
    const [created] = await tx.insert(agentTaskOutbox).values({
      taskId: row.taskId,
      status: "pending",
      nextAttemptAt: new Date(),
    }).onConflictDoNothing().returning({ id: agentTaskOutbox.id });
    return created?.id ?? null;
  });
}

async function runDispatchCycle(requestedIds?: number[]) {
  const db = getDb();
  const now = new Date();
  const recoveredExecutions = await recoverExpiredExecutions(now);
  const recoveredQueued = await recoverStaleQueuedDispatches(now);
  const newlyClaimed = await claimDueTasks(now, requestedIds);
  const outboxClaim = await claimOutboxEvents(now);
  for (const outboxId of outboxClaim.deadLetteredIds) {
    console.error(JSON.stringify({ event: "agent_task_outbox_dead_lettered", outboxId }));
  }
  const delivery = await deliverClaimedOutbox(outboxClaim.events, {
    eventName: TASK_EXECUTION_EVENT,
    eventId: dispatchEventId,
    maxAttempts: OUTBOX_MAX_ATTEMPTS,
    retryAt: outboxRetryAt,
    safeError: safeOutboxError,
    send: (event) => inngest.send(event),
    markSent: async (event) => {
      await db.update(agentTaskOutbox).set({ status: "sent", dispatchClaimToken: null, lastError: null, updatedAt: new Date() })
        .where(and(
          eq(agentTaskOutbox.id, event.outboxId),
          eq(agentTaskOutbox.status, "dispatching"),
          eq(agentTaskOutbox.dispatchClaimToken, event.claimToken),
        ));
    },
    markFailed: async (event, failure) => {
      await db.update(agentTaskOutbox).set({
        status: failure.deadLettered ? "dead_letter" : "pending",
        nextAttemptAt: failure.retryAt,
        dispatchClaimToken: null,
        lastError: failure.safeError,
        updatedAt: new Date(),
      }).where(and(
        eq(agentTaskOutbox.id, event.outboxId),
        eq(agentTaskOutbox.status, "dispatching"),
        eq(agentTaskOutbox.dispatchClaimToken, event.claimToken),
      ));
    },
  });
  for (const failure of delivery.failed) {
    if (failure.deadLettered) {
      console.error(JSON.stringify({ event: "agent_task_outbox_dead_lettered", outboxId: failure.outboxId }));
    }
  }
  if (delivery.failed.length) throw new Error(`Outbox delivery failed for ${delivery.failed.length} task event(s).`);
  return {
    recoveredExecutions,
    recoveredQueued,
    dispatched: outboxClaim.events.length,
    newlyClaimed: newlyClaimed.length,
  };
}
