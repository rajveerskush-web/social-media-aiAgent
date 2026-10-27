import assert from "node:assert/strict";
import test from "node:test";
import { describeInvalidMasterPlan, hasDelegationClaim, summarizeTaskStatuses, validateMasterPlan } from "../lib/master-agent-plan.ts";

const agentIds = ["seat-1", "seat-mvj4q0fn", "seat-mvj4q1b7", "seat-mvj4q1mo"];

test("accepts exact specialist IDs and earlier-task dependencies", () => {
  const result = validateMasterPlan(JSON.stringify({
    tasks: [
      { agentId: "seat-1", title: "Research themes", instructions: "Identify relevant audience themes.", dependsOn: [] },
      { agentId: "seat-mvj4q0fn", title: "Draft posts", instructions: "Draft four posts from the research.", dependsOn: [0] },
    ],
  }), agentIds);

  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.plan.tasks[1].dependsOn, [0]);
});

test("rejects role names instead of configured IDs, malformed plans, and forward dependencies", () => {
  assert.equal(validateMasterPlan('{"tasks":[', agentIds).ok, false);
  assert.equal(validateMasterPlan(JSON.stringify({ tasks: [{ agentId: "Research", title: "Research", instructions: "Find themes" }] }), agentIds).ok, false);
  assert.equal(validateMasterPlan(JSON.stringify({ tasks: [{ agentId: "seat-1", title: "Research", instructions: "Find themes", dependsOn: [0] }] }), agentIds).ok, false);
});

test("accepts content preparation and a proposed Instagram schedule alongside a clarification", () => {
  const result = validateMasterPlan(JSON.stringify({
    clarification: "What niche should the Instagram post target?",
    tasks: [
      { agentId: "seat-mvj4q0fn", title: "Prepare Instagram post", instructions: "Draft one Instagram post after the user confirms their niche. Do not publish it.", dependsOn: [] },
      { agentId: "seat-mvj4q1b7", title: "Propose posting time", instructions: "Suggest a time tomorrow morning in the user's local time. This is a proposed schedule only; do not claim the post is scheduled or published.", dependsOn: [0] },
    ],
  }), agentIds);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.plan.clarification, "What niche should the Instagram post target?");
    assert.deepEqual(result.plan.tasks.map((task) => task.agentId), ["seat-mvj4q0fn", "seat-mvj4q1b7"]);
    assert.deepEqual(result.plan.tasks[1].dependsOn, [0]);
  }
});

test("reports useful reasons for invalid planner output without accepting invalid assignments", () => {
  const unknownAgent = validateMasterPlan(JSON.stringify({ tasks: [
    { agentId: "Content Creation", title: "Write a post", instructions: "Draft it." },
  ] }), agentIds);
  assert.deepEqual(unknownAgent, { ok: false, reason: "unknown_agent" });
  assert.equal(describeInvalidMasterPlan(unknownAgent.reason), "a task used an unrecognized specialist ID");

  const missingDetails = validateMasterPlan(JSON.stringify({ tasks: [
    { agentId: "seat-mvj4q0fn", title: "", instructions: "Draft a post." },
  ] }), agentIds);
  assert.deepEqual(missingDetails, { ok: false, reason: "missing_task_details" });
  assert.equal(describeInvalidMasterPlan("malformed_json"), "the response was not valid JSON");
});

test("does not mistake free text for persisted delegation and reports actual task states", () => {
  assert.equal(hasDelegationClaim("I delegated content strategy to the specialists."), true);
  assert.equal(hasDelegationClaim("I can help plan your campaign. What is your audience?"), false);
  assert.match(summarizeTaskStatuses([
    { title: "Research", status: "completed" },
    { title: "Draft posts", status: "failed", error: "Specialist execution failed (timeout)." },
    { title: "Propose schedule", status: "queued" },
  ]), /1 completed, 1 queued, 1 failed/);
});
