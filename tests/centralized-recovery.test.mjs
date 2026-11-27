import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyError,
  sanitizeErrorMessage,
  extractHttpStatus,
  extractRetryAfterMs,
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
  coordinateRecovery,
} from "../lib/recovery/recovery-coordinator.ts";

import {
  isolateResearchFailure,
  isolateImageGenerationFailure,
  formatResilientDependencyContext,
} from "../lib/recovery/fault-isolation.ts";

import {
  verifyTaskCompletionDeliverables,
} from "../lib/recovery/task-checkpoint.ts";

import {
  formatHumanReadableExplanation,
} from "../lib/recovery/execution-logger.ts";

// ============================================================================
// 1. Error Classification & Taxonomy
// ============================================================================

test("recovery classifier: maps Gemini 429 rate limit to transient retry", () => {
  const err = { status: 429, message: "Resource has been exhausted (e.g. check quota)." };
  const classified = classifyError(err);
  assert.equal(classified.domain, "gemini");
  assert.equal(classified.category, "gemini_rate_limited");
  assert.equal(classified.isTransient, true);
  assert.equal(classified.recommendedAction, "retry_backoff");
});

test("recovery classifier: maps Gemini 503 server error to transient retry", () => {
  const err = { status: 503, message: "The service is currently unavailable." };
  const classified = classifyError(err);
  assert.equal(classified.domain, "gemini");
  assert.equal(classified.category, "gemini_server_error");
  assert.equal(classified.isTransient, true);
  assert.equal(classified.recommendedAction, "retry_backoff");
});

test("recovery classifier: maps Gemini 401/403 to permanent terminal fail", () => {
  const err = { status: 401, message: "API key not valid. Please pass a valid API key." };
  const classified = classifyError(err);
  assert.equal(classified.domain, "gemini");
  assert.equal(classified.category, "gemini_auth_failure");
  assert.equal(classified.isTransient, false);
  assert.equal(classified.severity, "permanent");
  assert.equal(classified.recommendedAction, "fail_terminal");
});

test("recovery classifier: identifies Gemini thought_signature missing for protocol repair", () => {
  const err = new Error("Function call is missing a thought_signature in functionCall parts");
  const classified = classifyError(err);
  assert.equal(classified.domain, "gemini");
  assert.equal(classified.category, "gemini_thought_signature_missing");
  assert.equal(classified.recommendedAction, "resume_checkpoint");
});

test("recovery classifier: maps ImageKit upload network failures to transient retry", () => {
  const err = new Error("ImageKit upload network request failed: fetch failed");
  const classified = classifyError(err);
  assert.equal(classified.domain, "imagekit");
  assert.equal(classified.category, "imagekit_upload_failed");
  assert.equal(classified.isTransient, true);
  assert.equal(classified.recommendedAction, "retry_backoff");
});

test("recovery classifier: maps E2B sandbox timeout to checkpoint resume", () => {
  const err = new Error("E2B sandbox expired: session not running");
  const classified = classifyError(err);
  assert.equal(classified.domain, "e2b_sandbox");
  assert.equal(classified.category, "e2b_sandbox_expired");
  assert.equal(classified.recommendedAction, "resume_checkpoint");
});

test("recovery classifier: maps Neon database connection drop to transient retry", () => {
  const err = new Error("postgres connection closed unexpectedly");
  const classified = classifyError(err);
  assert.equal(classified.domain, "database");
  assert.equal(classified.category, "db_connection_error");
  assert.equal(classified.isTransient, true);
});

// ============================================================================
// 2. Secret Redaction & Sanitization
// ============================================================================

test("sanitization: removes Gemini API keys, ImageKit keys, and DB passwords", () => {
  const raw = "Error calling Gemini with key AIzaSyD1234567890abcdef1234567890abcdef and ImageKit private_1234567890abcdef= on postgres://user:secretpass@ep-cool-db.neon.tech/soto";
  const sanitized = sanitizeErrorMessage(raw);
  assert.ok(!sanitized.includes("AIzaSyD1234567890abcdef1234567890abcdef"));
  assert.ok(!sanitized.includes("private_1234567890abcdef="));
  assert.ok(!sanitized.includes("secretpass"));
  assert.ok(sanitized.includes("[REDACTED_GEMINI_KEY]"));
  assert.ok(sanitized.includes("[REDACTED_IMAGEKIT_KEY]"));
  assert.ok(sanitized.includes("[REDACTED_DB_CREDENTIALS]"));
});

// ============================================================================
// 3. Retry Policy & Exponential Backoff
// ============================================================================

test("backoff: increases exponentially and bounds within maxDelay", () => {
  const d1 = calculateBackoffDelay(1, 1000, 10000);
  const d2 = calculateBackoffDelay(2, 1000, 10000);
  const d3 = calculateBackoffDelay(5, 1000, 10000);
  assert.ok(d1 >= 1000 && d1 <= 2000);
  assert.ok(d2 >= 1000 && d2 <= 4000);
  assert.ok(d3 <= 10000);
});

test("backoff: respects explicit provider Retry-After header", () => {
  const delay = calculateBackoffDelay(1, 1000, 30000, 12000);
  assert.ok(delay >= 12000 && delay <= 13000);
});

test("executeWithRetry: recovers transient failures within maxAttempts", async () => {
  let callCount = 0;
  const result = await executeWithRetry(
    async (attempt) => {
      callCount++;
      if (attempt < 2) {
        throw { status: 503, message: "Service temporarily unavailable" };
      }
      return "recovered_success";
    },
    { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 50 },
  );
  assert.equal(result, "recovered_success");
  assert.equal(callCount, 2);
});

