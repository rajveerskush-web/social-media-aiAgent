/**
 * SOTO AI — Intelligent Exponential Backoff, Jitter & Retry Policy
 *
 * Implements full-jitter exponential backoff, respects provider Retry-After,
 * bounds execution time budget, and avoids retrying non-transient errors.
 */

import { classifyError, type ClassifiedError } from "./error-classifier.ts";

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  totalTimeoutMs?: number;
  operationName?: string;
  onRetry?: (attempt: number, error: ClassifiedError, delayMs: number) => void;
};

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 15000;
const DEFAULT_TOTAL_TIMEOUT_MS = 60000;

/**
 * Calculates exponential backoff with full jitter to avoid herd stampedes:
 * delay = min(maxDelay, random(0, baseDelay * 2^attempt))
 */
export function calculateBackoffDelay(
  attempt: number,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  retryAfterMs?: number,
): number {
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    // If provider sent an explicit retry-after header/hint, respect it with small jitter
    return Math.min(maxDelayMs, retryAfterMs + Math.floor(Math.random() * 500));
  }

  const exponential = baseDelayMs * 2 ** Math.min(attempt - 1, 5);
  // Full jitter: uniformly random between baseDelay and exponential capped at maxDelay
  const jittered = baseDelayMs + Math.floor(Math.random() * Math.max(1, exponential - baseDelayMs));
  return Math.min(maxDelayMs, jittered);
}

/**
 * Executes an async operation with intelligent error recovery and jittered backoff.
 */
export async function executeWithRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
    operationName = "unspecified_operation",
    onRetry,
  } = options;

  const startTime = Date.now();
  let lastClassifiedError: ClassifiedError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Check total execution budget
      const elapsed = Date.now() - startTime;
      if (elapsed > totalTimeoutMs) {
        throw new Error(
          `Operation "${operationName}" exceeded total timeout budget of ${totalTimeoutMs}ms (elapsed: ${elapsed}ms).`,
        );
      }

      return await operation(attempt);
    } catch (err: unknown) {
      const classified = classifyError(err);
      lastClassifiedError = classified;

      // Never retry fatal or permanent errors (e.g. invalid API key, unauthenticated, invalid argument)
      if (classified.severity === "permanent" || !classified.isTransient) {
        throw err;
      }

      // Check if we exhausted attempts
      if (attempt >= maxAttempts) {
        throw err;
      }

      // Calculate backoff
      const delayMs = calculateBackoffDelay(attempt, baseDelayMs, maxDelayMs, classified.retryAfterMs);

      // Check if sleeping will breach the total timeout
      if (Date.now() - startTime + delayMs > totalTimeoutMs) {
        throw err;
      }

      if (onRetry) {
        onRetry(attempt, classified, delayMs);
      }

      await sleep(delayMs);
    }
  }

  throw lastClassifiedError?.cause ?? new Error(`Operation "${operationName}" failed after ${maxAttempts} attempts.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
