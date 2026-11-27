export type PlannedTask = {
  agentId: string;
  title: string;
  instructions: string;
  dependsOn: number[];
  scheduledAt?: string;
  timeZone?: string;
  repeatRule?: { frequency: "daily" | "weekly" | "monthly"; interval: number; timeZone: string; occurrences?: number };
  updateTaskId?: number;
};

export type UpdatedTask = {
  id: number;
  additionalInstructions: string;
};

export type MasterPlan = {
  clarification: string;
  review: string;
  tasks: PlannedTask[];
  updatedTasks: UpdatedTask[];
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

  const updatedTasks: UpdatedTask[] = [];
  const rawUpdatedTasks = candidate.updatedTasks ?? candidate.updates;
  if (Array.isArray(rawUpdatedTasks)) {
    for (const item of rawUpdatedTasks) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const entry = item as Record<string, unknown>;
      const rawId = entry.id ?? entry.taskId ?? entry.updateTaskId;
      const id = typeof rawId === "number" ? rawId : parseInt(String(rawId), 10);
      const additionalInstructions = typeof entry.additionalInstructions === "string"
        ? entry.additionalInstructions.trim()
        : (typeof entry.instructions === "string" ? entry.instructions.trim() : "");
      if (Number.isSafeInteger(id) && id > 0 && additionalInstructions) {
        updatedTasks.push({ id, additionalInstructions });
      }
    }
  }

  const tasks: PlannedTask[] = [];
  for (let index = 0; index < rawTasks.length; index++) {
    const item = rawTasks[index];
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false, reason: "invalid_task" };
    const task = item as Record<string, unknown>;
    const explicitUpdateId = Number(task.updateTaskId ?? (task.id && !task.agentId ? task.id : NaN));
    if (Number.isSafeInteger(explicitUpdateId) && explicitUpdateId > 0 && typeof task.instructions === "string" && task.instructions.trim()) {
      updatedTasks.push({ id: explicitUpdateId, additionalInstructions: task.instructions.trim() });
      continue;
    }
    if (typeof task.agentId !== "string" || !availableAgentIds.includes(task.agentId)) return { ok: false, reason: "unknown_agent" };
    if (typeof task.title !== "string" || !task.title.trim() || typeof task.instructions !== "string" || !task.instructions.trim()) {
      return { ok: false, reason: "missing_task_details" };
    }
    const rawDependencies = task.dependsOn ?? [];
    if (!Array.isArray(rawDependencies)) {
      return { ok: false, reason: "invalid_dependencies" };
    }
    const resolvedDependencies: number[] = [];
    for (const dep of rawDependencies) {
      if (Number.isInteger(dep) && (dep as number) >= 0 && (dep as number) < index) {
        resolvedDependencies.push(dep as number);
      } else if (typeof dep === "string") {
        const trimmed = dep.trim().toLowerCase();
        const foundIndex = tasks.findIndex(
          (t) => t.title.toLowerCase() === trimmed || t.agentId.toLowerCase() === trimmed,
        );
        if (foundIndex >= 0 && foundIndex < index) {
          resolvedDependencies.push(foundIndex);
        } else {
          return { ok: false, reason: "invalid_dependencies" };
        }
      } else {
        return { ok: false, reason: "invalid_dependencies" };
      }
    }
    const repeatCandidate = task.repeatRule && typeof task.repeatRule === "object" && !Array.isArray(task.repeatRule)
      ? task.repeatRule as Record<string, unknown> : undefined;
    const scheduledAt = typeof task.scheduledAt === "string" ? task.scheduledAt : undefined;
    const timeZone = typeof task.timeZone === "string" ? task.timeZone : undefined;
    const repeatRule = repeatCandidate && typeof repeatCandidate.frequency === "string" && typeof repeatCandidate.timeZone === "string"
      ? { frequency: repeatCandidate.frequency as "daily" | "weekly" | "monthly", interval: Number(repeatCandidate.interval), timeZone: repeatCandidate.timeZone,
        ...(repeatCandidate.occurrences !== undefined ? { occurrences: Number(repeatCandidate.occurrences) } : {}) } : undefined;
    if (scheduledAt && (!Number.isFinite(Date.parse(scheduledAt)) || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(scheduledAt))) return { ok: false, reason: "invalid_schedule" };
    if ((scheduledAt || repeatCandidate) && !isValidTimeZone(repeatRule?.timeZone ?? timeZone ?? "")) return { ok: false, reason: "missing_schedule_timezone" };
    if (repeatCandidate && (!repeatRule || !isValidRepeatRule(repeatRule))) return { ok: false, reason: "invalid_repeat_rule" };
    tasks.push({
      agentId: task.agentId,
      title: task.title.trim().slice(0, 200),
      instructions: task.instructions.trim(),
      dependsOn: [...new Set(resolvedDependencies)],
      ...(scheduledAt ? { scheduledAt } : {}),
      ...(timeZone ? { timeZone } : {}),
      ...(repeatRule ? { repeatRule } : {}),
    });
  }

  return { ok: true, plan: { clarification, review, tasks, updatedTasks } };
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

