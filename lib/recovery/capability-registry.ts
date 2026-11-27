/**
 * SOTO AI — Central Model & Provider Capability Registry
 *
 * Ensures models are strictly validated against required capabilities before invocation.
 * Disallows text/reasoning models from being called for image generation,
 * and image generation models from being called for function calling / agent reasoning.
 */

export type ModelCapability =
  | "reasoning"
  | "function_calling"
  | "structured_output"
  | "multimodal_input"
  | "image_generation"
  | "image_editing"
  | "computer_use";

export type ModelMetadata = {
  modelId: string;
  provider: "google";
  displayName: string;
  capabilities: ReadonlySet<ModelCapability>;
  maxContextTokens: number;
  supportsStreaming: boolean;
  isDefaultReasoningModel?: boolean;
  isDefaultImageModel?: boolean;
};

const REGISTERED_MODELS: Record<string, ModelMetadata> = {
  "gemini-3.5-flash-lite": {
    modelId: "gemini-3.5-flash-lite",
    provider: "google",
    displayName: "Gemini 3.5 Flash Lite",
    capabilities: new Set(["reasoning", "function_calling", "structured_output", "multimodal_input", "computer_use"]),
    maxContextTokens: 1_000_000,
    supportsStreaming: true,
    isDefaultReasoningModel: true,
  },
  "gemini-2.5-flash": {
    modelId: "gemini-2.5-flash",
    provider: "google",
    displayName: "Gemini 2.5 Flash",
    capabilities: new Set(["reasoning", "function_calling", "structured_output", "multimodal_input", "computer_use"]),
    maxContextTokens: 1_000_000,
    supportsStreaming: true,
  },
  "gemini-2.5-pro": {
    modelId: "gemini-2.5-pro",
    provider: "google",
    displayName: "Gemini 2.5 Pro",
    capabilities: new Set(["reasoning", "function_calling", "structured_output", "multimodal_input", "computer_use"]),
    maxContextTokens: 2_000_000,
    supportsStreaming: true,
  },
  "gemini-1.5-flash": {
    modelId: "gemini-1.5-flash",
    provider: "google",
    displayName: "Gemini 1.5 Flash",
    capabilities: new Set(["reasoning", "function_calling", "structured_output", "multimodal_input", "computer_use"]),
    maxContextTokens: 1_000_000,
    supportsStreaming: true,
  },
  "imagen-3.0-generate-002": {
    modelId: "imagen-3.0-generate-002",
    provider: "google",
    displayName: "Imagen 3.0",
    capabilities: new Set(["image_generation"]),
    maxContextTokens: 2048,
    supportsStreaming: false,
    isDefaultImageModel: true,
  },
  "nano-banana-2.1": {
    modelId: "nano-banana-2.1",
    provider: "google",
    displayName: "Nano Banana 2.1 (Image Generation)",
    capabilities: new Set(["image_generation"]),
    maxContextTokens: 2048,
    supportsStreaming: false,
  },
};

export class UnsupportedModelCapabilityError extends Error {
  readonly modelId: string;
  readonly requiredCapability: ModelCapability;
  readonly availableCapabilities: string[];

  constructor(
    modelId: string,
    requiredCapability: ModelCapability,
    availableCapabilities: string[],
  ) {
    super(
      `Model "${modelId}" does not support required capability "${requiredCapability}". Available capabilities: [${availableCapabilities.join(", ")}].`,
    );
    this.name = "UnsupportedModelCapabilityError";
    this.modelId = modelId;
    this.requiredCapability = requiredCapability;
    this.availableCapabilities = availableCapabilities;
  }
}

/**
 * Validates that a model supports the requested capability.
 * Throws UnsupportedModelCapabilityError if incompatible.
 */
export function validateModelCapability(modelId: string, requiredCapability: ModelCapability): ModelMetadata {
  const metadata = REGISTERED_MODELS[modelId];

  // If model is unknown, check if it follows a recognizable naming pattern
  if (!metadata) {
    if (modelId.toLowerCase().includes("imagen") || modelId.toLowerCase().includes("image") || modelId.toLowerCase().includes("banana")) {
      if (requiredCapability === "function_calling" || requiredCapability === "reasoning") {
        throw new UnsupportedModelCapabilityError(modelId, requiredCapability, ["image_generation"]);
      }
      return {
        modelId,
        provider: "google",
        displayName: modelId,
        capabilities: new Set(["image_generation"]),
        maxContextTokens: 2048,
        supportsStreaming: false,
      };
    }

    // Default assume Gemini reasoning model
    if (requiredCapability === "image_generation") {
      throw new UnsupportedModelCapabilityError(modelId, requiredCapability, ["reasoning", "function_calling"]);
    }
    return {
      modelId,
      provider: "google",
      displayName: modelId,
      capabilities: new Set(["reasoning", "function_calling", "structured_output", "multimodal_input"]),
      maxContextTokens: 1_000_000,
      supportsStreaming: true,
    };
  }

  if (!metadata.capabilities.has(requiredCapability)) {
    throw new UnsupportedModelCapabilityError(
      modelId,
      requiredCapability,
      Array.from(metadata.capabilities),
    );
  }

  return metadata;
}

/**
 * Returns the best capable model for a required capability.
 */
export function getCapableModelFor(capability: ModelCapability, fallbackModel?: string): string {
  if (capability === "image_generation") {
    return process.env.GEMINI_IMAGE_MODEL || "imagen-3.0-generate-002";
  }

  if (fallbackModel && hasCapability(fallbackModel, capability)) {
    return fallbackModel;
  }

  return process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
}

/**
 * Helper to check capability without throwing.
 */
export function hasCapability(modelId: string, capability: ModelCapability): boolean {
  try {
    validateModelCapability(modelId, capability);
    return true;
  } catch {
    return false;
  }
}
