/**
 * SOTO AI Image Generation Architecture Types
 *
 * Provides typed requests, structured results, and error classes for
 * future image-generation model integration.
 *
 * NOTE: No image generation model is currently selected or integrated.
 * This module establishes strict interfaces and validation boundaries.
 */

export type ImageAspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
export type ImageStylePreset =
  | "photorealistic"
  | "digital-art"
  | "minimalist"
  | "illustration"
  | "brand-graphic";
export type ImageOutputFormat = "image/png" | "image/jpeg" | "image/webp";

export interface ImageRequestContext {
  authUserId: string;
  campaignId: number;
  taskId?: number;
  agentId?: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: ImageAspectRatio;
  stylePreset?: ImageStylePreset;
  referenceImageBase64?: string;
  outputFormat?: ImageOutputFormat;
  context: ImageRequestContext;
}

export interface ImageGenerationResult {
  verified: boolean;
  imageBytes: Uint8Array;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  storageReference?: string;
  promptUsed: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Error Hierarchy
// ---------------------------------------------------------------------------

export class ImageGenerationError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "ImageGenerationError";
    this.code = code;
  }
}

export class ImageProviderNotConfiguredError extends ImageGenerationError {
  constructor(
    message = "Image generation provider is not configured. Model selection and provider integration will occur in a separate phase.",
  ) {
    super(message, "PROVIDER_NOT_CONFIGURED");
    this.name = "ImageProviderNotConfiguredError";
  }
}

export class InvalidImageRequestError extends ImageGenerationError {
  constructor(message: string) {
    super(message, "INVALID_REQUEST");
    this.name = "InvalidImageRequestError";
  }
}

export class UnsupportedImageOperationError extends ImageGenerationError {
  constructor(message: string) {
    super(message, "UNSUPPORTED_OPERATION");
    this.name = "UnsupportedImageOperationError";
  }
}

export class ImageGenerationFailedError extends ImageGenerationError {
  readonly causeError?: unknown;
  constructor(message: string, causeError?: unknown) {
    super(message, "GENERATION_FAILED");
    this.name = "ImageGenerationFailedError";
    this.causeError = causeError;
  }
}