function isValidTimeZone(value: string) {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}

function isValidRepeatRule(value: NonNullable<PlannedTask["repeatRule"]>) {
  return ["daily", "weekly", "monthly"].includes(value.frequency) && Number.isInteger(value.interval) && value.interval >= 1 && value.interval <= 365
    && (value.occurrences === undefined || (Number.isInteger(value.occurrences) && value.occurrences >= 1 && value.occurrences <= 365))
    && isValidTimeZone(value.timeZone);
}

export function hasDelegationClaim(text: string) {
  return /\b(delegat(?:e|ed|ing|ion)|assign(?:ed|ing)?\s+(?:the\s+)?tasks?|(?:specialists?|agents?)\s+(?:will|are|have|has)\s+(?:handle|started|received|been assigned|work)|sent\s+to\s+(?:the\s+)?(?:specialists?|agents?))\b/i.test(text);
}

export function summarizeTaskStatuses(
  tasks: Array<{ id?: number; title: string; status: string; error?: string | null; response?: string | null; assignedAgentId?: string }>,
  alreadyCreated = false,
  updatedTasks: Array<{ id: number; title: string; assignedAgentId?: string }> = [],
) {
  const updatedPart = updatedTasks.length
    ? `I have updated ${updatedTasks.length} existing task${updatedTasks.length === 1 ? "" : "s"} (${updatedTasks.map((t) => `#${t.id} ${t.title} for ${t.assignedAgentId ?? "specialist"}`).join(", ")}) with your new information.`
    : "";
  if (!tasks.length && updatedPart) {
    return updatedPart;
  }
  const completed = tasks.filter((task) => task.status === "completed").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const running = tasks.filter((task) => task.status === "running").length;
  const queued = tasks.filter((task) => task.status === "pending" || task.status === "queued").length;
  const blocked = tasks.filter((task) => task.status === "blocked").length;
  const prefix = alreadyCreated ? "Here is the latest update on your team assignments" : `I have sent ${tasks.length} assignment${tasks.length === 1 ? "" : "s"} to the team`;
  const parts = [`${completed} completed`, ...(running ? [`${running} in progress`] : []), ...(queued ? [`${queued} waiting to start`] : []), ...(blocked ? [`${blocked} waiting on prerequisite work`] : []), ...(failed ? [`${failed} not completed`] : [])];
  const failureDetails = tasks.filter((task) => task.status === "failed").map((task) => `${task.title}: ${task.error ?? "The specialist did not complete this task."}`);
  const details = tasks.map((task) => `${task.id ? `#${task.id} ` : ""}${task.title} — ${task.assignedAgentId ?? "specialist"} (${task.status})`).join("; ");
  const baseSummary = `${prefix}. ${parts.join(", ")}.${details ? ` ${details}.` : ""}${failureDetails.length ? ` ${failureDetails.join(" ")}` : ""}`;
  const summary = updatedPart ? `${updatedPart}\n\n${baseSummary}` : baseSummary;
  const completedResults = tasks.filter((task) => task.status === "completed").map((task) => `${task.title}: ${task.response?.trim() || "The task is marked complete, but no specialist response was saved."}`);
  return completedResults.length ? `${summary}\n\nCompleted results:\n${completedResults.map((result) => `- ${result}`).join("\n")}` : summary;
}
