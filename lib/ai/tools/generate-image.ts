import type { ToolExecutionContext, ToolResult } from "./context.ts";
import type { GeminiToolDefinition } from "./runtime.ts";
import { registerTools } from "./runtime.ts";
import { CONTENT_CREATOR_TOOL_DECLARATIONS, executeSpecialistTool } from "../../specialist-tools.ts";

const findDecl = (name: string) => {
  const d = CONTENT_CREATOR_TOOL_DECLARATIONS.find((item) => item.name === name);
  if (!d) throw new Error(`Missing image generation declaration: ${name}`);
  return d as unknown as GeminiToolDefinition["declaration"];
};

export const generateImageTool: GeminiToolDefinition<{
  prompt: string;
  aspectRatio?: "1:1" | "4:5" | "16:9" | "9:16";
  stylePreset?: "photorealistic" | "editorial" | "cinematic" | "flat_lay" | "illustration" | "minimalist";
  negativePrompt?: string;
  outputFormat?: "image/png" | "image/jpeg";
}> = {
  declaration: findDecl("generateImage"),
  execute: async (args, context): Promise<ToolResult> => {
    const res = await executeSpecialistTool("generateImage", args, {
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

export const IMAGE_TOOLS = [generateImageTool];

registerTools(IMAGE_TOOLS);