test("executeWithRetry: immediately halts on permanent auth error without retrying", async () => {
  let callCount = 0;
  await assert.rejects(
    async () => {
      await executeWithRetry(
        async () => {
          callCount++;
          throw { status: 401, message: "Invalid API key" };
        },
        { maxAttempts: 3, baseDelayMs: 10 },
      );
    },
    (err) => {
      assert.equal(err.status, 401);
      return true;
    },
  );
  assert.equal(callCount, 1, "Must not retry permanent auth error");
});

// ============================================================================
// 4. Capability Registry
// ============================================================================

test("capability registry: verifies Gemini reasoning and function calling", () => {
  assert.ok(hasCapability("gemini-3.5-flash-lite", "function_calling"));
  assert.ok(hasCapability("gemini-3.5-flash-lite", "reasoning"));
  assert.ok(!hasCapability("gemini-3.5-flash-lite", "image_generation"));

  assert.throws(
    () => validateModelCapability("gemini-3.5-flash-lite", "image_generation"),
    UnsupportedModelCapabilityError,
  );
});

test("capability registry: verifies Imagen supports image generation only", () => {
  assert.ok(hasCapability("imagen-3.0-generate-002", "image_generation"));
  assert.ok(!hasCapability("imagen-3.0-generate-002", "function_calling"));

  assert.throws(
    () => validateModelCapability("imagen-3.0-generate-002", "function_calling"),
    UnsupportedModelCapabilityError,
  );
});

test("capability registry: getCapableModelFor routes capabilities accurately", () => {
  const reasoningModel = getCapableModelFor("reasoning");
  assert.ok(reasoningModel.includes("gemini"));

  const imageModel = getCapableModelFor("image_generation");
  assert.ok(imageModel.includes("imagen") || imageModel.includes("image"));
});

// ============================================================================
// 5. Fault Isolation & Degradation
// ============================================================================

test("fault isolation: isolateResearchFailure produces transparent discovery notice", () => {
  const result = isolateResearchFailure("cold brew market trends", "google", "DNS timeout");
  assert.equal(result.success, true);
  assert.equal(result.isLimited, true);
  assert.ok(result.output.includes("Limited Discovery Mode"));
  assert.ok(result.output.includes("DNS timeout"));
});

test("fault isolation: isolateImageGenerationFailure preserves text content and attaches notice", () => {
  const copy = "Here is the 7-day Cold Brew Instagram copy with hashtags #ColdBrew #CoffeeArt";
  const result = isolateImageGenerationFailure(copy, "Quota limit reached on Imagen");
  assert.ok(result.preservedOutput.includes(copy));
  assert.ok(result.preservedOutput.includes("Visual Asset Notice"));
  assert.equal(result.imageStatus, "failed_isolated");
});

test("fault isolation: formatResilientDependencyContext shields completed upstream work", () => {
  const prerequisites = [
    { id: 1, title: "Market Research", response: "Found 3 competitor benchmarks.", status: "completed", error: null },
    { id: 2, title: "Visual Assets", response: null, status: "failed", error: "Image provider quota exhausted" },
  ];
  const { contextText, hasIncompletePrerequisites, missingPrerequisiteIds } = formatResilientDependencyContext(prerequisites);
  assert.ok(contextText.includes("Found 3 competitor benchmarks."));
  assert.ok(contextText.includes("Visual Assets (UNAVAILABLE: Image provider quota exhausted)"));
  assert.equal(hasIncompletePrerequisites, true);
  assert.deepEqual(missingPrerequisiteIds, [2]);
});

// ============================================================================
// 6. Deliverable Verification
// ============================================================================

test("deliverable verification: rejects empty task response before completion", () => {
  const result = verifyTaskCompletionDeliverables("seat-1", "   ", 0);
  assert.equal(result.isDeliverableValid, false);
});

test("deliverable verification: accepts verified research findings or artifacts", () => {
  const result = verifyTaskCompletionDeliverables("seat-1", "Extensive research report with 5 citations and metrics.", 1);
  assert.equal(result.isDeliverableValid, true);
});

// ============================================================================
// 7. Recovery Coordinator
// ============================================================================

test("recovery coordinator: issues retry directive for transient 503 error", async () => {
  const decision = await coordinateRecovery({
    taskId: 999,
    agentId: "seat-1",
    campaignId: 1,
    attempt: 1,
    maxAttempts: 3,
    error: { status: 503, message: "Backend temporarily overloaded" },
  });
  assert.equal(decision.action, "retry");
  assert.equal(decision.attempt, 2);
});

test("recovery coordinator: issues degrade directive for Content Creator with preserved copy", async () => {
  const decision = await coordinateRecovery({
    taskId: 999,
    agentId: "seat-mvj4q0fn",
    campaignId: 1,
    attempt: 3,
    maxAttempts: 3,
    error: new Error("ImageKit upload failed with HTTP 500"),
    currentOutput: "Instagram Reel Caption: The Secret to Velvet Cold Brew. Hashtags: #Coffee #ColdBrew",
  });
  assert.equal(decision.action, "degrade");
  assert.ok(decision.partialDeliverable.includes("The Secret to Velvet Cold Brew"));
});

test("recovery coordinator: formats human explanations over opaque provider_error", () => {
  const explanation = formatHumanReadableExplanation("gemini_rate_limited");
  assert.ok(explanation.includes("Gemini API rate limit reached"));
  assert.ok(!explanation.includes("provider_error"));
});

