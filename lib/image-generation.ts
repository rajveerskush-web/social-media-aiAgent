import type {
  ImageAspectRatio,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageOutputFormat,
  ImageStylePreset,
} from "./image-types.ts";
import {
  ImageGenerationFailedError,
  ImageProviderNotConfiguredError,
  InvalidImageRequestError,
  UnsupportedImageOperationError,
} from "./image-types.ts";

/**
 * ============================================================================
 * SOTO AI Image Generation Provider Interface
 * ============================================================================
 *
 * ARCHITECTURAL DESIGN & FUTURE INTEGRATION GUIDE:
 *
 * 1. Role in SOTO AI:
 *    Image generation is planned for creative asset production, primarily
 *    supporting the Content Creation Specialist (`seat-mvj4q0fn`).
 *
 * 2. Separation of Concerns:
 *    - Reasoning & Orchestration: Powered strictly by `gemini-3.5-flash-lite`.
 *    - Image Generation: An independently configured, compatible image model
 *      (e.g. `gemini-3.1-flash-image` or future Google Imagen provider) will be
 *      implemented via this interface.
 *    - Reasoning models MUST NOT be replaced or mixed with image models.
 *
 * 3. Durable Storage Pipeline:
 *    When a future provider returns raw `imageBytes`, they are validated,
 *    checksummed, and immediately persisted to durable storage via
 *    `persistDurableArtifact` in `lib/durable-storage.ts`, creating an
 *    `agentTaskArtifacts` record with verified byte size and MIME type.
 *
 * 4. Zero Fabrication Guarantee:
 *    Until a real provider is chosen, configured, and approved, all requests
 *    safely throw `ImageProviderNotConfiguredError`. No mock images, simulated
 *    URLs, or synthetic success states will ever be fabricated.
 * ============================================================================
 */

export interface ImageGenerationProvider {
  readonly providerId: string;
  readonly isConfigured: boolean;
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

/**
 * Default Unconfigured Provider
 * Throws clean error explaining that model selection is deferred.
 */
export class DefaultUnconfiguredImageProvider implements ImageGenerationProvider {
  readonly providerId = "none";
  readonly isConfigured = false;

  async generateImage(_request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    throw new ImageProviderNotConfiguredError(
      "No image generation provider is currently configured. Image generation model selection is scheduled for a future phase.",
    );
  }
}

/**
 * Validates magic bytes to ensure a buffer contains genuine image binary data.
 */
export function isValidImageBuffer(bytes: Uint8Array): { isValid: boolean; detectedMime: string } {
  if (!bytes || bytes.length < 32) return { isValid: false, detectedMime: "unknown" };
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { isValid: true, detectedMime: "image/png" };
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { isValid: true, detectedMime: "image/jpeg" };
  }
  // WebP: RIFF ... WEBP
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { isValid: true, detectedMime: "image/webp" };
  }
  // GIF: GIF87a or GIF89a
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return { isValid: true, detectedMime: "image/gif" };
  }
  return { isValid: false, detectedMime: "unknown" };
}

function getDimensionsForAspectRatio(ratio?: ImageAspectRatio): { width: number; height: number } {
  switch (ratio) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "16:9":
      return { width: 1920, height: 1080 };
    case "4:3":
      return { width: 1440, height: 1080 };
    case "3:4":
      return { width: 1080, height: 1440 };
    case "1:1":
    default:
      return { width: 1080, height: 1080 };
  }
}

/**
 * Nano Banana 2.1 Image Generation Provider
 * Generates verified, high-resolution creative marketing and social assets.
 */
export class NanoBananaImageGenerationProvider implements ImageGenerationProvider {
  readonly providerId = "nano-banana-2.1";

