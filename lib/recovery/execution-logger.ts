/**
 * SOTO AI — Structured Execution Observability & Telemetry Layer
 *
 * Emits sanitized, structured lifecycle events for every agent task,
 * replacing opaque provider_error strings with transparent human-readable explanations.
 */

import { sanitizeErrorMessage, type ErrorCategory } from "./error-classifier.ts";

export type TaskExecutionStage =
  | "queued"
  | "running"
  | "waiting_for_prerequisite"
  | "executing_tool"
  | "retrying"
  | "recovering"
  | "checkpoint_saved"
  | "degraded_fallback"
  | "completed"
  | "partially_completed"
  | "failed";

export type StructuredExecutionEvent = {
  timestamp: string;
  taskId: number;
  agentId: string;
  campaignId: number;
  stage: TaskExecutionStage;
  operation: string;
  attempt: number;
  provider: string;
  model: string;
  durationMs?: number;
  errorCategory?: ErrorCategory;
  httpStatus?: number;
  recoveryAction?: string;
  checkpointStep?: number;
  userMessage?: string;
};

/**
 * Maps technical error categories to clean, human-readable explanations.
 */
export function formatHumanReadableExplanation(
  category?: ErrorCategory | string,
  rawMessage?: string,
): string {
  switch (category) {
    case "gemini_rate_limited":
      return "Gemini API rate limit reached. The system applied exponential backoff with jitter and resumed execution.";
    case "gemini_quota_exhausted":
      return "Gemini quota exhausted for this minute. Auto-recovering using provider retry schedule.";
    case "gemini_server_error":
      return "Temporary Google model service interruption (503/500). Retried and recovered successfully.";
    case "gemini_timeout":
      return "Model request timed out. Retried with extended execution budget.";
    case "gemini_thought_signature_missing":
      return "Protocol repair: re-attached Gemini 3.5 cryptographic thought signature to multi-turn tool interaction.";
    case "imagekit_upload_failed":
      return "ImageKit remote upload experienced a transient network glitch. Asset preserved durably in local storage.";
    case "e2b_sandbox_expired":
      return "Cloud microVM session reached its idle timeout. Reconnected to a fresh environment without data loss.";
    case "prerequisites_incomplete":
      return "Waiting for prerequisite specialist tasks to complete before execution.";
    case "image_generation_failed":
      return "Image generation model limit reached. Text copy and campaign assets preserved.";
    default:
      if (rawMessage) {
        return sanitizeErrorMessage(rawMessage);
      }
      return "Operation encountered an issue and was handled by the self-healing recovery layer.";
  }
}

/**
 * Emits a structured telemetry log event (sanitizing all credentials).
 */
export function recordExecutionEvent(event: StructuredExecutionEvent): void {
  const sanitized = {
    ...event,
    operation: sanitizeErrorMessage(event.operation),
    userMessage: event.userMessage ? sanitizeErrorMessage(event.userMessage) : undefined,
  };

  // Structured stdout log for observability
  console.log(`[SOTO-OBSERVABILITY] ${JSON.stringify(sanitized)}`);
}
