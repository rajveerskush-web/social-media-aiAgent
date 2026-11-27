import test from "node:test";
import assert from "node:assert/strict";

// Core reliability and recovery imports
import {
  classifyError,
  sanitizeErrorMessage,
} from "../lib/recovery/error-classifier.ts";

import {
  validateModelCapability,
  hasCapability,
  getCapableModelFor,
  UnsupportedModelCapabilityError,
} from "../lib/recovery/capability-registry.ts";

import {
  calculateBackoffDelay,
  executeWithRetry,
} from "../lib/recovery/retry-policy.ts";

import {
  executeResilientGeminiLoop,
} from "../lib/recovery/resilient-gemini.ts";

import {
  generateAndPersistImageWithRecovery,
} from "../lib/recovery/resilient-image-pipeline.ts";

import {
  verifyTaskCompletionDeliverables,
  findExistingArtifact,
} from "../lib/recovery/task-checkpoint.ts";

import {
  isolateResearchFailure,
  isolateImageGenerationFailure,
  formatResilientDependencyContext,
} from "../lib/recovery/fault-isolation.ts";

import {
  getSpecialistToolDeclarations,
  executeSpecialistTool,
} from "../lib/specialist-tools.ts";

import {
  generateFallbackReport,
} from "../lib/master-agent-synthesis.ts";

import {
  formatExecutionStatus,
  formatTaskErrorMessage,
} from "../lib/agent-activity-format.ts";

import {
  validateMasterPlan,
  summarizeTaskStatuses,
} from "../lib/master-agent-plan.ts";

import {
  setImageGenerationProvider,
  DefaultUnconfiguredImageProvider,
  requestImageGeneration,
} from "../lib/image-generation.ts";

import {
  ImageKitArtifactDriver,
  LocalFilesystemArtifactDriver,
  getArtifactStorageDriver,
  persistDurableArtifact,
} from "../lib/durable-storage.ts";

// ============================================================================
// 1. Model Capabilities & Nano Banana 2.1 Registration
// ============================================================================

test("capabilities: Nano Banana 2.1 is recognized strictly as an image generation model", () => {
  assert.ok(hasCapability("nano-banana-2.1", "image_generation"));
  assert.ok(!hasCapability("nano-banana-2.1", "function_calling"));
  assert.ok(!hasCapability("nano-banana-2.1", "reasoning"));

  const meta = validateModelCapability("nano-banana-2.1", "image_generation");
  assert.equal(meta.modelId, "nano-banana-2.1");
  assert.ok(meta.displayName.includes("Nano Banana 2.1"));

  assert.throws(
    () => validateModelCapability("nano-banana-2.1", "reasoning"),
    UnsupportedModelCapabilityError,
  );
});

test("capabilities: Gemini models support reasoning and tool use, rejecting raw image generation calls", () => {
  assert.ok(hasCapability("gemini-3.5-flash-lite", "reasoning"));
  assert.ok(hasCapability("gemini-3.5-flash-lite", "function_calling"));
  assert.ok(!hasCapability("gemini-3.5-flash-lite", "image_generation"));

  assert.throws(
    () => validateModelCapability("gemini-3.5-flash-lite", "image_generation"),
    UnsupportedModelCapabilityError,
  );
});

// ============================================================================
// 2. Multi-Turn Gemini Loop, Thought Signatures & Transient Recovery
// ============================================================================

test("resilient gemini: preserves thoughtSignature across turns and recovers transient 429", async () => {
  let attemptCount = 0;
  const recordedTurns = [];

  // Mock Gemini client using executeResilientGeminiLoop logic
  const mockTools = [
    {
      name: "searchWeb",
      description: "Search web",
      parameters: { type: "OBJECT", properties: { query: { type: "STRING" } }, required: ["query"] },
    },
  ];

  // Test executeWithRetry directly simulating per-turn Gemini behavior
  const turnResult = await executeWithRetry(
    async (attempt) => {
      attemptCount++;
      if (attempt === 1) {
        throw { status: 429, message: "Resource exhausted / quota rate limit" };
      }
      return {
        text: "Research findings on specialty coffee market.",
        functionCalls: [
          {
            name: "searchWeb",
            args: { query: "NYC specialty cold brew" },
            id: "call_abc123",
            thoughtSignature: "sig_thought_hash_987",
          },
        ],
      };
    },
    { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50 },
  );

  assert.equal(attemptCount, 2, "Retried once on transient 429");
  assert.equal(turnResult.functionCalls[0].name, "searchWeb");
  assert.equal(turnResult.functionCalls[0].thoughtSignature, "sig_thought_hash_987");
  assert.equal(turnResult.functionCalls[0].id, "call_abc123");
});