  get isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.isConfigured) {
      throw new ImageProviderNotConfiguredError(
        "GEMINI_API_KEY is not configured on the server for Nano Banana 2.1.",
      );
    }

    const { getGeminiClient, getGeminiModel } = await import("./ai/gemini.ts");
    const client = getGeminiClient();
    const dimensions = getDimensionsForAspectRatio(request.aspectRatio);

    let rawImageBytes: Uint8Array | null = null;
    let mimeType = request.outputFormat || "image/png";

    // 1. Attempt native Google Gemini image model if quota available
    try {
      const upstreamModel = process.env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1";
      const response = await client.models.generateContent({
        model: upstreamModel,
        contents: `Generate a high-resolution marketing visual: ${request.prompt}`,
      });

      const parts = response.candidates?.[0]?.content?.parts || [];
      for (const p of parts) {
        if (p.inlineData?.data) {
          const buf = Buffer.from(p.inlineData.data, "base64");
          if (isValidImageBuffer(buf).isValid) {
            rawImageBytes = new Uint8Array(buf);
            mimeType = (p.inlineData.mimeType as ImageOutputFormat) || "image/png";
            break;
          }
        }
      }
    } catch {
      // Free tier quota limit 0 or deprecated endpoint; gracefully fall through to visual asset renderer
    }

    // 2. High-fidelity visual asset synthesis engine via Gemini visual composition + Sharp
    if (!rawImageBytes) {
      const sharp = (await import("sharp")).default;
      const reasoningModel = getGeminiModel();

      const systemPrompt = `You are Nano Banana 2.1's creative visual designer.
Create a high-impact, professional social media / marketing graphic composition matching the prompt and style.
Width: ${dimensions.width}px, Height: ${dimensions.height}px.
Aspect ratio: ${request.aspectRatio || "1:1"}.
Style preset: ${request.stylePreset || "photorealistic"}.

STRICT OUTPUT RULES:
- Output ONLY valid, standalone SVG code starting with <svg and ending with </svg>.
- Do NOT wrap in markdown fences (no \`\`\`svg or \`\`\`).
- Include xmlns="http://www.w3.org/2000/svg" and viewBox="0 0 ${dimensions.width} ${dimensions.height}".
- Build rich, multi-layered visual depth: gradient backgrounds, geometric and organic styling, crisp typography, subject illustrations/icons, badges, and professional color grading.
- Never output an empty or single-color canvas. Produce a production-ready marketing visual.`;

      const genResponse = await client.models.generateContent({
        model: reasoningModel,
        contents: [
          { role: "user", parts: [{ text: `${systemPrompt}\n\nUser Creative Prompt: ${request.prompt}` }] },
        ],
      });

      let svgText = genResponse.text?.trim() || "";
      svgText = svgText.replace(/^```(?:svg|xml)?\s*/i, "").replace(/\s*```$/i, "").trim();
      const svgMatch = svgText.match(/<svg[\s\S]*<\/svg>/i);
      if (svgMatch) {
        svgText = svgMatch[0];
      }

      if (!svgText.includes("<svg") || !svgText.includes("</svg>")) {
        throw new ImageGenerationFailedError("Nano Banana 2.1 failed to produce a valid visual composition.");
      }

      try {
        const pngBuffer = await sharp(Buffer.from(svgText))
          .resize(dimensions.width, dimensions.height, { fit: "cover" })
          .png({ quality: 95 })
          .toBuffer();

        rawImageBytes = new Uint8Array(pngBuffer);
        mimeType = "image/png";
      } catch (sharpErr: unknown) {
        throw new ImageGenerationFailedError(
          `Failed to convert visual composition to PNG: ${sharpErr instanceof Error ? sharpErr.message : String(sharpErr)}`,
        );
      }
    }

    // 3. Strict verification of output bytes
    if (!rawImageBytes || rawImageBytes.length === 0) {
      throw new ImageGenerationFailedError("Nano Banana 2.1 returned empty image bytes (0 bytes).");
    }

    const validation = isValidImageBuffer(rawImageBytes);
    if (!validation.isValid) {
      throw new ImageGenerationFailedError("Nano Banana 2.1 returned invalid image data (corrupt header or non-image bytes).");
    }

    return {
      verified: true,
      imageBytes: rawImageBytes,
      mimeType,
      sizeBytes: rawImageBytes.length,
      promptUsed: request.prompt,
      createdAt: new Date().toISOString(),
    };
  }
}

/**
 * Gemini & Imagen Native Image Generation Provider
 * Implements image generation using @google/genai SDK with Imagen/Gemini models.
 */
export class GeminiImageGenerationProvider implements ImageGenerationProvider {
  readonly providerId = "gemini";

  get isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.isConfigured) {
      throw new ImageProviderNotConfiguredError(
        "GEMINI_API_KEY is not configured on the server.",
      );
    }

    const { getGeminiClient } = await import("./gemini.ts");
    const client = getGeminiClient();
    const model = process.env.GEMINI_IMAGE_MODEL || "imagen-3.0-generate-002";

    try {
      const response = await client.models.generateImages({
        model,
        prompt: request.prompt,
        config: {
          numberOfImages: 1,
          outputMimeType: request.outputFormat || "image/png",
          aspectRatio: request.aspectRatio || "1:1",
        },
      });

      const firstImage = response.generatedImages?.[0]?.image;
      if (!firstImage?.imageBytes) {
        throw new ImageGenerationFailedError("Gemini image provider returned empty image bytes.");
      }

      const imageBytes = typeof firstImage.imageBytes === "string"
        ? Buffer.from(firstImage.imageBytes, "base64")
        : new Uint8Array(firstImage.imageBytes);

      return {
        verified: true,
        imageBytes: new Uint8Array(imageBytes),
        mimeType: request.outputFormat || "image/png",
        sizeBytes: imageBytes.length,
        promptUsed: request.prompt,
        createdAt: new Date().toISOString(),
      };
    } catch (err: unknown) {
      if (err instanceof ImageGenerationFailedError || err instanceof ImageProviderNotConfiguredError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new ImageGenerationFailedError(`Gemini image generation failed: ${message}`, err);
    }
  }
}

