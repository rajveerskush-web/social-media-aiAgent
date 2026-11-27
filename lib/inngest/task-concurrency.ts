export const TASK_CONCURRENCY: [
  { limit: number; key: string; scope: "fn" },
  { limit: number; key: string; scope: "fn" },
] = [
  { limit: 2, key: "event.data.authUserId", scope: "fn" as const },
  { limit: 50, key: "event.data.assignedAgentId", scope: "fn" as const },
];