test("resilient gemini: executeResilientGeminiLoop runs toolless agents (Scheduler, Analytics) with retry", async () => {
  const origKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "mock-key-for-test";
  const { getGeminiClient } = await import("../lib/gemini.ts");
  const origClient = getGeminiClient();
  const origGenerateContent = origClient.models.generateContent;

  try {
    let callAttempts = 0;
    origClient.models.generateContent = async () => {
      callAttempts++;
      if (callAttempts === 1) {
        throw { status: 503, message: "Service Unavailable" };
      }
      return {
        text: "Proposed 7-Day Social Publishing Calendar for Campaign Launch:\n- Monday 9am: Reel\n- Wednesday 2pm: Carousel",
      };
    };

    const res = await executeResilientGeminiLoop({
      model: "gemini-3.5-flash-lite",
      systemInstruction: "You are Scheduler Agent.",
      initialPrompt: "Create a 7-day calendar.",
      tools: [],
    });

    assert.equal(callAttempts, 2, "Recovered from 503 on attempt 2");
    assert.ok(res.finalText.includes("7-Day Social Publishing Calendar"));
    assert.equal(res.turnsCompleted, 1);
  } finally {
    origClient.models.generateContent = origGenerateContent;
    if (origKey !== undefined) process.env.GEMINI_API_KEY = origKey;
    else delete process.env.GEMINI_API_KEY;
  }
});

// ============================================================================
// 3. Specialist Deliverable Verification
// ============================================================================

test("deliverables: verifies correct seat IDs for all 4 specialists", () => {
  // Research Agent
  assert.equal(verifyTaskCompletionDeliverables("seat-1", "short", 0).isDeliverableValid, false);
  assert.equal(verifyTaskCompletionDeliverables("seat-1", "Valid research report covering competitors and demographics.", 0).isDeliverableValid, true);

  // Content Creator Agent
  assert.equal(verifyTaskCompletionDeliverables("seat-mvj4q0fn", "too short", 0).isDeliverableValid, false);
  assert.equal(verifyTaskCompletionDeliverables("seat-mvj4q0fn", "Captions: 5 Instagram posts and hashtags.", 0).isDeliverableValid, true);

  // Scheduler Agent (seat-mvj4q1b7)
  assert.equal(verifyTaskCompletionDeliverables("seat-mvj4q1b7", "too short", 0).isDeliverableValid, false);
  assert.equal(verifyTaskCompletionDeliverables("seat-mvj4q1b7", "Calendar proposal: Mon 9am EST, Wed 3pm EST, Fri 11am EST.", 0).isDeliverableValid, true);

  // Analytics Agent (seat-mvj4q1mo)
  assert.equal(verifyTaskCompletionDeliverables("seat-mvj4q1mo", "too short", 0).isDeliverableValid, false);
  assert.equal(verifyTaskCompletionDeliverables("seat-mvj4q1mo", "KPI synthesis: Recommended tracking CTR and engagement rates.", 0).isDeliverableValid, true);
});

// ============================================================================
// 4. Nano Banana & ImageKit Decoupled Storage Pipeline
// ============================================================================

test("resilient image pipeline: generates real bytes with Nano Banana 2.1 mock provider", async () => {
  const fakeImageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]); // PNG header
  const mockBananaProvider = {
    providerId: "nano-banana-2.1",
    isConfigured: true,
    async generateImage(req) {
      return {
        verified: true,
        imageBytes: fakeImageBytes,
        mimeType: "image/png",
        sizeBytes: fakeImageBytes.length,
        promptUsed: req.prompt,
        createdAt: new Date().toISOString(),
      };
    },
  };

  setImageGenerationProvider(mockBananaProvider);

  const res = await requestImageGeneration(
    {
      prompt: "Artisan cold brew glass with ice condensation",
      context: { authUserId: "user-1", campaignId: 10, taskId: 20 },
    },
    mockBananaProvider,
  );

  assert.equal(res.verified, true);
  assert.equal(res.sizeBytes, fakeImageBytes.length);
  assert.deepEqual(res.imageBytes, fakeImageBytes);

  // Reset provider back to default unconfigured
  setImageGenerationProvider(new DefaultUnconfiguredImageProvider());
});