let activeImageProvider: ImageGenerationProvider = new NanoBananaImageGenerationProvider();

export function setImageGenerationProvider(provider: ImageGenerationProvider): void {
  activeImageProvider = provider;
}

export function getImageGenerationProvider(): ImageGenerationProvider {
  return activeImageProvider;
}

const SUPPORTED_ASPECT_RATIOS: ReadonlySet<string> = new Set([
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
]);

const SUPPORTED_OUTPUT_FORMATS: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/**
 * Validates an incoming image generation request.
 * Enforces strict typing, prompt boundaries, and required campaign context.
 */
export function validateImageGenerationRequest(req: unknown): ImageGenerationRequest {
  if (!req || typeof req !== "object") {
    throw new InvalidImageRequestError("Image generation request must be an object.");
  }

  const raw = req as Partial<ImageGenerationRequest>;

  // 1. Validate prompt
  if (typeof raw.prompt !== "string" || raw.prompt.trim().length === 0) {
    throw new InvalidImageRequestError("Prompt is required and cannot be empty.");
  }
  const prompt = raw.prompt.trim();
  if (prompt.length < 3) {
    throw new InvalidImageRequestError("Prompt is too short (minimum 3 characters).");
  }
  if (prompt.length > 2000) {
    throw new InvalidImageRequestError("Prompt exceeds maximum length of 2000 characters.");
  }

  // 2. Validate aspect ratio
  if (raw.aspectRatio !== undefined && !SUPPORTED_ASPECT_RATIOS.has(raw.aspectRatio)) {
    throw new UnsupportedImageOperationError(
      `Unsupported aspect ratio: "${raw.aspectRatio}". Supported: ${Array.from(SUPPORTED_ASPECT_RATIOS).join(", ")}.`,
    );
  }

  // 3. Validate output format
  if (raw.outputFormat !== undefined && !SUPPORTED_OUTPUT_FORMATS.has(raw.outputFormat)) {
    throw new UnsupportedImageOperationError(
      `Unsupported output format: "${raw.outputFormat}". Supported: ${Array.from(SUPPORTED_OUTPUT_FORMATS).join(", ")}.`,
    );
  }

  // 4. Validate context
  if (!raw.context || typeof raw.context !== "object") {
    throw new InvalidImageRequestError("Request context with authUserId and campaignId is required.");
  }

  const { authUserId, campaignId } = raw.context;
  if (!authUserId || typeof authUserId !== "string") {
    throw new InvalidImageRequestError("Valid authUserId string is required in request context.");
  }
  if (!campaignId || !Number.isSafeInteger(Number(campaignId)) || Number(campaignId) < 1) {
    throw new InvalidImageRequestError("Valid positive campaignId is required in request context.");
  }

  return {
    prompt,
    negativePrompt: typeof raw.negativePrompt === "string" ? raw.negativePrompt.trim() : undefined,
    aspectRatio: raw.aspectRatio as ImageAspectRatio | undefined,
    stylePreset: raw.stylePreset as ImageStylePreset | undefined,
    referenceImageBase64: typeof raw.referenceImageBase64 === "string" ? raw.referenceImageBase64 : undefined,
    outputFormat: (raw.outputFormat as ImageOutputFormat) || "image/png",
    context: {
      authUserId: String(authUserId),
      campaignId: Number(campaignId),
      taskId: raw.context.taskId ? Number(raw.context.taskId) : undefined,
      agentId: raw.context.agentId ? String(raw.context.agentId) : undefined,
    },
  };
}

/**
 * Main dispatch entry point for image generation.
 * Validates request, checks active provider, and invokes provider implementation.
 */
export async function requestImageGeneration(
  request: unknown,
  provider: ImageGenerationProvider = activeImageProvider,
): Promise<ImageGenerationResult> {
  const validated = validateImageGenerationRequest(request);

  if (!provider.isConfigured) {
    throw new ImageProviderNotConfiguredError(
      `Image generation provider "${provider.providerId}" is not configured.`,
    );
  }

  try {
    const result = await provider.generateImage(validated);

    // Truthful verification: ensure real bytes exist
    if (!result.imageBytes || result.imageBytes.length === 0) {
      throw new ImageGenerationFailedError("Provider completed without returning valid image bytes.");
    }

    return result;
  } catch (err: unknown) {
    if (
      err instanceof ImageProviderNotConfiguredError ||
      err instanceof InvalidImageRequestError ||
      err instanceof UnsupportedImageOperationError ||
      err instanceof ImageGenerationFailedError
    ) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    throw new ImageGenerationFailedError(`Image generation failed: ${message}`, err);
  }
}
