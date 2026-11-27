import assert from "node:assert/strict";
import fs from "node:fs";
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
  const summary = summarizeTaskStatuses([
    { id: 1, title: "Research", status: "completed", assignedAgentId: "seat-1", response: "Three audience segments emerged from the supplied notes." },
    { id: 2, title: "Draft posts", status: "failed", error: "Specialist execution failed (timeout)." },
    { id: 3, title: "Propose schedule", status: "queued" },
    { id: 4, title: "Review drafts", status: "blocked" },
  ]);
  assert.match(summary, /1 completed, 1 waiting to start, 1 waiting on prerequisite work, 1 not completed/);
  assert.match(summary, /Three audience segments emerged from the supplied notes\./);
  assert.match(summary, /Draft posts: Specialist execution failed \(timeout\)\./);
  assert.match(summary, /Propose schedule.*queued/);
  assert.match(summary, /Review drafts.*blocked/);
});

test("does not invent a result when a completed task has no saved specialist response", () => {
  const summary = summarizeTaskStatuses([{ title: "Analyze campaign", status: "completed" }]);
  assert.match(summary, /marked complete, but no specialist response was saved/);
  assert.doesNotMatch(summary, /analysis shows|results indicate/i);
});

test("accepts task updates and passes new information to assigned agent without duplicate task creation", () => {
  const result = validateMasterPlan(JSON.stringify({
    clarification: "",
    updatedTasks: [
      { id: 42, additionalInstructions: "Focus specifically on specialty pour-over cafes with Gen Z branding." },
    ],
    tasks: [],
    review: "I have updated the research assignment with your specific focus on specialty pour-over cafes.",
  }), agentIds);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.plan.updatedTasks.length, 1);
    assert.equal(result.plan.updatedTasks[0].id, 42);
    assert.match(result.plan.updatedTasks[0].additionalInstructions, /specialty pour-over/);
    assert.equal(result.plan.tasks.length, 0); // No duplicate tasks
  }
});

test("auto-maps task items with updateTaskId into updatedTasks", () => {
  const result = validateMasterPlan(JSON.stringify({
    tasks: [
      {
        updateTaskId: 55,
        title: "Update competitor research",
        instructions: "Add pricing tiers for iced drinks.",
      },
    ],
  }), agentIds);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.plan.updatedTasks.length, 1);
    assert.equal(result.plan.updatedTasks[0].id, 55);
    assert.equal(result.plan.updatedTasks[0].additionalInstructions, "Add pricing tiers for iced drinks.");
    assert.equal(result.plan.tasks.length, 0); // Normalized to updatedTasks, avoiding duplicates
  }
});

test("summarizeTaskStatuses formats updated tasks alongside new or existing tasks", () => {
  const summary = summarizeTaskStatuses(
    [],
    true,
    [{ id: 10, title: "Market Research", assignedAgentId: "Research Agent" }],
  );
  assert.match(summary, /updated 1 existing task.*#10 Market Research for Research Agent/);
});

test("agent instructions enforce selective browser policy for Research and Content Creator agents", () => {
  const filePath = new URL("../lib/agent-instructions.ts", import.meta.url);
  const content = fs.readFileSync(filePath, "utf-8");

  // Research Agent: browse by default for latest external info, but confident answers without browsing permitted
  assert.match(content, /use the browser by default to access the latest external information/i);
  assert.match(content, /if you can answer confidently using your existing knowledge.*you do not need to browse every time/i);

  // Content Creator Agent: browse for live campaign references, but confident creative copy without browsing permitted
  assert.match(content, /use the browser through your cloud desktop sandbox to access the latest information/i);
  assert.match(content, /if you can craft the requested creative copy.*confidently using existing knowledge.*you do not need to browse every time/i);
});
