/**
 * SOTO AI — Universal Error Classification & Taxonomy Layer
 *
 * Classifies every error across Gemini AI, Image Generation, E2B microVMs,
 * ImageKit, Neon DB, and Inngest into typed categories with recovery strategies.
 */

export type ErrorSeverity = "transient" | "recoverable" | "permanent" | "fatal";

export type ErrorDomain =
  | "gemini"
  | "image_generation"
  | "imagekit"
  | "e2b_sandbox"
  | "database"
  | "inngest"
  | "workflow"
  | "system";

export type ErrorCategory =
  // Gemini AI
  | "gemini_auth_failure"
  | "gemini_model_not_found"
  | "gemini_unsupported_capability"
  | "gemini_rate_limited"
  | "gemini_quota_exhausted"
  | "gemini_server_error"
  | "gemini_timeout"
  | "gemini_network_error"
  | "gemini_malformed_response"
  | "gemini_empty_response"
  | "gemini_thought_signature_missing"
  | "gemini_context_length_exceeded"
  | "gemini_function_call_error"

  // Image Generation & ImageKit
  | "image_model_unavailable"
  | "image_quota_exhausted"
  | "image_generation_failed"
  | "image_invalid_bytes"
  | "imagekit_auth_error"
  | "imagekit_upload_failed"
  | "imagekit_network_error"
  | "artifact_storage_failed"

  // E2B Sandbox & Browser
  | "e2b_sandbox_creation_failed"
  | "e2b_sandbox_expired"
  | "e2b_browser_startup_failed"
  | "e2b_navigation_timeout"
  | "e2b_action_failed"
  | "e2b_screenshot_failed"
  | "e2b_resource_exhausted"

  // Database & Infrastructure
  | "db_connection_error"
  | "db_transaction_failed"
  | "task_lease_lost"
  | "duplicate_task_execution"
  | "prerequisites_incomplete"
  | "prerequisite_failed"
  | "invalid_task_arguments"
  | "unknown_provider_error";

export type ClassifiedError = {
  domain: ErrorDomain;
  category: ErrorCategory;
  severity: ErrorSeverity;
  isTransient: boolean;
  httpStatus?: number;
  retryAfterMs?: number;
  originalMessage: string;
  sanitizedMessage: string;
  recommendedAction: "retry_backoff" | "resume_checkpoint" | "switch_model" | "degrade_gracefully" | "fail_terminal";
  cause?: unknown;
};

/**
 * Sanitizes sensitive credentials, API keys, bearer tokens, and secrets from any error string.
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) return "";
  return message
    .replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED_GEMINI_KEY]")
    .replace(/private_[0-9A-Za-z-_=]+/g, "[REDACTED_IMAGEKIT_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9-_.]+/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@[^\s]+/gi, "postgres://[REDACTED_DB_CREDENTIALS]")
    .replace(/api[_-]?key[:=]\s*["']?[^"'\s&]+/gi, "api_key=[REDACTED]")
    .replace(/password[:=]\s*["']?[^"'\s&]+/gi, "password=[REDACTED]");
}

/**
 * Extracts numeric HTTP status code from any error shape.
 */
export function extractHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  const cause = e.cause && typeof e.cause === "object" ? (e.cause as Record<string, unknown>) : {};

  const candidates = [e.status, e.statusCode, cause.status, cause.statusCode];
  for (const c of candidates) {
    if (typeof c === "number" && c >= 100 && c <= 599) return c;
  }
  return undefined;
}

/**
 * Extracts Retry-After delay in milliseconds from HTTP response headers or error messages.
 */
