import assert from "node:assert/strict";
import test from "node:test";
import {
  CampaignEndedAbortError,
  HumanTakeoverActiveError,
  IneligibleAgentComputerError,
} from "../lib/computer-types.ts";
import {
  executeToolByName,
  runComputerAgentLoop,
} from "../lib/computer-agent-loop.ts";

// ---------------------------------------------------------------------------
// Mock Sandbox & Environment Harness
// ---------------------------------------------------------------------------

function createMockDesktopSandbox(options = {}) {
  const executedCommands = [];
  const clickedCoords = [];
  const typedText = [];
  const visitedUrls = [];

  return {
    state: {
      executedCommands,
      clickedCoords,
      typedText,
      visitedUrls,
    },
    async screenshot(format = "bytes") {
      return Buffer.from("mock-png-screenshot-bytes-data");
    },
    async leftClick(x, y) {
      clickedCoords.push({ x, y, button: "left" });
    },
    async rightClick(x, y) {
      clickedCoords.push({ x, y, button: "right" });
    },
    async doubleClick(x, y) {
      clickedCoords.push({ x, y, button: "double" });
    },
    async write(text) {
      typedText.push(text);
    },
    async press(key) {},
    async scroll(direction, amount) {},
    async drag(from, to) {},
    async wait(ms) {},
    async open(url) {
      visitedUrls.push(url);
    },
    async launch(app) {},
    files: {
      async read(path, opts) {
        if (options.fileNotFound) throw new Error("File not found");
        return opts?.format === "bytes"
          ? new Uint8Array([114, 101, 112, 111, 114, 116]) // "report"
          : "# Competitor Report Content";
      },
      async write(path, data) {
        return { bytesWritten: 100 };
      },
    },
    commands: {
      async run(cmd, opts) {
        executedCommands.push(cmd);
        if (options.failCommand) {
          return { stdout: "", stderr: "command failed", exitCode: 1 };
        }
        return { stdout: "command output: success\n", stderr: "", exitCode: 0 };
      },
    },
  };
}

const mockContext = {
  authUserId: "user-alpha",
  campaignId: 101,
  agentId: "seat-1", // Research specialist
  taskId: 501,
  computerId: 1,
};

// ---------------------------------------------------------------------------
// Tests: Tool Dispatcher Primitives
// ---------------------------------------------------------------------------

test("executeToolByName correctly routes primitives to sandbox", async () => {
  const sandbox = createMockDesktopSandbox();
  const testDeps = { verifyContext: async () => {} };

  // 1. Screenshot
  const shotRes = await executeToolByName("takeScreenshot", {}, sandbox, mockContext, testDeps);
  assert.equal(shotRes.tool, "screenshot");
  assert.equal(shotRes.verified, true);
  assert.ok(shotRes.screenshotBase64);

  // 2. Click mouse
  const clickRes = await executeToolByName(
    "clickMouse",
    { x: 300, y: 400, button: "left" },
    sandbox,
    mockContext,
    testDeps,
  );
  assert.equal(clickRes.tool, "click");
  assert.equal(clickRes.verified, true);
  assert.deepEqual(sandbox.state.clickedCoords[0], { x: 300, y: 400, button: "left" });

  // 3. Type input
  const typeRes = await executeToolByName(
    "typeInput",
    { text: "AI marketing trends 2026", pressKey: "Enter" },
    sandbox,
    mockContext,
    testDeps,
  );
  assert.equal(typeRes.tool, "type");
  assert.equal(typeRes.verified, true);
  assert.equal(sandbox.state.typedText[0], "AI marketing trends 2026");

  // 4. Navigate
  const navRes = await executeToolByName(
    "navigateTo",
    { url: "https://example.com/trends" },
    sandbox,
    mockContext,
    testDeps,
  );
  assert.equal(navRes.tool, "navigateTo");
  assert.equal(navRes.verified, true);
  assert.equal(sandbox.state.visitedUrls[0], "https://example.com/trends");

  // 5. Shell command
  const shellRes = await executeToolByName(
    "runShellCommand",
    { cmd: "python3 -c 'print(42)'" },
    sandbox,
    mockContext,
    testDeps,
  );
  assert.equal(shellRes.tool, "runShell");
  assert.equal(shellRes.verified, true);

  // 6. Unknown tool
  const unknownRes = await executeToolByName("arbitraryTool", {}, sandbox, mockContext, testDeps);
  assert.equal(unknownRes.verified, false);
  assert.match(unknownRes.error, /Unknown tool/);
});

