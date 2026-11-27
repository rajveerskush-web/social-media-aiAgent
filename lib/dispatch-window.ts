export const DISPATCH_WINDOW_MS = 15 * 60_000;

export function isDueForImmediateDispatch(scheduledAt: Date, now = new Date()) {
  return scheduledAt.getTime() <= now.getTime() + DISPATCH_WINDOW_MS;
}

export function dispatchEventId(outboxId: string) { return outboxId; }
