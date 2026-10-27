export type PlannedTask = {
  agentId: string;
  title: string;
  instructions: string;
  dependsOn: number[];
};

export type MasterPlan = {
  clarification: string;
  review: string;
  tasks: PlannedTask[];
};

export type PlanValidation =
  | { ok: true; plan: MasterPlan }
  | { ok: false; reason: string };

export function validateMasterPlan(raw: string, availableAgentIds: readonly string[]): PlanValidation {
  let value: unknown;
  try {
    value = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
  } catch {
    return { ok: false, reason: "malformed_json" };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "invalid_shape" };
  const candidate = value as Record<string, unknown>;
  const clarification = typeof candidate.clarification === "string" ? candidate.clarification.trim() : "";
  const review = typeof candidate.review === "string" ? candidate.review.trim() : "";
  const rawTasks = candidate.tasks ?? [];
  if (!Array.isArray(rawTasks) || rawTasks.length > 6) return { ok: false, reason: "invalid_task_list" };

  const tasks: PlannedTask[] = [];
  for (let index = 0; index < rawTasks.length; index++) {
    const item = rawTasks[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, reason: "invalid_task" };
    const task = item as Record<string, unknown>;
    if (typeof task.agentId !== "string" || !availableAgentIds.includes(task.agentId)) return { ok: false, reason: "unknown_agent" };
    if (typeof task.title !== "string" || !task.title.trim() || typeof task.instructions !== "string" || !task.instructions.trim()) {
      return { ok: false, reason: "missing_task_details" };
    }
    const dependencies = task.dependsOn ?? [];
    if (!Array.isArray(dependencies) || !dependencies.every((dependency) => Number.isInteger(dependency) && (dependency as number) >= 0 && (dependency as number) < index)) {
      return { ok: false, reason: "invalid_dependencies" };
    }
    tasks.push({
      agentId: task.agentId,
      title: task.title.trim().slice(0, 200),
      instructions: task.instructions.trim(),
      dependsOn: [...new Set(dependencies as number[])],
    });
  }

  return { ok: true, plan: { clarification, review, tasks } };
}

export function describeInvalidMasterPlan(reason: string) {
  switch (reason) {
    case "malformed_json": return "the response was not valid JSON";
    case "invalid_shape": return "the response was not a JSON object";
    case "invalid_task_list": return "the task list was missing or had an invalid format";
    case "invalid_task": return "a task entry had an invalid format";
    case "unknown_agent": return "a task used an unrecognized specialist ID";
    case "missing_task_details": return "a task was missing its title or instructions";
    case "invalid_dependencies": return "a task had invalid dependency indexes";
    default: return "the response did not match the required plan structure";
  }
}

export function hasDelegationClaim(text: string) {
  return /\b(delegat(?:e|ed|ing|ion)|assign(?:ed|ing)?\s+(?:the\s+)?tasks?|(?:specialists?|agents?)\s+(?:will|are|have|has)\s+(?:handle|started|received|been assigned|work)|sent\s+to\s+(?:the\s+)?(?:specialists?|agents?))\b/i.test(text);
}

export function summarizeTaskStatuses(tasks: Array<{ title: string; status: string; error?: string | null }>, alreadyCreated = false) {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const queued = tasks.filter((task) => task.status === "queued" || task.status === "blocked").length;
  const prefix = alreadyCreated ? "These assignments already exist" : `I created ${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
  const parts = [`${completed} completed`, ...(running ? [`${running} in progress`] : []), ...(queued ? [`${queued} queued`] : []), ...(failed ? [`${failed} failed`] : [])];
  const failureDetails = tasks.filter((task) => task.status === "failed").map((task) => `${task.title}: ${task.error ?? "The specialist did not complete this task."}`);
  return `${prefix}. ${parts.join(", ")}.${failureDetails.length ? ` ${failureDetails.join(" ")}` : ""}`;
}
