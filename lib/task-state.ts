export type TaskStatus = "pending" | "blocked" | "queued" | "running" | "completed" | "failed";

export function resolveDependencyStatus(expectedIds: number[], prerequisites: Array<{ id?: number; status: string }>): "pending" | "blocked" | "failed" {
  if (prerequisites.some((item) => item.status === "failed")) return "failed";
  if (prerequisites.length === expectedIds.length && prerequisites.every((item) => item.status === "completed")) return "pending";
  return "blocked";
}

export function canTransition(current: TaskStatus, next: TaskStatus) {
  return (current === "pending" && next === "queued")
    || (current === "blocked" && (next === "pending" || next === "failed"))
    || (current === "queued" && next === "running")
    || (current === "running" && (next === "queued" || next === "completed" || next === "failed"));
}
