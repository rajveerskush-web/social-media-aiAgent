import type { ToolExecutionContext, ToolResult } from "./context.ts";
import type { GeminiToolDefinition } from "./runtime.ts";
import { registerTools } from "./runtime.ts";
import { CONTENT_CREATOR_TOOL_DECLARATIONS, executeSpecialistTool } from "../../specialist-tools.ts";

const findDecl = (name: string) => {
  const d = CONTENT_CREATOR_TOOL_DECLARATIONS.find((item) => item.name === name);
  if (!d) throw new Error(`Missing content declaration: ${name}`);
  return d as unknown as GeminiToolDefinition["declaration"];
};

export const saveContentDraftTool: GeminiToolDefinition<{
  title: string;
  platform: "instagram" | "facebook" | "twitter" | "linkedin" | "tiktok";
  caption: string;
  hashtags: string[];
  hookText?: string;
  visualBrief?: string;
  imageUrl?: string;
}> = {
  declaration: findDecl("saveContentDraft"),
  execute: async (args, context): Promise<ToolResult> => {
    const res = await executeSpecialistTool("saveContentDraft", args, {
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

export const createCarouselBriefTool: GeminiToolDefinition<{
  title: string;
  theme: string;
  targetAudience: string;
  slides: Array<{
    slideNumber: number;
    headline: string;
    copy: string;
    visualDirection: string;
  }>;
}> = {
  declaration: findDecl("createCarouselBrief"),
  execute: async (args, context): Promise<ToolResult> => {
    const res = await executeSpecialistTool("createCarouselBrief", args, {
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

export const CONTENT_TOOLS = [saveContentDraftTool, createCarouselBriefTool];

registerTools(CONTENT_TOOLS);

