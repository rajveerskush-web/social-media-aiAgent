import {
  validateMasterPlan,
  summarizeTaskStatuses,
  type MasterPlan,
  type PlannedTask,
  type PlanValidation,
} from "../master-agent-plan.ts";
import { getGeminiClient, GEMINI_MODEL } from "./gemini.ts";
import { AGENT_CONFIGS } from "./agent-definitions.ts";

export { validateMasterPlan, summarizeTaskStatuses };

export type MasterPlannerInput = {
  userRequest: string;
  campaignName: string;
  existingTasks?: Array<{
    id: number;
    title: string;
    status: string;
    assignedAgentId: string;
    instructions?: string;
    response?: string | null;
  }>;
};

export type MasterPlannerOutput = {
  plan: PlanValidation;
  rawResponse: string;
};

/**
 * Plans and coordinates multi-agent delegation for a campaign request.
 */
export async function planMasterDelegation(
  input: MasterPlannerInput,
): Promise<MasterPlannerOutput> {
  const client = getGeminiClient();
  const availableSpecialistIds = Object.keys(AGENT_CONFIGS);

  const prompt = [
    `You are the Master Agent for SOTO AI campaign "${input.campaignName}".`,
    "Break down user requests into subtasks and delegate to the right specialist agents:",
    "- Research Agent (seat-1): Market research, competitor audits, hashtag/trend discovery.",
    "- Content Creator Agent (seat-mvj4q0fn): Creative briefs, post captions, hashtags, image generation.",
    "- Scheduler Agent (seat-mvj4q1b7): Content calendars, publishing schedules, time zones.",
    "- Analytics Agent (seat-mvj4q1mo): KPI synthesis, performance intelligence.",
    "",
    "Rules:",
    "1. Never execute specialist tasks yourself; delegate to the specialist IDs.",
    "2. If the user provides additional information for an existing task, use 'updateTaskId' instead of creating a duplicate task.",
    "3. Respond ONLY with valid JSON conforming to the plan schema: { tasks: [{ agentId, title, instructions, dependsOn }] } where dependsOn is an array of 0-based integer indexes of earlier tasks that must complete first (e.g. [0] to depend on the first task, [] for no prerequisites).",
    "",
    input.existingTasks?.length
      ? `Existing campaign tasks:\n${summarizeTaskStatuses(input.existingTasks as any)}`
      : "No existing tasks for this campaign yet.",
    "",
    `User Request: ${input.userRequest}`,
  ].join("\n");

  const { executeWithRetry } = await import("../recovery/retry-policy.ts");
  const response = await executeWithRetry(
    async () => client.models.generateContent({
      model: GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        httpOptions: { timeout: 30_000 },
        abortSignal: AbortSignal.timeout(30_000),
      },
    }),
    {
      maxAttempts: 3,
      baseDelayMs: 1500,
      maxDelayMs: 8000,
      operationName: "master_planner_delegation",
    },
  );

  const rawText = response.text?.trim() || "";
  const validation = validateMasterPlan(rawText, availableSpecialistIds);

  return {
    plan: validation,
    rawResponse: rawText,
  };
}
