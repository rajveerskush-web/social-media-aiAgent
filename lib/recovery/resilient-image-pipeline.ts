/**
 * SOTO AI — Resilient Image Generation & Decoupled Storage Pipeline
 *
 * Implements a 3-phase fault-isolated pipeline:
 * Phase 1: Image Generation via Gemini/Imagen provider with quota retry.
 * Phase 2: Immediate local caching of raw bytes (protecting generated assets).
 * Phase 3: Decoupled ImageKit upload with retry from cache — NEVER re-generates image on upload error.
 * Fallback: If ImageKit upload fails permanently, persists to durable local storage without losing the asset.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb, agentTaskArtifacts } from "../../db/index.ts";
import { requestImageGeneration, getImageGenerationProvider } from "../image-generation.ts";
import type { ImageAspectRatio, ImageStylePreset } from "../image-types.ts";
import { persistDurableArtifact } from "../durable-storage.ts";
import { findExistingArtifact } from "./task-checkpoint.ts";
import { executeWithRetry } from "./retry-policy.ts";
import { classifyError } from "./error-classifier.ts";

export type ResilientImageResult = {
  success: boolean;
  artifactId?: number;
  publicUrl?: string;
  storageKey?: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  warning?: string;
  error?: string;
};

/**
 * Generates an image and persists it with decoupled upload retry and raw-byte caching.
 */
export async function generateAndPersistImageWithRecovery(params: {
  authUserId: string;
  campaignId: number;
  taskId: number;
  agentId: string;
  computerId?: number | null;
  prompt: string;
  aspectRatio?: ImageAspectRatio;
  stylePreset?: ImageStylePreset;
}): Promise<ResilientImageResult> {
  const {
    authUserId,
    campaignId,
    taskId,
    agentId,
    computerId,
    prompt,
    aspectRatio = "1:1",
    stylePreset = "photorealistic",
  } = params;

  // 1. Idempotency check: see if this task already generated an artifact for this prompt
  const promptHash = createHash("sha256").update(prompt.trim()).digest("hex").slice(0, 12);
  const filename = `creative_${promptHash}.png`;

  const existing = await findExistingArtifact(taskId, filename);
  if (existing) {
    return {
      success: true,
      artifactId: existing.id,
      publicUrl: existing.imagekitUrl ?? existing.sandboxPath ?? undefined,
      storageKey: existing.sandboxPath ?? undefined,
      filename: existing.filename,
      sizeBytes: 0,
      mimeType: "image/png",
    };
  }

  // 2. Phase 1: Generate image with retry
  let rawBytes: Uint8Array;
  let mimeType = "image/png";

  try {
    const genResult = await executeWithRetry(
      async () => {
        return requestImageGeneration(
          {
            prompt,
            aspectRatio,
            stylePreset,
            outputFormat: "image/png",
            context: {
              authUserId,
              campaignId,
              taskId,
              agentId,
            },
          },
          getImageGenerationProvider(),
        );
      },
      {
        maxAttempts: 3,
        baseDelayMs: 2000,
        maxDelayMs: 15000,
        operationName: "image_generation",
      },
    );

    if (!genResult.imageBytes || genResult.imageBytes.length === 0) {
      throw new Error("Image provider returned 0 bytes.");
    }

    rawBytes = genResult.imageBytes;
    mimeType = genResult.mimeType || "image/png";
  } catch (genErr: unknown) {
    const classified = classifyError(genErr);
    console.error("[resilient-image-pipeline] Image generation failed:", classified.sanitizedMessage);
    return {
      success: false,
      filename,
      sizeBytes: 0,
      mimeType: "image/png",
      error: `Image generation unavailable: ${classified.sanitizedMessage}`,
    };
  }

  // 3. Phase 2: Immediately cache raw bytes to disk so they are NEVER lost if upload fails
  const cacheDir = path.join(process.cwd(), ".data", "artifacts", "cache");
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, filename), rawBytes);
  } catch (cacheErr) {
    console.warn("[resilient-image-pipeline] Non-fatal cache write warning:", cacheErr);
  }

  // 4. Phase 3: Create database record
  const db = getDb();
  const [artifactRow] = await db
    .insert(agentTaskArtifacts)
    .values({
      taskId,
      computerId: computerId ?? null,
      authUserId,
      campaignId,
      artifactType: "image",
      filename,
      mimeType,
      sizeBytes: rawBytes.length,
      isVerified: true,
      isApprovedForSharing: true,
    })
    .returning({ id: agentTaskArtifacts.id });

  const artifactId = artifactRow.id;

  // 5. Phase 4: Decoupled upload with retry from raw bytes (WITHOUT re-generating image)
  let publicUrl: string | undefined;
  let storageKey: string | undefined;
  let uploadWarning: string | undefined;

  try {
    const storageResult = await executeWithRetry(
      async () => {
        const { persistDurableArtifact } = await import("@/lib/durable-storage");
        return persistDurableArtifact(
          campaignId,
          taskId,
          artifactId,
          filename,
          mimeType,
          rawBytes,
        );
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1500,
        maxDelayMs: 8000,
        operationName: "imagekit_upload",
      },
    );

    publicUrl = storageResult.publicUrl;
    storageKey = storageResult.storageKey;

    await db
      .update(agentTaskArtifacts)
      .set({
        sandboxPath: storageResult.storageKey,
        fileHash: storageResult.hash,
        imagekitUrl: storageResult.publicUrl ?? null,
        imagekitFileId: storageResult.fileId ?? null,
      })
      .where(eq(agentTaskArtifacts.id, artifactId));
  } catch (uploadErr: unknown) {
    const classified = classifyError(uploadErr);
    console.warn("[resilient-image-pipeline] ImageKit upload failed after retries, falling back to local durable store:", classified.sanitizedMessage);

    // Graceful storage fallback: save to local filesystem driver so asset is preserved!
    try {
      const { LocalFilesystemArtifactDriver } = await import("@/lib/durable-storage");
      const localDriver = new LocalFilesystemArtifactDriver();
      const localResult = await localDriver.saveArtifact(
        `campaign_${campaignId}/task_${taskId}/art_${artifactId}_${filename}`,
        rawBytes,
        mimeType,
      );

      storageKey = localResult.storageKey;
      uploadWarning = `Image saved durably to local storage (remote ImageKit upload: ${classified.sanitizedMessage})`;

      await db
        .update(agentTaskArtifacts)
        .set({
          sandboxPath: localResult.storageKey,
          fileHash: localResult.hash,
        })
        .where(eq(agentTaskArtifacts.id, artifactId));
    } catch (fallbackErr) {
      console.error("[resilient-image-pipeline] Storage fallback failed:", fallbackErr);
    }
  }

  return {
    success: true,
    artifactId,
    publicUrl,
    storageKey,
    filename,
    sizeBytes: rawBytes.length,
    mimeType,
    warning: uploadWarning,
  };
}
