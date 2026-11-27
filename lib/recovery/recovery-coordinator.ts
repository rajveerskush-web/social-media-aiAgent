/**
 * SOTO AI — Central Recovery Coordinator
 *
 * Evaluates any agent failure, determines recovery strategy, orchestrates
 * checkpoint resumption, graceful degradation, and task outcome notifications.
 */

import { classifyError, type ClassifiedError } from "./error-classifier.ts";
import { loadLatestTaskCheckpoint, type TaskCheckpointData } from "./task-checkpoint.ts";
import { formatHumanReadableExplanation, recordExecutionEvent } from "./execution-logger.ts";
import { getCapableModelFor } from "./capability-registry.ts";

export type RecoveryAction =
  | { action: "retry"; delayMs: number; attempt: number; explanation: string }
  | { action: "resume"; checkpoint: TaskCheckpointData; explanation: string }
  | { action: "fallback_model"; model: string; explanation: string }
  | { action: "degrade"; partialDeliverable: string; explanation: string }
  | { action: "terminal_fail"; explanation: string; classifiedError: ClassifiedError };

export type RecoveryDecisionParams = {
  taskId: number;
  agentId: string;
  campaignId: number;
  attempt: number;
  maxAttempts: number;
  error: unknown;
  currentOutput?: string;
};

/**
 * Evaluates an error and issues a recovery directive.
 */
export async function coordinateRecovery(params: RecoveryDecisionParams): Promise<RecoveryAction> {
  const { taskId, agentId, campaignId, attempt, maxAttempts, error, currentOutput } = params;

  const classified = classifyError(error);

  // 1. Permanent non-recoverable errors (e.g. invalid credentials, unauthenticated)
  if (classified.severity === "permanent" || classified.category === "gemini_auth_failure") {
    const explanation = formatHumanReadableExplanation(classified.category, classified.sanitizedMessage);
    recordExecutionEvent({
      timestamp: new Date().toISOString(),
      taskId,
      agentId,
      campaignId,
      stage: "failed",
      operation: "recovery_evaluation",
      attempt,
      provider: "recovery_coordinator",
      model: "none",
      errorCategory: classified.category,
      httpStatus: classified.httpStatus,
      userMessage: explanation,
    });
    return { action: "terminal_fail", explanation, classifiedError: classified };
  }

  // 2. Check for intermediate checkpoints
  const checkpoint = await loadLatestTaskCheckpoint(taskId);
  if (checkpoint && checkpoint.stepIndex > 0 && attempt < maxAttempts) {
    const explanation = `Resuming from step ${checkpoint.stepIndex} with ${checkpoint.completedTools.length} completed actions.`;
    recordExecutionEvent({
      timestamp: new Date().toISOString(),
      taskId,
      agentId,
      campaignId,
      stage: "recovering",
      operation: "resume_checkpoint",
      attempt,
      provider: "recovery_coordinator",
      model: "none",
      checkpointStep: checkpoint.stepIndex,
      userMessage: explanation,
    });
    return { action: "resume", checkpoint, explanation };
  }

  // 3. Model unavailable / capability mismatch -> fallback to verified capable model
  if (classified.category === "gemini_model_not_found" || classified.category === "gemini_unsupported_capability") {
    const fallback = getCapableModelFor("reasoning");
    const explanation = `Configured model unavailable. Routing to verified capable model: ${fallback}.`;
    return { action: "fallback_model", model: fallback, explanation };
  }

  // 4. Content Creator image generation failure with preserved text copy
  if (agentId === "seat-mvj4q0fn" && currentOutput && currentOutput.trim().length > 30) {
    if (classified.domain === "image_generation" || classified.domain === "imagekit") {
      const explanation = formatHumanReadableExplanation(classified.category, classified.sanitizedMessage);
      return {
        action: "degrade",
        partialDeliverable: currentOutput,
        explanation: `Creative text copy, captions, and hashtags preserved. (${explanation})`,
      };
    }
  }

  // 5. Transient retries (under max attempts budget)
  if (classified.isTransient && attempt < maxAttempts) {
    const delayMs = classified.retryAfterMs ?? Math.min(10000, 1000 * 2 ** (attempt - 1));
    const explanation = `Transient issue (${classified.category}). Retrying with backoff (attempt ${attempt + 1}/${maxAttempts}).`;
    recordExecutionEvent({
      timestamp: new Date().toISOString(),
      taskId,
      agentId,
      campaignId,
      stage: "retrying",
      operation: "coordinate_retry",
      attempt: attempt + 1,
      provider: "recovery_coordinator",
      model: "none",
      errorCategory: classified.category,
      httpStatus: classified.httpStatus,
      userMessage: explanation,
    });
    return { action: "retry", delayMs, attempt: attempt + 1, explanation };
  }

  // 6. Max attempts reached or non-recoverable
  const explanation = formatHumanReadableExplanation(classified.category, classified.sanitizedMessage);
  recordExecutionEvent({
    timestamp: new Date().toISOString(),
    taskId,
    agentId,
    campaignId,
    stage: "failed",
    operation: "recovery_exhausted",
    attempt,
    provider: "recovery_coordinator",
    model: "none",
    errorCategory: classified.category,
    httpStatus: classified.httpStatus,
    userMessage: explanation,
  });

  return { action: "terminal_fail", explanation, classifiedError: classified };
}
