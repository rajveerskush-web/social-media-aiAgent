import assert from "node:assert/strict";
import test from "node:test";
import { formatExecutionStatus, formatElapsedTime } from "../lib/agent-activity-format.ts";
import { isComputerEligible } from "../lib/computer-types.ts";

// ---------------------------------------------------------------------------
// Unit Tests: Activity Popover Formatters & Universal Agent Mapping
// ---------------------------------------------------------------------------

test("popover formatters: maps execution status correctly", () => {
  assert.deepEqual(formatExecutionStatus("running"), { label: "Working", cssClass: "is-running" });
  assert.deepEqual(formatExecutionStatus("waiting_for_user"), { label: "Waiting for You", cssClass: "is-waiting" });
  assert.deepEqual(formatExecutionStatus("queued"), { label: "Queued", cssClass: "is-queued" });
  assert.deepEqual(formatExecutionStatus("completed"), { label: "Done", cssClass: "is-completed" });
  assert.deepEqual(formatExecutionStatus("failed"), { label: "Failed", cssClass: "is-failed" });
  assert.deepEqual(formatExecutionStatus("ready"), { label: "Ready", cssClass: "is-ready" });
  assert.deepEqual(formatExecutionStatus("idle"), { label: "Ready", cssClass: "is-ready" });
});

test("popover formatters: formats elapsed time accurately", () => {
  assert.equal(formatElapsedTime(null), "—");
  assert.equal(formatElapsedTime(undefined), "—");
  assert.equal(formatElapsedTime(-500), "—");
  assert.equal(formatElapsedTime(0), "0s");
  assert.equal(formatElapsedTime(45_000), "45s");
  assert.equal(formatElapsedTime(124_000), "2m 4s");
  assert.equal(formatElapsedTime(3600_000), "60m 0s");
});

// ---------------------------------------------------------------------------
// Parameterized Tests: Every Supported Agent Verified
// ---------------------------------------------------------------------------

const SUPPORTED_AGENTS = [
  { id: "master-agent", name: "Master Agent", role: "Master Agent", computerEligible: false },
  { id: "seat-1", name: "Research Agent", role: "Research Specialist", computerEligible: true },
  { id: "seat-mvj4q0fn", name: "Content Creator Agent", role: "Content Specialist", computerEligible: true },
  { id: "seat-mvj4q1b7", name: "Scheduler Agent", role: "Scheduler Specialist", computerEligible: false },
  { id: "seat-mvj4q1mo", name: "Analytics Agent", role: "Analytics Specialist", computerEligible: false },
];

for (const agent of SUPPORTED_AGENTS) {
  test(`agent verification [${agent.name}]: computer eligibility matches specification`, () => {
    assert.equal(
      isComputerEligible(agent.id),
      agent.computerEligible,
      `Agent ${agent.id} eligibility should be ${agent.computerEligible}`,
    );
  });
}

// ---------------------------------------------------------------------------
// Tests: Simulated Activity State Aggregation & Transitions
// ---------------------------------------------------------------------------

function simulateAgentActivity(agent, taskState, computerState, artifactCount = 0) {
  const isEligible = isComputerEligible(agent.id);
  let execStatus = "ready";
  let currentTask = null;

  if (taskState) {
    execStatus = taskState.status;
    currentTask = {
      id: taskState.id,
      title: taskState.title,
      status: taskState.status,
      elapsedMs: taskState.elapsedMs ?? null,
    };
  }

  let computerStatus = "not_applicable";
  let controlMode = "agent";

  if (isEligible) {
    if (computerState) {
      controlMode = computerState.controlMode ?? "agent";
      if (controlMode === "human") {
        computerStatus = "waiting";
        if (execStatus !== "running") execStatus = "waiting_for_user";
      } else if (computerState.status === "running") {
        computerStatus = "running";
      } else if (computerState.status === "paused") {
        computerStatus = "paused";
      } else {
        computerStatus = "stopped";
      }
    } else {
      computerStatus = "stopped";
    }
  }

  return {
    agentId: agent.id,
    agentRole: agent.role,
    agentName: agent.name,
    executionStatus: execStatus,
    currentTask,
    computerStatus,
    controlMode,
    artifactsCount: isEligible ? artifactCount : 0,
  };
}

for (const agent of SUPPORTED_AGENTS) {
  test(`lifecycle [${agent.name}]: reports truthful 'ready' state when idle with no active tasks`, () => {
    const activity = simulateAgentActivity(agent, null, null, 0);
    assert.equal(activity.executionStatus, "ready");
    assert.equal(activity.currentTask, null);
    if (agent.computerEligible) {
      assert.equal(activity.computerStatus, "stopped");
    } else {
      assert.equal(activity.computerStatus, "not_applicable");
    }
    assert.equal(activity.artifactsCount, 0);
  });

  test(`lifecycle [${agent.name}]: transitions to 'running' during active task execution`, () => {
    const activity = simulateAgentActivity(
      agent,
      { id: 42, title: `Assignment for ${agent.name}`, status: "running", elapsedMs: 14000 },
      agent.computerEligible ? { status: "running", controlMode: "agent" } : null,
      2,
    );
    assert.equal(activity.executionStatus, "running");
    assert.equal(activity.currentTask?.id, 42);
    assert.equal(activity.currentTask?.elapsedMs, 14000);
    if (agent.computerEligible) {
      assert.equal(activity.computerStatus, "running");
      assert.equal(activity.artifactsCount, 2);
    } else {
      assert.equal(activity.computerStatus, "not_applicable");
      assert.equal(activity.artifactsCount, 0);
    }
  });

  test(`lifecycle [${agent.name}]: reflects queued and pending tasks truthfully`, () => {
    const activity = simulateAgentActivity(
      agent,
      { id: 43, title: `Queued work for ${agent.name}`, status: "queued" },
      null,
    );
    assert.equal(activity.executionStatus, "queued");
    assert.equal(activity.currentTask?.status, "queued");
  });

  test(`lifecycle [${agent.name}]: reflects failure states truthfully without masking as active`, () => {
    const activity = simulateAgentActivity(
      agent,
      { id: 44, title: `Failed task for ${agent.name}`, status: "failed" },
      null,
    );
    assert.equal(activity.executionStatus, "failed");
    assert.equal(activity.currentTask?.status, "failed");
  });
}

test("lifecycle [human takeover]: transitions eligible computers to waiting and preserves control handoff", () => {
  const researchAgent = SUPPORTED_AGENTS.find((a) => a.id === "seat-1");
  const activity = simulateAgentActivity(
    researchAgent,
    { id: 50, title: "Web research task", status: "waiting_for_user" },
    { status: "running", controlMode: "human" },
    3,
  );
  assert.equal(activity.executionStatus, "waiting_for_user");
  assert.equal(activity.computerStatus, "waiting");
  assert.equal(activity.controlMode, "human");
  assert.equal(activity.artifactsCount, 3);
});

test("lifecycle [non-computer]: never creates or reports desktop for Scheduler or Analytics agents", () => {
  for (const agentId of ["seat-mvj4q1b7", "seat-mvj4q1mo", "master-agent"]) {
    const agent = SUPPORTED_AGENTS.find((a) => a.id === agentId);
    const activity = simulateAgentActivity(agent, { id: 60, title: "Pure AI work", status: "running" }, null);
    assert.equal(activity.computerStatus, "not_applicable");
    assert.equal(activity.artifactsCount, 0);
  }
});
