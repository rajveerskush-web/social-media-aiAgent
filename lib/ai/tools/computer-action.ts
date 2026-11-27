import type { ToolExecutionContext, ToolResult } from "./context.ts";
import type { GeminiToolDefinition } from "./runtime.ts";
import { registerTools } from "./runtime.ts";
import { COMPUTER_TOOL_DECLARATIONS } from "../../computer-declarations.ts";
import {
  takeScreenshot,
  openBrowser,
  navigateTo,
  clickMouse,
  typeInput,
  scrollDisplay,
  dragMouse,
  waitDuration,
  runShellCommand,
} from "../../computer-tools.ts";
import type { E2BDesktopSandboxLike, ComputerToolContext } from "../../computer-types.ts";

function requireSandbox(context: ToolExecutionContext): E2BDesktopSandboxLike {
  if (!context.sandbox) {
    throw new Error("E2B Desktop Sandbox is not attached to this execution context.");
  }
  return context.sandbox as E2BDesktopSandboxLike;
}

function toComputerContext(context: ToolExecutionContext): ComputerToolContext {
  return {
    authUserId: context.authUserId,
    campaignId: context.campaignId,
    taskId: context.taskId,
    agentId: context.agentId,
    computerId: context.computerId ?? undefined,
  };
}

const findDecl = (name: string) => {
  const d = COMPUTER_TOOL_DECLARATIONS.find((item) => item.name === name);
  if (!d) throw new Error(`Missing computer declaration: ${name}`);
  return d as unknown as GeminiToolDefinition["declaration"];
};

export const takeScreenshotTool: GeminiToolDefinition = {
  declaration: findDecl("takeScreenshot"),
  execute: async (_args, context): Promise<ToolResult> => {
    const sandbox = requireSandbox(context);
    const result = await takeScreenshot(sandbox, toComputerContext(context));
    return {
      success: result.verified,
      output: result.verified
        ? "Screenshot captured successfully."
        : `Screenshot capture failed: ${result.error}`,
      data: { screenshotBase64: result.screenshotBase64 },
      error: result.error,
    };
  },
};

export const openBrowserTool: GeminiToolDefinition<{ url?: string }> = {
  declaration: findDecl("openBrowser"),
  execute: async (args, context): Promise<ToolResult> => {
    const sandbox = requireSandbox(context);
    const result = await openBrowser(sandbox, toComputerContext(context), args.url);
    return {
      success: result.verified,
      output: result.verified
        ? `Browser opened successfully${args.url ? ` at ${args.url}` : ""}.`
        : `Failed to open browser: ${result.error}`,
      data: result.data,
      error: result.error,
    };
  },
};

export const navigateToTool: GeminiToolDefinition<{ url: string }> = {
  declaration: findDecl("navigateTo"),
  execute: async (args, context): Promise<ToolResult> => {
    const sandbox = requireSandbox(context);
    const result = await navigateTo(sandbox, toComputerContext(context), args.url);
    return {
      success: result.verified,
      output: result.verified
        ? `Navigated to ${args.url}.`
        : `Navigation failed: ${result.error}`,
      data: result.data,
      error: result.error,
    };
  },
};

export const clickMouseTool: GeminiToolDefinition<{
  x: number;
  y: number;
  button?: "left" | "right" | "double" | "middle";
}> = {
  declaration: findDecl("clickMouse"),
  execute: async (args, context): Promise<ToolResult> => {
    const sandbox = requireSandbox(context);
    const result = await clickMouse(sandbox, toComputerContext(context), {
      x: Number(args.x),
      y: Number(args.y),
      button: args.button,
    });
    return {
      success: result.verified,
      output: result.verified
        ? `Clicked at (${args.x}, ${args.y}) with ${args.button ?? "left"} button.`
        : `Mouse click failed: ${result.error}`,
      error: result.error,
    };
  },
};

export const typeInputTool: GeminiToolDefinition<{ text: string; pressEnter?: boolean }> = {
  declaration: findDecl("typeInput"),
  execute: async (args, context): Promise<ToolResult> => {
    const sandbox = requireSandbox(context);
    const result = await typeInput(sandbox, toComputerContext(context), {
      text: args.text,
      key: args.pressEnter ? "Enter" : undefined,
    });
    return {
      success: result.verified,
      output: result.verified ? "Typed input into active element." : `Type failed: ${result.error}`,
      error: result.error,
    };
  },
};

export const scrollDisplayTool: GeminiToolDefinition<{
  direction: "up" | "down" | "left" | "right";
  amount?: number;
}> = {
  declaration: findDecl("scrollDisplay"),
  execute: async (args, context): Promise<ToolResult> => {
    const sandbox = requireSandbox(context);
    const direction = args.direction === "up" ? "up" : "down";
    const result = await scrollDisplay(
      sandbox,
      toComputerContext(context),
      direction,
      args.amount ?? 5,
    );
    return {
      success: result.verified,
      output: result.verified
        ? `Scrolled ${args.direction} by ${args.amount ?? 5} units.`
        : `Scroll failed: ${result.error}`,
      error: result.error,
    };
  },
};

export const dragMouseTool: GeminiToolDefinition<{
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}> = {
  declaration: findDecl("dragMouse"),
  execute: async (args, context): Promise<ToolResult> => {
    const sandbox = requireSandbox(context);
    const result = await dragMouse(
      sandbox,
      toComputerContext(context),
      [Number(args.fromX), Number(args.fromY)],
      [Number(args.toX), Number(args.toY)],
    );
    return {
      success: result.verified,
      output: result.verified ? "Mouse dragged." : `Drag failed: ${result.error}`,
      error: result.error,
    };
  },
};

export const waitDurationTool: GeminiToolDefinition<{ ms: number }> = {
  declaration: findDecl("waitDuration"),
  execute: async (args, context): Promise<ToolResult> => {
    const sandbox = requireSandbox(context);
    const result = await waitDuration(sandbox, toComputerContext(context), Number(args.ms || 1000));
    return {
      success: result.verified,
      output: `Waited ${args.ms || 1000}ms.`,
      error: result.error,
    };
  },
};

export const runShellCommandTool: GeminiToolDefinition<{ cmd: string; cwd?: string }> = {
  declaration: findDecl("runShellCommand"),
  execute: async (args, context): Promise<ToolResult> => {
    const sandbox = requireSandbox(context);
    const result = await runShellCommand(sandbox, toComputerContext(context), String(args.cmd), {
      cwd: args.cwd,
    });
    return {
      success: result.verified,
      output: result.verified
        ? `Command executed successfully: ${result.data?.stdout || "(no output)"}`
        : `Command failed: ${result.error || result.data?.stderr}`,
      data: result.data,
      error: result.error,
    };
  },
};

export const COMPUTER_ACTION_TOOLS = [
  takeScreenshotTool,
  openBrowserTool,
  navigateToTool,
  clickMouseTool,
  typeInputTool,
  scrollDisplayTool,
  dragMouseTool,
  waitDurationTool,
  runShellCommandTool,
];

registerTools(COMPUTER_ACTION_TOOLS);