export function extractRetryAfterMs(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;

  // Check headers object if present
  const headers = e.headers && typeof e.headers === "object" ? (e.headers as Record<string, unknown>) : null;
  if (headers) {
    const raw = headers["retry-after"] || headers["Retry-After"];
    if (typeof raw === "string" || typeof raw === "number") {
      const parsed = Number(raw);
      if (!Number.isNaN(parsed) && parsed > 0) {
        return parsed < 1000 ? parsed * 1000 : parsed;
      }
    }
  }

  // Check error message for regex pattern (e.g. "retry after 30s" or "try again in 15 seconds")
  const msg = typeof e.message === "string" ? e.message : "";
  const match = msg.match(/retry\s+after\s+(\d+)\s*(s|sec|seconds|ms)?/i) || msg.match(/try\s+again\s+in\s+(\d+)\s*(s|sec|seconds|ms)?/i);
  if (match) {
    const val = parseInt(match[1], 10);
    const unit = match[2]?.toLowerCase();
    if (unit === "ms") return val;
    return val * 1000;
  }

  return undefined;
}

/**
 * Classifies any runtime error into a structured ClassifiedError with actionable recovery semantics.
 */
export function classifyError(error: unknown): ClassifiedError {
  const originalMessage = error instanceof Error ? error.message : String(error ?? "Unknown error");
  const sanitizedMessage = sanitizeErrorMessage(originalMessage);
  const httpStatus = extractHttpStatus(error);
  const retryAfterMs = extractRetryAfterMs(error);
  const msgLower = originalMessage.toLowerCase();

  // 1. Gemini thoughtSignature errors
  if (msgLower.includes("thought_signature") || msgLower.includes("thoughtsignature")) {
    return {
      domain: "gemini",
      category: "gemini_thought_signature_missing",
      severity: "recoverable",
      isTransient: true,
      httpStatus: httpStatus ?? 400,
      retryAfterMs,
      originalMessage,
      sanitizedMessage,
      recommendedAction: "resume_checkpoint",
      cause: error,
    };
  }

  // 2. Gemini Quota & Rate Limit (429 / RESOURCE_EXHAUSTED)
  if (httpStatus === 429 || msgLower.includes("rate limit") || msgLower.includes("resource_exhausted") || msgLower.includes("quota exceeded")) {
    return {
      domain: "gemini",
      category: "gemini_rate_limited",
      severity: "transient",
      isTransient: true,
      httpStatus: 429,
      retryAfterMs: retryAfterMs ?? 5000,
      originalMessage,
      sanitizedMessage,
      recommendedAction: "retry_backoff",
      cause: error,
    };
  }

  // 3. Gemini Authentication (401 / 403 / API_KEY_INVALID)
  if (httpStatus === 401 || httpStatus === 403 || msgLower.includes("api key") || msgLower.includes("unauthenticated") || msgLower.includes("permission_denied")) {
    return {
      domain: "gemini",
      category: "gemini_auth_failure",
      severity: "permanent",
      isTransient: false,
      httpStatus,
      retryAfterMs: undefined,
      originalMessage,
      sanitizedMessage,
      recommendedAction: "fail_terminal",
      cause: error,
    };
  }

  // 4. ImageKit Storage Errors
  if (msgLower.includes("imagekit")) {
    const isAuth = httpStatus === 401 || httpStatus === 403 || msgLower.includes("unauthorized") || msgLower.includes("invalid private key");
    return {
      domain: "imagekit",
      category: isAuth ? "imagekit_auth_error" : "imagekit_upload_failed",
      severity: isAuth ? "permanent" : "transient",
      isTransient: !isAuth,
      httpStatus,
      originalMessage,
      sanitizedMessage,
      recommendedAction: isAuth ? "degrade_gracefully" : "retry_backoff",
      cause: error,
    };
  }

  // 5. E2B Sandbox & Browser Errors
  if (msgLower.includes("sandbox") || msgLower.includes("e2b")) {
    const isExpired = msgLower.includes("expired") || msgLower.includes("not running") || msgLower.includes("not found");
    return {
      domain: "e2b_sandbox",
      category: isExpired ? "e2b_sandbox_expired" : "e2b_action_failed",
      severity: "recoverable",
      isTransient: true,
      originalMessage,
      sanitizedMessage,
      recommendedAction: isExpired ? "resume_checkpoint" : "retry_backoff",
      cause: error,
    };
  }

  // 6. Neon Database Errors
  if (msgLower.includes("postgres") || msgLower.includes("neon") || msgLower.includes("connection terminated") || msgLower.includes("connection closed")) {
    return {
      domain: "database",
      category: "db_connection_error",
      severity: "transient",
      isTransient: true,
      originalMessage,
      sanitizedMessage,
      recommendedAction: "retry_backoff",
      cause: error,
    };
  }

  // 7. Gemini Model Not Found (404)
  if (httpStatus === 404 || msgLower.includes("not found") || msgLower.includes("model not supported")) {
    return {
      domain: "gemini",
      category: "gemini_model_not_found",
      severity: "permanent",
      isTransient: false,
      httpStatus: 404,
      originalMessage,
      sanitizedMessage,
      recommendedAction: "switch_model",
      cause: error,
    };
  }

  // 8. Gemini Server Errors (500 / 502 / 503 / 504 / UNAVAILABLE)
  if ((httpStatus && httpStatus >= 500) || msgLower.includes("service unavailable") || msgLower.includes("internal server error") || msgLower.includes("backend error") || msgLower.includes("503")) {
    return {
      domain: "gemini",
      category: "gemini_server_error",
      severity: "transient",
      isTransient: true,
      httpStatus: httpStatus ?? 503,
      retryAfterMs: retryAfterMs ?? 3000,
      originalMessage,
      sanitizedMessage,
      recommendedAction: "retry_backoff",
      cause: error,
    };
  }

  // 9. Timeouts & Network Disconnections
  if (msgLower.includes("timeout") || msgLower.includes("abort") || msgLower.includes("econnreset") || msgLower.includes("fetch failed") || msgLower.includes("etimedout")) {
    return {
      domain: "gemini",
      category: "gemini_timeout",
      severity: "transient",
      isTransient: true,
      httpStatus: httpStatus ?? 408,
      retryAfterMs: 2000,
      originalMessage,
      sanitizedMessage,
      recommendedAction: "retry_backoff",
      cause: error,
    };
  }

  // 7. Context / Token Length Exceeded
  if (msgLower.includes("token limit") || msgLower.includes("context length") || msgLower.includes("maximum context length")) {
    return {
      domain: "gemini",
      category: "gemini_context_length_exceeded",
      severity: "recoverable",
      isTransient: false,
      httpStatus: 400,
      originalMessage,
      sanitizedMessage,
      recommendedAction: "degrade_gracefully",
      cause: error,
    };
  }

  // 8. Empty Gemini Response
  if (msgLower.includes("empty_provider_response") || msgLower.includes("empty response") || msgLower.includes("candidate content missing")) {
    return {
      domain: "gemini",
      category: "gemini_empty_response",
      severity: "transient",
      isTransient: true,
      httpStatus,
      retryAfterMs: 1500,
      originalMessage,
      sanitizedMessage,
      recommendedAction: "retry_backoff",
      cause: error,
    };
  }

  // 9. Image Generation: Empty Bytes / Corruption
  if (msgLower.includes("empty image bytes") || msgLower.includes("invalid image bytes")) {
    return {
      domain: "image_generation",
      category: "image_invalid_bytes",
      severity: "transient",
      isTransient: true,
      originalMessage,
      sanitizedMessage,
      recommendedAction: "retry_backoff",
      cause: error,
    };
  }

  // 12. Task Leases & Prerequisites
  if (msgLower.includes("lease_lost") || msgLower.includes("lease")) {
    return {
      domain: "workflow",
      category: "task_lease_lost",
      severity: "permanent",
      isTransient: false,
      originalMessage,
      sanitizedMessage,
      recommendedAction: "fail_terminal",
      cause: error,
    };
  }

  if (msgLower.includes("prerequisite")) {
    return {
      domain: "workflow",
      category: "prerequisite_failed",
      severity: "recoverable",
      isTransient: false,
      originalMessage,
      sanitizedMessage,
      recommendedAction: "degrade_gracefully",
      cause: error,
    };
  }

  // Default fallback
  return {
    domain: "system",
    category: "unknown_provider_error",
    severity: "recoverable",
    isTransient: true,
    httpStatus,
    originalMessage,
    sanitizedMessage,
    recommendedAction: "retry_backoff",
    cause: error,
  };
}
