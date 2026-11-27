import type { ToolExecutionContext, ToolResult } from "./context.ts";
import type { GeminiToolDefinition } from "./runtime.ts";
import { registerTools } from "./runtime.ts";
import { COMPUTER_TOOL_DECLARATIONS } from "../../computer-declarations.ts";

const completeDecl = COMPUTER_TOOL_DECLARATIONS.find((item) => item.name === "completeTask");
if (!completeDecl) throw new Error("Missing completeTask declaration");

export const completeTaskTool: GeminiToolDefinition<{
  summary: string;
  findings: string;
  status: "success" | "partial" | "failed";
  artifacts?: Array<{ filename: string; artifactType: string }>;
}> = {
  declaration: completeDecl as unknown as GeminiToolDefinition["declaration"],
  execute: async (args): Promise<ToolResult> => {
    return {
      success: args.status !== "failed",
      output: `Task completed with status '${args.status}'. Summary: ${args.summary}`,
      data: {
        summary: args.summary,
        findings: args.findings,
        status: args.status,
        artifacts: args.artifacts || [],
      },
    };
  },
};

export const requestUserInputTool: GeminiToolDefinition<{
  reason: string;
  prompt: string;
  loginUrl?: string;
}> = {
  declaration: {
    name: "requestUserInput",
    description:
      "Pause autonomous actions and request human intervention (e.g. for user-authorized login, CAPTCHA resolution, or confirmation). Never handle or store credentials directly.",
    parameters: {
      type: "OBJECT",
      properties: {
        reason: {
          type: "STRING",
          description: "Reason user input is needed (e.g. 'requires_login', 'captcha_detected', 'clarification').",
        },
        prompt: {
          type: "STRING",
          description: "Clear message to the user explaining what action is needed in their browser or computer viewer.",
        },
        loginUrl: {
          type: "STRING",
          description: "Optional URL the user should log into.",
        },
      },
      required: ["reason", "prompt"],
    },
  },
  execute: async (args): Promise<ToolResult> => {
    return {
      success: true,
      output: `Paused for human takeover: ${args.prompt}`,
      data: {
        waitingForUser: true,
        reason: args.reason,
        prompt: args.prompt,
        loginUrl: args.loginUrl,
      },
    };
  },
};

export const USER_AND_RESULT_TOOLS = [completeTaskTool, requestUserInputTool];

registerTools(USER_AND_RESULT_TOOLS);

