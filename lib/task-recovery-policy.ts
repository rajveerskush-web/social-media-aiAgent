export const EXECUTION_LEASE_MS = 20 * 60_000;
export const EXECUTION_HEARTBEAT_MS = 30_000;
export const OUTBOX_DISPATCH_LEASE_MS = 2 * 60_000;
export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_RETRY_BASE_MS = 30_000;
export const OUTBOX_RETRY_MAX_MS = 60 * 60_000;

export type OutboxClaimState = {
  status: string;
  attempts: number;
  nextAttemptAt: Date;
  updatedAt: Date;
  dispatchClaimToken: string | null;
};

export function executionLeaseExpired(expiresAt: Date | null, now = new Date()) {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

export function executionLeaseMatches(status: string, storedToken: string | null, suppliedToken: string) {
  return status === "running" && storedToken !== null && storedToken === suppliedToken;
}

export function outboxRetryDelayMs(attempts: number) {
  const exponent = Math.max(0, Math.min(attempts - 1, 20));
  return Math.min(OUTBOX_RETRY_MAX_MS, OUTBOX_RETRY_BASE_MS * 2 ** exponent);
}

export function outboxRetryAt(attempts: number, now = new Date()) {
  return new Date(now.getTime() + outboxRetryDelayMs(attempts));
}

export function isOutboxClaimable(row: OutboxClaimState, now = new Date()) {
  if (row.status === "pending") return row.nextAttemptAt.getTime() <= now.getTime();
  return row.status === "dispatching"
    && row.updatedAt.getTime() + OUTBOX_DISPATCH_LEASE_MS <= now.getTime();
}

export function shouldDeadLetterOutbox(attempts: number) {
  return attempts >= OUTBOX_MAX_ATTEMPTS;
}

export function canManuallyRetryOutbox(outboxStatus: string, taskStatus: string) {
  return outboxStatus === "dead_letter" && taskStatus === "queued";
}

export function outboxClaimAction(row: OutboxClaimState, now = new Date()) {
  if (!isOutboxClaimable(row, now)) return "wait" as const;
  if (shouldDeadLetterOutbox(row.attempts)) return "dead_letter" as const;
  return "claim" as const;
}

export function safeOutboxError(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const name = typeof value.name === "string" && /^[A-Za-z]+$/.test(value.name) ? value.name : "DeliveryError";
  const code = typeof value.code === "string" && /^[A-Z0-9_]{1,32}$/.test(value.code) ? `:${value.code}` : "";
  return `${name}${code}`;
}
