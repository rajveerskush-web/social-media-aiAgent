import { getAgentConfig, getAgentTools } from "./agent-definitions.ts";
import { runGeminiToolLoop, selectSpecialistModel, GEMINI_MODEL } from "./gemini.ts";
import type { ToolExecutionContext } from "./tools/context.ts";

export type SpecialistExecutionRequest = {
  agentId: string;
  taskTitle: string;
  instructions: string;
  campaignName: string;
  dependencyContext?: string;
  context: ToolExecutionContext;
  mode?: "direct" | "computer";
};

export type SpecialistExecutionResponse = {
  response: string;
  toolCallsCount: number;
  artifactsCount: number;
  completedViaTerminalTool: boolean;
};

/**
 * High-level executor for specialist agents using Gemini native tool calling.
 */
export async function executeSpecialistAgent(
  request: SpecialistExecutionRequest,
): Promise<SpecialistExecutionResponse> {
  const {
    agentId,
    taskTitle,
    instructions,
    campaignName,
    dependencyContext,
    context,
    mode = "direct",
  } = request;

  const agentConfig = getAgentConfig(agentId);
  if (!agentConfig) {
    throw new Error(`Unrecognized agent ID: ${agentId}`);
  }

  const tools = getAgentTools(agentId, mode);
  const modelToUse = selectSpecialistModel({
    agentId,
    defaultModel: GEMINI_MODEL,
    selectedSpecialistId: process.env.GEMINI_TEST_SPECIALIST_ID,
    testModel: process.env.GEMINI_TEST_SPECIALIST_MODEL,
    specialistIds: ["seat-1", "seat-mvj4q0fn", "seat-mvj4q1b7", "seat-mvj4q1mo"],
  });

  const prompt = [
    `Assignment for campaign "${campaignName}":`,
    `Task: ${taskTitle}`,
    `Instructions: ${instructions}`,
    dependencyContext ? `Prerequisite Outputs:\n${dependencyContext}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const loopResult = await runGeminiToolLoop({
    model: modelToUse,
    systemInstruction: agentConfig.systemInstruction,
    initialPrompt: prompt,
    tools,
    context,
    maxTurns: 5,
  });

  const artifactsCreated = loopResult.toolCallsExecuted.filter(
    (tc) => tc.result.artifactId !== undefined || tc.result.publicUrl !== undefined,
  );

  let formattedResponse = loopResult.finalText;
  if (!formattedResponse && loopResult.terminalResult?.output) {
    formattedResponse = loopResult.terminalResult.output;
  }
  if (!formattedResponse && loopResult.toolCallsExecuted.length > 0) {
    // Extract output from milestone tools (e.g. recordResearchFindings, saveContentDraft)
    const milestoneCall = [...loopResult.toolCallsExecuted].reverse().find(
      (tc) =>
        tc.name === "recordResearchFindings" ||
        tc.name === "saveContentDraft" ||
        tc.name === "createCarouselBrief" ||
        tc.name === "generateImage",
    );
    if (milestoneCall?.result?.output) {
      formattedResponse = milestoneCall.result.output;
    } else {
      const lastCall = loopResult.toolCallsExecuted[loopResult.toolCallsExecuted.length - 1];
      if (lastCall?.result?.output) {
        formattedResponse = lastCall.result.output;
      }
    }
  }

  return {
    response: formattedResponse || "Specialist completed the task.",
    toolCallsCount: loopResult.toolCallsExecuted.length,
    artifactsCount: artifactsCreated.length,
    completedViaTerminalTool: loopResult.completedViaTerminalTool,
  };
}
