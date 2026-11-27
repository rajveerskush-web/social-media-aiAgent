import assert from "node:assert/strict";
import test from "node:test";
import {
  DefaultUnconfiguredImageProvider,
  getImageGenerationProvider,
  requestImageGeneration,
  setImageGenerationProvider,
  validateImageGenerationRequest,
} from "../lib/image-generation.ts";
import {
  ImageGenerationFailedError,
  ImageProviderNotConfiguredError,
  InvalidImageRequestError,
  UnsupportedImageOperationError,
} from "../lib/image-types.ts";

const validContext = {
  authUserId: "user-alpha",
  campaignId: 101,
  taskId: 501,
  agentId: "seat-mvj4q0fn", // Content Specialist
};

// ---------------------------------------------------------------------------
// 1. Request Validation Tests
// ---------------------------------------------------------------------------

test("validateImageGenerationRequest accepts valid prompt, aspect ratio, and context", () => {
  const req = {
    prompt: "A modern glass office overlooking a cyberpunk city at sunset",
    negativePrompt: "blurry, low quality, distorted",
    aspectRatio: "16:9",
    stylePreset: "photorealistic",
    outputFormat: "image/png",
    context: validContext,
  };

  const validated = validateImageGenerationRequest(req);
  assert.equal(validated.prompt, req.prompt);
  assert.equal(validated.aspectRatio, "16:9");
  assert.equal(validated.stylePreset, "photorealistic");
  assert.equal(validated.outputFormat, "image/png");
  assert.equal(validated.context.authUserId, "user-alpha");
  assert.equal(validated.context.campaignId, 101);
});

test("validateImageGenerationRequest rejects missing or whitespace prompts", () => {
  assert.throws(
    () => validateImageGenerationRequest({ prompt: "", context: validContext }),
    InvalidImageRequestError,
  );
  assert.throws(
    () => validateImageGenerationRequest({ prompt: "   ", context: validContext }),
    InvalidImageRequestError,
  );
  assert.throws(
    () => validateImageGenerationRequest({ context: validContext }),
    InvalidImageRequestError,
  );
});

test("validateImageGenerationRequest rejects prompts exceeding 2000 chars", () => {
  const longPrompt = "a".repeat(2001);
  assert.throws(
    () => validateImageGenerationRequest({ prompt: longPrompt, context: validContext }),
    InvalidImageRequestError,
  );
});

test("validateImageGenerationRequest rejects unsupported aspect ratios", () => {
  assert.throws(
    () =>
      validateImageGenerationRequest({
        prompt: "Valid prompt",
        aspectRatio: "21:9", // Unsupported
        context: validContext,
      }),
    UnsupportedImageOperationError,
  );
});

test("validateImageGenerationRequest rejects unsupported output formats", () => {
  assert.throws(
    () =>
      validateImageGenerationRequest({
        prompt: "Valid prompt",
        outputFormat: "image/bmp", // Unsupported
        context: validContext,
      }),
    UnsupportedImageOperationError,
  );
});

test("validateImageGenerationRequest rejects missing or invalid context", () => {
  assert.throws(
    () => validateImageGenerationRequest({ prompt: "Valid prompt" }),
    InvalidImageRequestError,
  );
  assert.throws(
    () =>
      validateImageGenerationRequest({
        prompt: "Valid prompt",
        context: { authUserId: "" },
      }),
    InvalidImageRequestError,
  );
});

// ---------------------------------------------------------------------------
// 2. Missing Provider & Unconfigured State Tests
// ---------------------------------------------------------------------------

test("requestImageGeneration safely throws ImageProviderNotConfiguredError without active provider", async () => {
  const unconfigured = new DefaultUnconfiguredImageProvider();
  assert.equal(unconfigured.isConfigured, false);
  assert.equal(unconfigured.providerId, "none");

  await assert.rejects(
    async () =>
      requestImageGeneration(
        { prompt: "Generate product photo", context: validContext },
        unconfigured,
      ),
    ImageProviderNotConfiguredError,
  );
});

test("default global provider throws ImageProviderNotConfiguredError and does NOT call paid APIs", async () => {
  setImageGenerationProvider(new DefaultUnconfiguredImageProvider());

  await assert.rejects(
    async () =>
      requestImageGeneration({
        prompt: "Summer marketing banner",
        context: validContext,
      }),
    ImageProviderNotConfiguredError,
  );
});

// ---------------------------------------------------------------------------
// 3. Provider Integration & Truthful Outcome Validation Tests
// ---------------------------------------------------------------------------

test("requestImageGeneration verifies actual image bytes and rejects empty/fake provider results", async () => {
  // Mock a faulty provider that returns 0 bytes
  const mockEmptyProvider = {
    providerId: "test-empty-provider",
    isConfigured: true,
    async generateImage(req) {
      return {
        verified: false,
        imageBytes: new Uint8Array([]), // Empty bytes!
        mimeType: "image/png",
        sizeBytes: 0,
        promptUsed: req.prompt,
        createdAt: new Date().toISOString(),
      };
    },
  };

  await assert.rejects(
    async () =>
      requestImageGeneration(
        { prompt: "Test prompt", context: validContext },
        mockEmptyProvider,
      ),
    ImageGenerationFailedError,
  );
});

test("requestImageGeneration returns verified result when mock provider yields real bytes", async () => {
  const fakePngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic bytes
  const mockValidProvider = {
    providerId: "test-valid-mock-provider",
    isConfigured: true,
    async generateImage(req) {
      return {
        verified: true,
        imageBytes: fakePngBytes,
        mimeType: "image/png",
        sizeBytes: fakePngBytes.byteLength,
        width: 1024,
        height: 1024,
        promptUsed: req.prompt,
        createdAt: new Date().toISOString(),
      };
    },
  };

  const result = await requestImageGeneration(
    { prompt: "A minimalist brand logo", context: validContext },
    mockValidProvider,
  );

  assert.equal(result.verified, true);
  assert.equal(result.sizeBytes, 8);
  assert.equal(result.mimeType, "image/png");
  assert.equal(result.width, 1024);
  assert.deepEqual(result.imageBytes, fakePngBytes);
});

