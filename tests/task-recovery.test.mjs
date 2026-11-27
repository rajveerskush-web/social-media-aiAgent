import assert from "node:assert/strict";
import test from "node:test";
import { dispatchEventId } from "../lib/dispatch-window.ts";
import {
  EXECUTION_LEASE_MS,
  OUTBOX_DISPATCH_LEASE_MS,
  OUTBOX_MAX_ATTEMPTS,
  canManuallyRetryOutbox,
  executionLeaseExpired,
  executionLeaseMatches,
  outboxClaimAction,
  outboxRetryAt,
  outboxRetryDelayMs,
} from "../lib/task-recovery-policy.ts";
import { deliverClaimedOutbox } from "../lib/outbox-delivery.ts";

const now = new Date("2026-10-27T12:00:00.000Z");
const sampleEvent = (overrides = {}) => ({
  taskId: 21,
  authUserId: "00000000-0000-0000-0000-000000000021",
  assignedAgentId: "specialist-a",
  outboxId: "00000000-0000-0000-0000-000000000121",
  claimToken: "claim-1",
  attempts: 1,
  ...overrides,
});

test("lease recovery waits for active leases and fences expired workers", () => {
  assert.equal(executionLeaseExpired(new Date(now.getTime() + 1), now), false);
  assert.equal(executionLeaseExpired(now, now), true);
  assert.equal(executionLeaseExpired(null, now), false);
  assert.equal(executionLeaseMatches("running", "lease-current", "lease-current"), true);
  assert.equal(executionLeaseMatches("running", "lease-new", "lease-old"), false);
  assert.equal(executionLeaseMatches("queued", "lease-current", "lease-current"), false);
  assert.ok(EXECUTION_LEASE_MS > 0);
});

test("outbox claims are exclusive under concurrent dispatchers", async () => {
  const row = { status: "pending", attempts: 0, nextAttemptAt: now, updatedAt: now, dispatchClaimToken: null };
  let lock = Promise.resolve();
  const claim = async (token) => {
    let unlock;
    const previous = lock;
    lock = new Promise((resolve) => { unlock = resolve; });
    await previous;
    try {
      const action = outboxClaimAction(row, now);
      if (action !== "claim") return null;
      row.status = "dispatching";
      row.attempts++;
      row.dispatchClaimToken = token;
      row.updatedAt = now;
      return sampleEvent({ claimToken: token, attempts: row.attempts });
    } finally {
      unlock();
    }
  };

  const claimed = await Promise.all([claim("dispatch-a"), claim("dispatch-b")]);
  assert.equal(claimed.filter(Boolean).length, 1);
  assert.equal(row.attempts, 1);
  assert.equal(row.status, "dispatching");

  const winner = claimed.find(Boolean);
  const sent = [];
  await deliverClaimedOutbox([winner], {
    eventName: "soto/agent-task.execute",
    eventId: dispatchEventId,
    maxAttempts: OUTBOX_MAX_ATTEMPTS,
    retryAt: outboxRetryAt,
    safeError: (error) => error.name,
    send: async ({ id }) => sent.push(id),
    markSent: async () => {},
    markFailed: async () => assert.fail("successful dispatch cannot be marked failed"),
  });
  assert.deepEqual(sent, [dispatchEventId(winner.outboxId)]);
});

test("pending outbox retries use exponential backoff and reclaim stale dispatch claims", () => {
  assert.equal(outboxRetryDelayMs(1), 30_000);
  assert.equal(outboxRetryDelayMs(2), 60_000);
  assert.ok(outboxRetryDelayMs(99) <= 60 * 60_000);
  assert.equal(outboxRetryAt(2, now).getTime(), now.getTime() + 60_000);

  const waiting = { status: "pending", attempts: 2, nextAttemptAt: new Date(now.getTime() + 1), updatedAt: now, dispatchClaimToken: null };
  assert.equal(outboxClaimAction(waiting, now), "wait");
  const due = { ...waiting, nextAttemptAt: now };
  assert.equal(outboxClaimAction(due, now), "claim");
  const staleDispatch = { ...due, status: "dispatching", updatedAt: new Date(now.getTime() - OUTBOX_DISPATCH_LEASE_MS - 1) };
  assert.equal(outboxClaimAction(staleDispatch, now), "claim");
});

test("ambiguous accepted delivery retries with the same stable Inngest event ID", async () => {
  const deliveredIds = [];
  const failures = [];
  let sendCount = 0;
  const event = sampleEvent();
  const deps = {
    eventName: "soto/agent-task.execute",
    eventId: dispatchEventId,
    maxAttempts: OUTBOX_MAX_ATTEMPTS,
    retryAt: outboxRetryAt,
    safeError: (error) => `${error.name}:${error.code}`,
    now: () => now,
    send: async (payload) => {
      deliveredIds.push(payload.id);
      sendCount++;
      if (sendCount === 1) throw Object.assign(new Error("response lost"), { name: "FetchError", code: "ECONNRESET" });
    },
    markSent: async () => {},
    markFailed: async (row, data) => failures.push({ row, data }),
  };

  const first = await deliverClaimedOutbox([event], deps);
  assert.deepEqual(first.failed, [{ outboxId: event.outboxId, deadLettered: false }]);
  assert.equal(failures[0].data.safeError, "FetchError:ECONNRESET");
  assert.equal(failures[0].data.retryAt.getTime(), now.getTime() + 30_000);

  const second = await deliverClaimedOutbox([sampleEvent({ claimToken: "claim-2", attempts: 2 })], deps);
  assert.deepEqual(second.sent, [event.outboxId]);
  assert.equal(deliveredIds.length, 2);
  assert.equal(deliveredIds[0], dispatchEventId(event.outboxId));
  assert.equal(deliveredIds[1], deliveredIds[0]);
});

test("retry exhaustion leaves a visible dead letter; replay only applies to queued tasks", async () => {
  const failures = [];
  const event = sampleEvent({ attempts: OUTBOX_MAX_ATTEMPTS });
  const result = await deliverClaimedOutbox([event], {
    eventName: "soto/agent-task.execute",
    eventId: dispatchEventId,
    maxAttempts: OUTBOX_MAX_ATTEMPTS,
    retryAt: outboxRetryAt,
    safeError: (error) => error.name,
    now: () => now,
    send: async () => { throw Object.assign(new Error("unavailable"), { name: "FetchError" }); },
    markSent: async () => assert.fail("failed delivery cannot be marked sent"),
    markFailed: async (_row, details) => failures.push(details),
  });
  assert.deepEqual(result.failed, [{ outboxId: event.outboxId, deadLettered: true }]);
  assert.equal(failures[0].deadLettered, true);
  assert.ok(failures[0].safeError);
  assert.equal(canManuallyRetryOutbox("dead_letter", "queued"), true);
  assert.equal(canManuallyRetryOutbox("dead_letter", "running"), false);
  assert.equal(canManuallyRetryOutbox("dead_letter", "completed"), false);
  assert.equal(canManuallyRetryOutbox("pending", "queued"), false);
});
