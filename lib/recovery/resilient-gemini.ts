/**
 * SOTO AI — Resilient Multi-Turn Gemini Execution Engine
 *
 * Provides bulletproof Gemini execution across all specialist agents:
 * - Per-turn transient error recovery (429, 503, timeouts) without restarting loops
 * - Exact thoughtSignature and functionCall ID preservation across turns
 * - Protocol validation and automatic thought_signature repair
 * - Capability pre-flight verification
 * - Final deliverable text auto-synthesis if model exits after tool calls
 */

import { getGeminiClient, getGeminiModel, GEMINI_REQUEST_OPTIONS } from "../gemini.ts";
import { executeWithRetry } from "./retry-policy.ts";
import { classifyError } from "./error-classifier.ts";
import { validateModelCapability } from "./capability-registry.ts";

export type ResilientToolCall = {
  name: string;
  args: Record<string, unknown>;
  id?: string;
  thoughtSignature?: string;
};

export type ResilientTurnResult = {
  text?: string;
  functionCalls?: ResilientToolCall[];
  rawCandidateContent?: unknown;
};

export type ResilientGeminiExecutionOptions = {
  model?: string;
  systemInstruction: string;
  initialPrompt: string;
  tools?: unknown[];
  maxTurns?: number;
  perTurnTimeoutMs?: number;
  executeTool?: (name: string, args: Record<string, unknown>, callId?: string) => Promise<Record<string, unknown>>;
  onStepProgress?: (step: number, actionName: string, detail: string) => void;
};

export type ResilientGeminiExecutionResult = {
  finalText: string;
  turnsCompleted: number;
  toolCallsExecuted: Array<{
    turn: number;
    name: string;
    args: Record<string, unknown>;
    response: Record<string, unknown>;
  }>;
};

/**
 * Executes a resilient multi-turn Gemini reasoning and tool loop.
 */
export async function executeResilientGeminiLoop(
  options: ResilientGeminiExecutionOptions,
): Promise<ResilientGeminiExecutionResult> {
  const {
    model = getGeminiModel(),
    systemInstruction,
    initialPrompt,
    tools = [],
    maxTurns = 5,
    perTurnTimeoutMs = 25_000,
    executeTool = async (name) => ({ output: `Tool ${name} executed.` }),
    onStepProgress,
  } = options;

  // 1. Verify model supports function calling if tools are provided
  if (tools.length > 0) {
    validateModelCapability(model, "function_calling");
  } else {
    validateModelCapability(model, "reasoning");
  }

  const client = getGeminiClient();
  const toolCallsExecuted: ResilientGeminiExecutionResult["toolCallsExecuted"] = [];

  const contents: Array<Record<string, unknown>> = [
    {
      role: "user",
      parts: [{ text: initialPrompt }],
    },
  ];

  let finalText = "";
  let turnsCompleted = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    turnsCompleted = turn + 1;

    // Execute single turn with intelligent per-turn retry
    const turnResult = await executeWithRetry(
      async (attempt) => {
        if (onStepProgress && attempt > 1) {
          onStepProgress(turn + 1, "retry_provider_turn", `Retrying model call (attempt ${attempt})`);
        }

        const response = await client.models.generateContent({
          model,
          contents: contents as any,
          config: {
            systemInstruction,
            tools: tools.length > 0 ? [{ functionDeclarations: tools as any }] : undefined,
            httpOptions: { timeout: perTurnTimeoutMs },
            abortSignal: AbortSignal.timeout(perTurnTimeoutMs),
          },
        });

        const rawCandidateContent = response.candidates?.[0]?.content;
        const functionCalls: ResilientToolCall[] = [];
        const parts = rawCandidateContent?.parts || [];

        for (const part of parts) {
          if (part.functionCall && part.functionCall.name) {
            functionCalls.push({
              name: part.functionCall.name,
              args: (part.functionCall.args as Record<string, unknown>) || {},
              id: part.functionCall.id,
              thoughtSignature: (part as any).thoughtSignature || (part.functionCall as any).thoughtSignature,
            });
          }
        }

        // Fallback for response.functionCalls
        if (functionCalls.length === 0 && response.functionCalls && response.functionCalls.length > 0) {
          for (const fc of response.functionCalls) {
            if (fc.name) {
              functionCalls.push({
                name: fc.name,
                args: (fc.args as Record<string, unknown>) || {},
                id: (fc as any).id,
                thoughtSignature: (fc as any).thoughtSignature,
              });
            }
          }
        }

        return {
          text: response.text?.trim() || undefined,
          functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
          rawCandidateContent,
        };
      },
      {
        maxAttempts: 3,
        baseDelayMs: 1500,
        maxDelayMs: 10000,
        operationName: `gemini_turn_${turn + 1}`,
      },
    );

    // If no function calls, model provided text answer
    if (!turnResult.functionCalls || turnResult.functionCalls.length === 0) {
      finalText = turnResult.text || "";
      break;
    }

    // Preserve exact candidate content with thought signatures
    if (turnResult.rawCandidateContent) {
      contents.push(turnResult.rawCandidateContent as Record<string, unknown>);
    } else {
      contents.push({
        role: "model",
        parts: turnResult.functionCalls.map((fc) => ({
          functionCall: {
            name: fc.name,
            args: fc.args,
            ...(fc.id ? { id: fc.id } : {}),
          },
          ...(fc.thoughtSignature ? { thoughtSignature: fc.thoughtSignature } : {}),
        })),
      });
    }

    // Execute tool calls
    const responseParts: Array<Record<string, unknown>> = [];
    for (const fc of turnResult.functionCalls) {
      if (onStepProgress) {
        onStepProgress(turn + 1, "execute_tool", `Executing tool ${fc.name}`);
      }

      const toolOutput = await executeTool(fc.name, fc.args, fc.id);
      toolCallsExecuted.push({
        turn: turn + 1,
        name: fc.name,
        args: fc.args,
        response: toolOutput,
      });

      responseParts.push({
        functionResponse: {
          name: fc.name,
          ...(fc.id ? { id: fc.id } : {}),
          response: toolOutput,
        },
      });
    }

    // Append function responses as next user turn
    contents.push({
      role: "user",
      parts: responseParts,
    });
  }

  // If the model completed all turns without emitting final text, run a quick synthesis turn
  if (!finalText && contents.length > 1) {
    try {
      const synthesisResult = await executeWithRetry(
        async () => {
          const resp = await client.models.generateContent({
            model,
            contents: contents as any,
            config: {
              systemInstruction,
              httpOptions: { timeout: perTurnTimeoutMs },
              abortSignal: AbortSignal.timeout(perTurnTimeoutMs),
            },
          });
          return resp.text?.trim() || "";
        },
        { maxAttempts: 2, baseDelayMs: 1000 },
      );
      finalText = synthesisResult;
    } catch (synthErr) {
      console.warn("[resilient-gemini] Text synthesis turn failed, formatting tool summary fallback:", synthErr);
      finalText = toolCallsExecuted.map((t) => {
        const out = t.response?.output ?? t.response?.summary;
        return out ? String(out) : `**${t.name}**: ${JSON.stringify(t.response)}`;
      }).join("\n\n");
    }
  }

  return {
    finalText,
    turnsCompleted,
    toolCallsExecuted,
  };
}
