export type OutboxDeliveryEvent = {
  taskId: number;
  authUserId: string;
  assignedAgentId: string;
  outboxId: string;
  claimToken: string;
  attempts: number;
};

export type OutboxDeliveryResult = {
  sent: string[];
  failed: Array<{ outboxId: string; deadLettered: boolean }>;
};

export async function deliverClaimedOutbox(
  events: OutboxDeliveryEvent[],
  deps: {
    send: (event: { id: string; name: string; data: Omit<OutboxDeliveryEvent, "claimToken" | "attempts" | "outboxId"> & { outboxId: string } }) => Promise<unknown>;
    markSent: (event: OutboxDeliveryEvent) => Promise<void>;
    markFailed: (event: OutboxDeliveryEvent, details: { retryAt: Date; deadLettered: boolean; safeError: string }) => Promise<void>;
    eventName: string;
    eventId: (outboxId: string) => string;
    maxAttempts: number;
    retryAt: (attempts: number, now: Date) => Date;
    safeError: (error: unknown) => string;
    now?: () => Date;
  },
): Promise<OutboxDeliveryResult> {
  const result: OutboxDeliveryResult = { sent: [], failed: [] };
  for (const event of events) {
    try {
      await deps.send({
        id: deps.eventId(event.outboxId),
        name: deps.eventName,
        data: {
          taskId: event.taskId,
          authUserId: event.authUserId,
          assignedAgentId: event.assignedAgentId,
          outboxId: event.outboxId,
        },
      });
      await deps.markSent(event);
      result.sent.push(event.outboxId);
    } catch (error) {
      const deadLettered = event.attempts >= deps.maxAttempts;
      await deps.markFailed(event, {
        retryAt: deps.retryAt(event.attempts, (deps.now ?? (() => new Date()))()),
        deadLettered,
        safeError: deps.safeError(error),
      });
      result.failed.push({ outboxId: event.outboxId, deadLettered });
    }
  }
  return result;
}
