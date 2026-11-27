import type { AgentExecutionStatus } from "./agent-activity";

export function formatExecutionStatus(status: AgentExecutionStatus): {
  label: string;
  cssClass: string;
} {
  switch (status) {
    case "running":
      return { label: "Working", cssClass: "is-running" };
    case "waiting_for_user":
      return { label: "Waiting for You", cssClass: "is-waiting" };
    case "queued":
      return { label: "Queued", cssClass: "is-queued" };
    case "completed":
      return { label: "Done", cssClass: "is-completed" };
    case "failed":
      return { label: "Failed", cssClass: "is-failed" };
    case "idle":
    case "ready":
    default:
      return { label: "Ready", cssClass: "is-ready" };
  }
}

export function formatElapsedTime(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatTaskErrorMessage(rawError: string | null | undefined): string {
  if (!rawError) return "";
  const cleaned = rawError.trim();
  if (cleaned === "provider_error") {
    return "AI Model Service encountered a temporary provider issue and halted safely.";
  }
  if (cleaned.startsWith("provider_error:")) {
    const detail = cleaned.slice("provider_error:".length).trim();
    return detail ? `Provider Notice: ${detail}` : "AI Model Service encountered a temporary issue.";
  }
  return cleaned;
}