// ---------------------------------------------------------------------------
// Tests: Observe -> Reason -> Act -> Verify Agent Loop
// ---------------------------------------------------------------------------

test("agent loop: multi-step autonomous tool execution to completion", async () => {
  const sandbox = createMockDesktopSandbox();
  const checkpoints = [];
  const savedArtifacts = [];
  let leaseRenewed = false;

  // Simulate a 3-step reasoning trajectory from Gemini:
  // Step 1: Open browser to research site
  // Step 2: Download artifact report
  // Step 3: Complete task with findings
  let modelCallCount = 0;
  const mockCallModel = async (model, sysInstruction, history) => {
    modelCallCount++;
    assert.match(sysInstruction, /OBSERVE -> REASON -> ACT -> VERIFY/);

    if (modelCallCount === 1) {
      return {
        functionCalls: [
          {
            name: "navigateTo",
            args: { url: "https://en.wikipedia.org/wiki/Artificial_intelligence" },
          },
        ],
      };
    }

    if (modelCallCount === 2) {
      // Model receives screenshot + navigation response, now downloads artifact
      return {
        functionCalls: [
          {
            name: "downloadSandboxFile",
            args: {
              sandboxPath: "/home/user/research/summary.md",
              filename: "ai_summary.md",
            },
          },
        ],
      };
    }

    // Step 3: Complete task
    return {
      functionCalls: [
        {
          name: "completeTask",
          args: {
            summary: "Successfully gathered AI research from Wikipedia and exported summary.",
            findings: "AI in 2026 focuses heavily on agentic architectures and computer use.",
            status: "success",
          },
        },
      ],
    };
  };

  const deps = {
    verifyContext: async () => {},
    callModel: mockCallModel,
    saveCheckpoint: async (ctx, cp) => {
      checkpoints.push(cp);
    },
    saveArtifact: async (ctx, art) => {
      savedArtifacts.push(art);
    },
    renewLease: async (id) => {
      leaseRenewed = true;
      return true;
    },
  };

  const outcome = await runComputerAgentLoop(
    mockContext,
    "Research AI Trends",
    "Navigate to Wikipedia and produce a summary markdown report.",
    sandbox,
    { maxSteps: 5 },
    deps,
  );

  assert.equal(outcome.outcome, "completed");
  assert.equal(outcome.stepsExecuted, 3);
  assert.equal(outcome.result.status, "success");
  assert.match(outcome.result.summary, /Successfully gathered AI research/);
  assert.match(outcome.result.findings, /agentic architectures/);
  assert.equal(outcome.result.computerUsed, true);
  assert.ok(outcome.result.actions.length >= 2);
  assert.ok(outcome.result.artifacts.length === 1);
  assert.equal(outcome.result.artifacts[0].filename, "ai_summary.md");

  // Checkpoints persisted
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[0].stepIndex, 1);
  assert.equal(checkpoints[1].stepIndex, 2);

  // Artifact persisted
  assert.equal(savedArtifacts.length, 1);
  assert.equal(savedArtifacts[0].filename, "ai_summary.md");
  assert.equal(leaseRenewed, true);
});

// ---------------------------------------------------------------------------
// Tests: Human Takeover Non-Retryable Handoff (Requirement 4)
// ---------------------------------------------------------------------------

