import { isComputerEligible } from "../computer-types.ts";
import { AGENT_INSTRUCTIONS, AGENT_RESPONSE_GUIDELINES } from "../agent-instructions.ts";
import type { GeminiToolDefinition } from "./tools/runtime.ts";
import { RESEARCH_TOOLS } from "./tools/research.ts";
import { IMAGE_TOOLS } from "./tools/generate-image.ts";
import { CONTENT_TOOLS } from "./tools/content.ts";
import { FILE_STORAGE_TOOLS } from "./tools/file-storage.ts";
import { USER_AND_RESULT_TOOLS } from "./tools/user-and-result.ts";
import { COMPUTER_ACTION_TOOLS } from "./tools/computer-action.ts";

export type SpecialistAgentConfig = {
  id: string;
  role: string;
  title: string;
  computerEligible: boolean;
  systemInstruction: string;
  directTools: GeminiToolDefinition[];
  computerTools: GeminiToolDefinition[];
};

export const AGENT_CONFIGS: Record<string, SpecialistAgentConfig> = {
  "seat-1": {
    id: "seat-1",
    role: "Research Agent",
    title: "Market & Trend Intelligence",
    computerEligible: isComputerEligible("seat-1"),
    systemInstruction: `${AGENT_INSTRUCTIONS["seat-1"]} ${AGENT_RESPONSE_GUIDELINES}`,
    directTools: [
      ...RESEARCH_TOOLS,
      ...FILE_STORAGE_TOOLS.filter((t) => t.declaration.name === "saveArtifact"),
      ...USER_AND_RESULT_TOOLS,
    ],
    computerTools: [
      ...COMPUTER_ACTION_TOOLS,
      ...RESEARCH_TOOLS,
      ...FILE_STORAGE_TOOLS,
      ...USER_AND_RESULT_TOOLS,
    ],
  },
  "seat-mvj4q0fn": {
    id: "seat-mvj4q0fn",
    role: "Content Creator Agent",
    title: "Campaign Creative & Copywriting",
    computerEligible: isComputerEligible("seat-mvj4q0fn"),
    systemInstruction: `${AGENT_INSTRUCTIONS["seat-mvj4q0fn"]} ${AGENT_RESPONSE_GUIDELINES}`,
    directTools: [
      ...IMAGE_TOOLS,
      ...CONTENT_TOOLS,
      ...FILE_STORAGE_TOOLS.filter((t) => t.declaration.name === "saveArtifact"),
      ...USER_AND_RESULT_TOOLS,
    ],
    computerTools: [
      ...COMPUTER_ACTION_TOOLS,
      ...IMAGE_TOOLS,
      ...CONTENT_TOOLS,
      ...FILE_STORAGE_TOOLS,
      ...USER_AND_RESULT_TOOLS,
    ],
  },
  "seat-mvj4q1b7": {
    id: "seat-mvj4q1b7",
    role: "Scheduler Agent",
    title: "Calendar & Multi-Channel Distribution",
    computerEligible: isComputerEligible("seat-mvj4q1b7"),
    systemInstruction: `${AGENT_INSTRUCTIONS["seat-mvj4q1b7"]} ${AGENT_RESPONSE_GUIDELINES}`,
    directTools: [
      ...FILE_STORAGE_TOOLS.filter((t) => t.declaration.name === "saveArtifact"),
      ...USER_AND_RESULT_TOOLS,
    ],
    computerTools: [],
  },
  "seat-mvj4q1mo": {
    id: "seat-mvj4q1mo",
    role: "Analytics Agent",
    title: "KPI Synthesis & Intelligence",
    computerEligible: isComputerEligible("seat-mvj4q1mo"),
    systemInstruction: `${AGENT_INSTRUCTIONS["seat-mvj4q1mo"]} ${AGENT_RESPONSE_GUIDELINES}`,
    directTools: [
      ...FILE_STORAGE_TOOLS.filter((t) => t.declaration.name === "saveArtifact"),
      ...USER_AND_RESULT_TOOLS,
    ],
    computerTools: [],
  },
};

export function getAgentConfig(agentId: string): SpecialistAgentConfig | undefined {
  return AGENT_CONFIGS[agentId];
}

export function getAgentTools(agentId: string, mode: "direct" | "computer" = "direct"): GeminiToolDefinition[] {
  const config = AGENT_CONFIGS[agentId];
  if (!config) return [];
  return mode === "computer" && config.computerEligible ? config.computerTools : config.directTools;
}

