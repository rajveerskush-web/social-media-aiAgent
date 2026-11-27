import type { ToolExecutionContext, ToolResult } from "./context.ts";
import type { GeminiToolDefinition } from "./runtime.ts";
import { registerTools } from "./runtime.ts";
import { RESEARCH_TOOL_DECLARATIONS, executeSpecialistTool } from "../../specialist-tools.ts";

const findDecl = (name: string) => {
  const d = RESEARCH_TOOL_DECLARATIONS.find((item) => item.name === name);
  if (!d) throw new Error(`Missing research declaration: ${name}`);
  return d as unknown as GeminiToolDefinition["declaration"];
};

export const searchWebTool: GeminiToolDefinition<{
  query: string;
  focus?: "all" | "google" | "youtube" | "instagram" | "news";
}> = {
  declaration: findDecl("searchWeb"),
  execute: async (args, context): Promise<ToolResult> => {
    const res = await executeSpecialistTool("searchWeb", args, {
      authUserId: context.authUserId,
      campaignId: context.campaignId,
      taskId: context.taskId,
      agentId: context.agentId,
      computerId: context.computerId,
    });
    return {
      success: res.success,
      output: res.output,
      data: res.data,
      error: res.error,
    };
  },
};

export const recordResearchFindingsTool: GeminiToolDefinition<{
  title: string;
  summary: string;
  detailedFindings: string;
  sourceUrls?: string[];
  keyTakeaways?: string[];
  assumptions?: string[];
}> = {
  declaration: findDecl("recordResearchFindings"),
  execute: async (args, context): Promise<ToolResult> => {
    const res = await executeSpecialistTool("recordResearchFindings", args, {
      authUserId: context.authUserId,
      campaignId: context.campaignId,
      taskId: context.taskId,
      agentId: context.agentId,
      computerId: context.computerId,
    });
    return {
      success: res.success,
      output: res.output,
      artifactId: res.artifactId,
      publicUrl: res.publicUrl,
      data: res.data,
      error: res.error,
    };
  },
};

export const RESEARCH_TOOLS = [searchWebTool, recordResearchFindingsTool];

registerTools(RESEARCH_TOOLS);