test("agent loop: yields cleanly on HumanTakeoverActiveError without retrying", async () => {
  const sandbox = createMockDesktopSandbox();
  let stepCalls = 0;

  const deps = {
    verifyContext: async () => {
      stepCalls++;
      // On step 2, human clicks Takeover!
      if (stepCalls >= 2) {
        throw new HumanTakeoverActiveError("User has taken control via VNC");
      }
    },
    callModel: async () => ({
      functionCalls: [
        { name: "navigateTo", args: { url: "https://example.com" } },
      ],
    }),
    saveCheckpoint: async () => {},
  };

  const outcome = await runComputerAgentLoop(
    mockContext,
    "Long Task",
    "Browse multiple pages",
    sandbox,
    { maxSteps: 10, initialScreenshotBase64: "mock-initial-shot" },
    deps,
  );

  // Requirement 4: Loop stops immediately and returns waiting_for_user
  assert.equal(outcome.outcome, "waiting_for_user");
  assert.equal(outcome.result.status, "partial");
  assert.match(outcome.result.summary, /control yielded to human takeover/i);
  assert.equal(outcome.stepsExecuted, 1);
});

// ---------------------------------------------------------------------------
// Tests: Campaign Termination & Abort Safety
// ---------------------------------------------------------------------------

test("agent loop: aborts immediately on CampaignEndedAbortError", async () => {
  const sandbox = createMockDesktopSandbox();

  const deps = {
    verifyContext: async () => {
      throw new CampaignEndedAbortError("Campaign ended by user");
    },
    callModel: async () => ({
      functionCalls: [{ name: "takeScreenshot", args: {} }],
    }),
  };

  const outcome = await runComputerAgentLoop(
    mockContext,
    "Aborted Task",
    "Should not execute",
    sandbox,
    { maxSteps: 5 },
    deps,
  );

  assert.equal(outcome.outcome, "aborted");
  assert.equal(outcome.result.status, "failed");
  assert.match(outcome.result.summary, /campaign was ended/i);
  assert.equal(outcome.stepsExecuted, 0);
});

// ---------------------------------------------------------------------------
// Tests: Step Limit & Endless Loop Prevention (Requirement 6)
// ---------------------------------------------------------------------------

test("agent loop: enforces maxSteps limit and returns partial outcome", async () => {
  const sandbox = createMockDesktopSandbox();
  let loopCount = 0;

  const deps = {
    verifyContext: async () => {},
    callModel: async () => {
      loopCount++;
      return {
        functionCalls: [
          { name: "clickMouse", args: { x: 100, y: 100 } },
        ],
      };
    },
    saveCheckpoint: async () => {},
  };

  const outcome = await runComputerAgentLoop(
    mockContext,
    "Looping Task",
    "Keeps clicking",
    sandbox,
    { maxSteps: 4 }, // Bound to 4 steps
    deps,
  );

  assert.equal(outcome.outcome, "step_limit_reached");
  assert.equal(outcome.stepsExecuted, 4);
  assert.equal(loopCount, 4);
  assert.equal(outcome.result.status, "partial");
  assert.match(outcome.result.summary, /maximum execution limit of 4 steps/);
});

// ---------------------------------------------------------------------------
// Tests: Ineligible Agent Rejection
// ---------------------------------------------------------------------------

test("agent loop: rejects computer execution for Scheduling and Analytics agents", async () => {
  const sandbox = createMockDesktopSandbox();

  // Scheduling agent
  await assert.rejects(
    async () =>
      runComputerAgentLoop(
        { ...mockContext, agentId: "seat-mvj4q1b7" },
        "Schedule post",
        "Instructions",
        sandbox,
      ),
    IneligibleAgentComputerError,
  );

  // Analytics agent
  await assert.rejects(
    async () =>
      runComputerAgentLoop(
        { ...mockContext, agentId: "seat-mvj4q1mo" },
        "Analyze metrics",
        "Instructions",
        sandbox,
      ),
    IneligibleAgentComputerError,
  );
});

// ---------------------------------------------------------------------------
// Tests: Truthful Error Capture on Tool Failure (Requirement 7)
// ---------------------------------------------------------------------------

