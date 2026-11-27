import type { ToolExecutionContext, ToolResult } from "./context.ts";

export type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  parameters: {
    type: "OBJECT";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type GeminiToolDefinition<TArgs = any, TResult = unknown> = {
  declaration: GeminiFunctionDeclaration;
  execute: (args: TArgs, context: ToolExecutionContext) => Promise<ToolResult<TResult>>;
};

const toolRegistry = new Map<string, GeminiToolDefinition<any, any>>();

export function registerTool(tool: GeminiToolDefinition<any, any>): void {
  toolRegistry.set(tool.declaration.name, tool);
}

export function registerTools(tools: Array<GeminiToolDefinition<any, any>>): void {
  for (const tool of tools) {
    registerTool(tool);
  }
}

export function getTool(name: string): GeminiToolDefinition<any, any> | undefined {
  return toolRegistry.get(name);
}

export function getAllToolDeclarations(): GeminiFunctionDeclaration[] {
  return Array.from(toolRegistry.values()).map((t) => t.declaration);
}

export async function executeRegisteredTool(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<ToolResult> {
  const tool = toolRegistry.get(toolName);
  if (!tool) {
    return {
      success: false,
      output: `Tool '${toolName}' is not recognized by SOTO AI tools runtime.`,
      error: `Unknown tool: ${toolName}`,
    };
  }

  try {
    return await tool.execute(args, context);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: `Tool execution failed: ${message}`,
      error: message,
    };
  }
}

export function formatFunctionResponsePart(toolName: string, result: ToolResult, callId?: string): {
  functionResponse: {
    name: string;
    id?: string;
    response: Record<string, unknown>;
  };
} {
  return {
    functionResponse: {
      name: toolName,
      ...(callId ? { id: callId } : {}),
      response: {
        success: result.success,
        output: result.output,
        ...(result.data ? { data: result.data } : {}),
        ...(result.artifactId ? { artifactId: result.artifactId } : {}),
        ...(result.publicUrl ? { publicUrl: result.publicUrl } : {}),
        ...(result.error ? { error: result.error } : {}),
      },
    },
  };
}
