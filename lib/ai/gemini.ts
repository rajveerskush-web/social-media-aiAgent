import { getGeminiClient, getGeminiModel, GEMINI_MODEL, GEMINI_REQUEST_OPTIONS } from "../gemini.ts";
import { selectSpecialistModel } from "../gemini-model-selection.ts";
import type { ToolExecutionContext, ToolResult } from "./tools/context.ts";
import type { GeminiToolDefinition } from "./tools/runtime.ts";
import { executeRegisteredTool, formatFunctionResponsePart } from "./tools/runtime.ts";

export { getGeminiClient, getGeminiModel, GEMINI_MODEL, GEMINI_REQUEST_OPTIONS, selectSpecialistModel };

export type GeminiLoopOptions = {
  model?: string;
  systemInstruction: string;
  initialPrompt: string;
  tools: GeminiToolDefinition[];
  context: ToolExecutionContext;
  maxTurns?: number;
  timeoutMs?: number;
};

export type GeminiLoopResult = {
  finalText: string;
  toolCallsExecuted: Array<{
    name: string;
    args: Record<string, unknown>;
    result: ToolResult;
  }>;
  completedViaTerminalTool: boolean;
  terminalResult?: ToolResult;
};

/**
 * Executes a multi-turn Gemini function calling loop with strongly-typed tools.
 */
export async function runGeminiToolLoop(options: GeminiLoopOptions): Promise<GeminiLoopResult> {
  const {
    model = getGeminiModel(),
    systemInstruction,
    initialPrompt,
    tools,
    context,
    maxTurns = 5,
    timeoutMs = 30_000,
  } = options;

  const client = getGeminiClient();
  const declarations = tools.map((t) => t.declaration);

  const toolCallsExecuted: GeminiLoopResult["toolCallsExecuted"] = [];
  let finalText = "";
  let completedViaTerminalTool = false;
  let terminalResult: ToolResult | undefined;

  const contents: Array<Record<string, unknown>> = [
    {
      role: "user",
      parts: [{ text: initialPrompt }],
    },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const { executeWithRetry } = await import("../recovery/retry-policy.ts");
    const response = await executeWithRetry(
      async () => client.models.generateContent({
        model,
        contents: contents as any,
        config: {
          systemInstruction,
          tools: declarations.length > 0 ? [{ functionDeclarations: declarations as any }] : undefined,
          httpOptions: { timeout: timeoutMs },
          abortSignal: AbortSignal.timeout(timeoutMs),
        },
      }),
      {
        maxAttempts: 3,
        baseDelayMs: 1500,
        maxDelayMs: 8000,
        operationName: `gemini_tool_loop_turn_${turn + 1}`,
      },
    );

    const functionCalls = response.functionCalls || [];
    if (!functionCalls.length) {
      finalText = response.text?.trim() || "";
      break;
    }

    // Preserve the exact candidate content from the model, including thought signatures and IDs
    const candidateContent = response.candidates?.[0]?.content;
    if (candidateContent) {
      contents.push(candidateContent as any);
    } else {
      contents.push({
        role: "model",
        parts: functionCalls.map((fc: any) => ({
          functionCall: {
            name: fc.name,
            args: (fc.args as Record<string, unknown>) || {},
            ...(fc.id ? { id: fc.id } : {}),
          },
          ...(fc.thoughtSignature ? { thoughtSignature: fc.thoughtSignature } : {}),
        })),
      });
    }

    // Execute each function call and gather responses
    const responseParts: Array<Record<string, unknown>> = [];
    for (const fc of functionCalls) {
      const toolName = fc.name || "";
      const args = (fc.args as Record<string, unknown>) || {};
      const callId = (fc as any).id;
      const result = await executeRegisteredTool(toolName, args, context);

      toolCallsExecuted.push({ name: toolName, args, result });

      if (toolName === "completeTask") {
        completedViaTerminalTool = true;
        terminalResult = result;
      }

      const part = formatFunctionResponsePart(toolName, result, callId);
      responseParts.push(part as any);
    }

    // Append user response containing function responses
    contents.push({
      role: "user",
      parts: responseParts,
    });

    if (completedViaTerminalTool) {
      finalText = terminalResult?.output || "Task completed successfully.";
      break;
    }
  }

  return {
    finalText,
    toolCallsExecuted,
    completedViaTerminalTool,
    terminalResult,
  };
}