test("agent loop: captures tool errors truthfully without crashing", async () => {
  const sandbox = createMockDesktopSandbox({ failCommand: true });

  let callIndex = 0;
  const deps = {
    verifyContext: async () => {},
    callModel: async () => {
      callIndex++;
      if (callIndex === 1) {
        return {
          functionCalls: [
            // Prohibited command -> will fail validator
            { name: "runShellCommand", args: { cmd: "sudo reboot" } },
          ],
        };
      }
      return {
        functionCalls: [
          {
            name: "completeTask",
            args: {
              summary: "Handled tool failure cleanly.",
              findings: "Sudo commands are forbidden.",
              status: "partial",
            },
          },
        ],
      };
    },
    saveCheckpoint: async () => {},
  };

  const outcome = await runComputerAgentLoop(
    mockContext,
    "Privileged Command Test",
    "Try running sudo",
    sandbox,
    { maxSteps: 3 },
    deps,
  );

  assert.equal(outcome.outcome, "completed");
  assert.equal(outcome.result.status, "partial");
  // Tool failure recorded in unverifiedActions truthfully
  assert.equal(outcome.result.unverifiedActions.length, 1);
  assert.match(outcome.result.unverifiedActions[0].failureReason, /prohibited/i);
});

test("agent loop: packages multimodal screenshots inside functionResponse.parts to comply with Gemini API turn requirements", async () => {
  const sandbox = createMockDesktopSandbox();
  const capturedHistoryTurns = [];

  let step = 0;
  const deps = {
    verifyContext: async () => {},
    callModel: async (modelName, systemPrompt, history) => {
      step++;
      capturedHistoryTurns.push(JSON.parse(JSON.stringify(history)));
      if (step === 1) {
        return {
          functionCalls: [
            { name: "openBrowser", args: { url: "https://example.com" } },
          ],
        };
      }
      return {
        functionCalls: [
          {
            name: "completeTask",
            args: {
              summary: "Browsed to example.com successfully",
              findings: "Page loaded",
              status: "success",
            },
          },
        ],
      };
    },
    saveCheckpoint: async () => {},
  };

  const outcome = await runComputerAgentLoop(
    mockContext,
    "Gemini Multi-turn Multimodal Turn Format Test",
    "Navigate and inspect",
    sandbox,
    { maxSteps: 3 },
    deps,
  );

  assert.equal(outcome.outcome, "completed");
  assert.equal(capturedHistoryTurns.length, 2);

  // Turn 0: initial user turn (text + optional initial screenshot)
  const turn0 = capturedHistoryTurns[0][0];
  assert.equal(turn0.role, "user");

  // On step 2 (callModel call 2), inspect history:
  // history[0] = initial user turn
  // history[1] = model turn with functionCalls
  // history[2] = user turn with tool response
  const historyOnStep2 = capturedHistoryTurns[1];
  assert.equal(historyOnStep2.length, 3);

  const modelTurn = historyOnStep2[1];
  assert.equal(modelTurn.role, "model");
  assert.ok(modelTurn.parts.some((p) => p.functionCall?.name === "openBrowser"));

  const toolFeedbackTurn = historyOnStep2[2];
  assert.equal(toolFeedbackTurn.role, "user");
  // CRITICAL GEMINI SPECIFICATION:
  // Every part in toolFeedbackTurn MUST be a functionResponse.
  // No top-level inlineData parts are permitted in a turn containing functionResponse.
  assert.ok(toolFeedbackTurn.parts.length > 0);
  for (const part of toolFeedbackTurn.parts) {
    assert.ok(part.functionResponse, "Part in function-response turn must be functionResponse");
    assert.equal(part.inlineData, undefined, "Turn must not contain top-level inlineData");
    assert.equal(part.text, undefined, "Turn must not contain top-level text");
  }

  // The resulting screenshot must be nested inside functionResponse.parts
  const browserResp = toolFeedbackTurn.parts.find((p) => p.functionResponse?.name === "openBrowser");
  assert.ok(browserResp);
  assert.ok(browserResp.functionResponse.parts, "Screenshot must be attached in functionResponse.parts");
  assert.equal(browserResp.functionResponse.parts[0]?.inlineData?.mimeType, "image/png");
});

test("agent loop: reports provider errors as outcome 'error' instead of false 'aborted'", async () => {
  const sandbox = createMockDesktopSandbox();

  const deps = {
    verifyContext: async () => {},
    callModel: async () => {
      throw new Error("Gemini API rate limit exceeded (429 Too Many Requests)");
    },
    saveCheckpoint: async () => {},
  };

  const outcome = await runComputerAgentLoop(
    mockContext,
    "Model Error Classification Test",
    "Execute search",
    sandbox,
    { maxSteps: 3 },
    deps,
  );

  assert.equal(outcome.outcome, "error");
  assert.match(outcome.error, /rate limit exceeded/i);
  assert.match(outcome.result.summary, /Model invocation failed at step 1/i);
  assert.equal(outcome.result.computerUsed, true);
});