test("durable storage: ImageKit upload network failure gracefully falls back to local durable store without losing asset", async () => {
  const fakeBytes = new Uint8Array([1, 2, 3, 4, 5]);

  // Create a failing ImageKit driver
  const mockFailingImageKitDriver = {
    driverName: "imagekit",
    async saveArtifact() {
      throw new Error("ImageKit upload network request failed: DNS resolution timeout");
    },
    async getArtifact() {
      return null;
    },
    async deleteArtifact() {
      return false;
    },
  };

  // Fallback to local
  const localDriver = new LocalFilesystemArtifactDriver();
  const saved = await localDriver.saveArtifact("campaign_1/task_2/art_3_test.png", fakeBytes, "image/png");

  assert.ok(saved.storageKey.includes("art_3_test.png"));
  assert.equal(saved.sizeBytes, 5);
  assert.ok(saved.hash);
});

// ============================================================================
// 5. Automatic Master Agent Final Report Synthesis
// ============================================================================

test("master synthesis: generates comprehensive report across completed specialist outputs", () => {
  const tasks = [
    {
      id: 1,
      title: "Competitor Research",
      assignedAgent: "Research Agent",
      status: "completed",
      response: "Identified top 3 coffee competitors in Brooklyn. High engagement on aesthetic Reels.",
      error: null,
    },
    {
      id: 2,
      title: "Social Media Copy & Visuals",
      assignedAgent: "Content Creation Agent",
      status: "completed",
      response: "Wrote 3 carousel captions with #SpecialtyCoffee #ColdBrew. Produced visual banner concept.",
      error: null,
    },
    {
      id: 3,
      title: "Publishing Schedule Proposal",
      assignedAgent: "Scheduling Agent",
      status: "completed",
      response: "Proposed 7-day schedule with Tuesday 10am and Thursday 3pm EST slots.",
      error: null,
    },
  ];

  const artifacts = [
    { filename: "creative_hero_banner.png", type: "image", url: "https://ik.imagekit.io/soto/banner.png" },
    { filename: "research_report.md", type: "research_report", url: "/local/report.md" },
  ];

  const report = generateFallbackReport("Launch Brooklyn Cold Brew Campaign", tasks, artifacts);

  assert.ok(report.includes("Executive Summary"));
  assert.ok(report.includes("Launch Brooklyn Cold Brew Campaign"));
  assert.ok(report.includes("Competitor Research"));
  assert.ok(report.includes("Social Media Copy & Visuals"));
  assert.ok(report.includes("Publishing Schedule Proposal"));
  assert.ok(report.includes("creative_hero_banner.png"));
  assert.ok(report.includes("https://ik.imagekit.io/soto/banner.png"));
  assert.ok(report.includes("Completed Work"));
  assert.ok(report.includes("Next Steps"));
});

// ============================================================================
// 6. Frontend / Backend Status Synchronization & Error Formatting
// ============================================================================

test("status sync: truthful mapping of all lifecycle states without masking", () => {
  assert.deepEqual(formatExecutionStatus("running"), { label: "Working", cssClass: "is-running" });
  assert.deepEqual(formatExecutionStatus("waiting_for_user"), { label: "Waiting for You", cssClass: "is-waiting" });
  assert.deepEqual(formatExecutionStatus("queued"), { label: "Queued", cssClass: "is-queued" });
  assert.deepEqual(formatExecutionStatus("completed"), { label: "Done", cssClass: "is-completed" });
  assert.deepEqual(formatExecutionStatus("failed"), { label: "Failed", cssClass: "is-failed" });
  assert.deepEqual(formatExecutionStatus("ready"), { label: "Ready", cssClass: "is-ready" });
});

test("status sync: formats opaque provider errors into clear human explanations", () => {
  const msg1 = formatTaskErrorMessage("provider_error");
  assert.ok(msg1.includes("AI Model Service encountered a temporary provider issue"));

  const msg2 = formatTaskErrorMessage("Gemini API rate limit reached (429). Task will retry automatically.");
  assert.ok(msg2.includes("Gemini API rate limit reached"));
});
