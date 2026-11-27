import assert from "node:assert/strict";
import test from "node:test";
import { validateMasterPlan } from "../lib/master-agent-plan.ts";
import { nextOccurrence, occurrenceKey } from "../lib/repeat-rules.ts";
import { TASK_CONCURRENCY } from "../lib/inngest/task-concurrency.ts";
import { canTransition, resolveDependencyStatus } from "../lib/task-state.ts";
import { dispatchEventId, isDueForImmediateDispatch } from "../lib/dispatch-window.ts";
import { isTransientTaskError } from "../lib/task-retry.ts";

const agents = ["seat-1", "seat-mvj4q0fn", "seat-mvj4q1b7", "seat-mvj4q1mo"];

test("validates explicit future schedule timezone and repeat format", () => {
  const result = validateMasterPlan(JSON.stringify({ tasks: [{
    agentId: "seat-mvj4q1b7", title: "Prepare calendar", instructions: "Draft the schedule.", dependsOn: [],
    scheduledAt: "2026-10-28T09:00:00+05:30", timeZone: "Asia/Kolkata",
    repeatRule: { frequency: "weekly", interval: 1, timeZone: "Asia/Kolkata" },
  }] }), agents);
  assert.equal(result.ok, true);
  assert.equal(validateMasterPlan(JSON.stringify({ tasks: [{
    agentId: "seat-1", title: "Research", instructions: "Research topic.", dependsOn: [], scheduledAt: "2026-10-28T09:00:00Z",
  }] }), agents).ok, false);
});

test("releases blocked work only when every prerequisite completed", () => {
  assert.equal(resolveDependencyStatus([1, 2], [{ id: 1, status: "completed" }]), "blocked");
  assert.equal(resolveDependencyStatus([1, 2], [{ id: 1, status: "completed" }, { id: 2, status: "failed" }]), "failed");
  assert.equal(resolveDependencyStatus([1, 2], [{ id: 1, status: "completed" }, { id: 2, status: "completed" }]), "pending");
  assert.equal(canTransition("blocked", "queued"), false);
  assert.equal(canTransition("blocked", "pending"), true);
  assert.equal(canTransition("queued", "running"), true);
  assert.equal(canTransition("running", "queued"), true);
});

test("immediate dispatch window is shared at fifteen minutes", () => {
  const now = new Date("2026-10-27T00:00:00Z");
  assert.equal(isDueForImmediateDispatch(new Date(now.getTime() + 15 * 60_000), now), true);
  assert.equal(isDueForImmediateDispatch(new Date(now.getTime() + 15 * 60_000 + 1), now), false);
});

test("recurrence preserves local wall-clock time across daylight saving and keys occurrences deterministically", () => {
  const before = new Date("2026-03-07T14:30:00.000Z"); // 09:30 in New York before DST.
  const next = nextOccurrence(before, { frequency: "daily", interval: 1, timeZone: "America/New_York" });
  assert.equal(next.toISOString(), "2026-03-08T13:30:00.000Z"); // 09:30 after DST.
  assert.equal(occurrenceKey(42, next), "42:2026-03-08T13:30:00.000Z");
  assert.equal(occurrenceKey(42, next), occurrenceKey(42, new Date(next)));
});

test("Inngest enforces both keyed concurrency limits concurrently", () => {
  assert.deepEqual(TASK_CONCURRENCY, [
    { limit: 2, key: "event.data.authUserId", scope: "fn" },
    { limit: 50, key: "event.data.assignedAgentId", scope: "fn" },
  ]);
});

test("outbox retries keep a stable event ID and transient provider failures retry", () => {
  const outboxId = "9ef894a1-6c5a-4e9d-99ce-4322f9ce5610";
  assert.equal(dispatchEventId(outboxId), dispatchEventId(outboxId));
  assert.equal(isTransientTaskError("provider_unavailable", 503), true);
  assert.equal(isTransientTaskError("timeout"), true);
  assert.equal(isTransientTaskError("provider_access_denied", 403), false);
});