test("agent loop: halts and reports meaningful error when sandbox microVM disconnects or is terminated", async () => {
  const deadSandbox = {
    async setTimeout() {
      throw new Error("Sandbox sbx-dead-123 not found on E2B control plane");
    },
    async screenshot() {
      return Buffer.from("fake");
    },
    commands: { async run() { return { stdout: "", stderr: "", exitCode: 0 }; } },
  };

  const deps = {
    verifyContext: async () => {},
    callModel: async () => ({ functionCalls: [{ name: "takeScreenshot", args: {} }] }),
    saveCheckpoint: async () => {},
  };

  const outcome = await runComputerAgentLoop(
    mockContext,
    "Dead Sandbox Test",
    "Perform action",
    deadSandbox,
    { maxSteps: 3 },
    deps,
  );

  assert.equal(outcome.outcome, "error");
  assert.match(outcome.error, /terminated or disconnected/i);
  assert.equal(outcome.result.status, "failed");
});

test("sandbox renewal: renewSandboxTimeout extends lifetime safely and handles missing/mock sandbox", async () => {
  const { renewSandboxTimeout, getE2BSandboxTimeoutMs } = await import("../lib/computer-service.ts");

  let extendedMs = 0;
  const mockSbx = {
    async setTimeout(ms) {
      extendedMs = ms;
    },
  };

  const renewed = await renewSandboxTimeout(mockSbx, 1_800_000);
  assert.equal(renewed, true);
  assert.equal(extendedMs, 1_800_000);

  // Missing sandbox returns false without throwing
  assert.equal(await renewSandboxTimeout(null), false);
  assert.equal(await renewSandboxTimeout(undefined), false);

  // Non-function setTimeout returns false without throwing
  assert.equal(await renewSandboxTimeout({ setTimeout: "not a function" }), false);

  // Thrown error caught gracefully
  const brokenSbx = {
    async setTimeout() { throw new Error("E2B network error"); },
  };
  assert.equal(await renewSandboxTimeout(brokenSbx), false);
});

test("configuration: getE2BSandboxTimeoutMs and getComputerLoopMaxDurationMs safely respect environment overrides", async () => {
  const { getE2BSandboxTimeoutMs, E2B_DEFAULT_SANDBOX_TIMEOUT_MS } = await import("../lib/computer-service.ts");
  const { getComputerLoopMaxDurationMs, getComputerLoopMaxSteps, DEFAULT_MAX_DURATION_MS, DEFAULT_MAX_STEPS } = await import("../lib/computer-agent-loop.ts");

  // Defaults when env is unset
  delete process.env.E2B_SANDBOX_TIMEOUT_MS;
  delete process.env.COMPUTER_LOOP_MAX_DURATION_MS;
  delete process.env.COMPUTER_LOOP_MAX_STEPS;

  assert.equal(getE2BSandboxTimeoutMs(), E2B_DEFAULT_SANDBOX_TIMEOUT_MS);
  assert.equal(getComputerLoopMaxDurationMs(), DEFAULT_MAX_DURATION_MS);
  assert.equal(getComputerLoopMaxSteps(), DEFAULT_MAX_STEPS);

  // Overrides when env is set
  process.env.E2B_SANDBOX_TIMEOUT_MS = "3600000";
  process.env.COMPUTER_LOOP_MAX_DURATION_MS = "1200000";
  process.env.COMPUTER_LOOP_MAX_STEPS = "25";

  assert.equal(getE2BSandboxTimeoutMs(), 3_600_000);
  assert.equal(getComputerLoopMaxDurationMs(), 1_200_000);
  assert.equal(getComputerLoopMaxSteps(), 25);

  delete process.env.E2B_SANDBOX_TIMEOUT_MS;
  delete process.env.COMPUTER_LOOP_MAX_DURATION_MS;
  delete process.env.COMPUTER_LOOP_MAX_STEPS;
});
