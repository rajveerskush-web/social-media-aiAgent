import { RESEARCH_TOOL_DECLARATIONS, CONTENT_CREATOR_TOOL_DECLARATIONS } from "./specialist-tools.ts";

/**
 * Gemini function declarations for SOTO AI Agent Computer tools.
 * Compatible with @google/genai SDK format.
 */

export const COMPUTER_TOOL_DECLARATIONS = [
  {
    name: "takeScreenshot",
    description:
      "Capture a fresh screenshot of the current Linux desktop. Always take a screenshot when you need to observe the state of the screen or verify visual changes.",
    parameters: {
      type: "OBJECT",
      properties: {},
      required: [],
    },
  },
  {
    name: "openBrowser",
    description:
      "Launch Google Chrome browser on the desktop. Optionally specify a starting URL.",
    parameters: {
      type: "OBJECT",
      properties: {
        url: {
          type: "STRING",
          description: "Optional public HTTP/HTTPS URL to open upon launch.",
        },
      },
      required: [],
    },
  },
  {
    name: "navigateTo",
    description:
      "Navigate the open browser window to a specific public HTTP or HTTPS web page.",
    parameters: {
      type: "OBJECT",
      properties: {
        url: {
          type: "STRING",
          description: "Full public HTTP or HTTPS URL (e.g. https://example.com).",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "clickMouse",
    description:
      "Click the mouse at specified pixel coordinates (x, y) on the desktop. Supports left, right, double, and middle clicks.",
    parameters: {
      type: "OBJECT",
      properties: {
        x: {
          type: "INTEGER",
          description: "X pixel coordinate on the screen (0 to 1920).",
        },
        y: {
          type: "INTEGER",
          description: "Y pixel coordinate on the screen (0 to 1080).",
        },
        button: {
          type: "STRING",
          description: "Mouse button to click: 'left', 'right', 'double', or 'middle'. Default is 'left'.",
          enum: ["left", "right", "double", "middle"],
        },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "typeInput",
    description:
      "Type text into the currently focused window or input field, with optional key press afterwards.",
    parameters: {
      type: "OBJECT",
      properties: {
        text: {
          type: "STRING",
          description: "Text string to type into the active field.",
        },
        pressKey: {
          type: "STRING",
          description: "Optional key to press after typing: 'Enter', 'Tab', 'Escape', 'Backspace'.",
          enum: ["Enter", "Tab", "Escape", "Backspace"],
        },
      },
      required: ["text"],
    },
  },
  {
    name: "scrollDisplay",
    description:
      "Scroll the active window display up or down by a specified pixel amount.",
    parameters: {
      type: "OBJECT",
      properties: {
        direction: {
          type: "STRING",
          description: "Scroll direction: 'up' or 'down'. Default is 'down'.",
          enum: ["up", "down"],
        },
        amount: {
          type: "INTEGER",
          description: "Scroll distance in pixels between 10 and 2000. Default is 300.",
        },
      },
      required: [],
    },
  },
  {
    name: "dragMouse",
    description:
      "Click and drag mouse from starting coordinates (fromX, fromY) to ending coordinates (toX, toY).",
    parameters: {
      type: "OBJECT",
      properties: {
        fromX: { type: "INTEGER", description: "Starting X pixel coordinate." },
        fromY: { type: "INTEGER", description: "Starting Y pixel coordinate." },
        toX: { type: "INTEGER", description: "Ending X pixel coordinate." },
        toY: { type: "INTEGER", description: "Ending Y pixel coordinate." },
      },
      required: ["fromX", "fromY", "toX", "toY"],
    },
  },
  {
    name: "waitDuration",
    description:
      "Wait for a specified number of milliseconds for the page to load, animations to finish, or background work to complete.",
    parameters: {
      type: "OBJECT",
      properties: {
        ms: {
          type: "INTEGER",
          description: "Duration to wait in milliseconds (between 100 and 15000).",
        },
      },
      required: ["ms"],
    },
  },
  {
    name: "runShellCommand",
    description:
      "Execute an approved non-interactive shell command inside the computer sandbox under /home/user (e.g. curl, jq, python3, ls).",
    parameters: {
      type: "OBJECT",
      properties: {
        cmd: {
          type: "STRING",
          description: "Command string using approved binaries (e.g. 'ls -la /home/user/research').",
        },
        cwd: {
          type: "STRING",
          description: "Working directory under /home/user (e.g. '/home/user/research').",
        },
      },
      required: ["cmd"],
    },
  },
  {
    name: "readSandboxFile",
    description:
      "Read the contents of a file in the sandbox under /home/user (e.g. research notes or output text).",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description: "Absolute path to file under /home/user.",
        },
        format: {
          type: "STRING",
          description: "'text' (default) or 'bytes'.",
          enum: ["text", "bytes"],
        },
      },
      required: ["path"],
    },
  },
  {
    name: "writeSandboxFile",
    description:
      "Create or overwrite a file in the sandbox under /home/user (e.g. saving research notes or generated markdown).",
    parameters: {
      type: "OBJECT",
      properties: {
        path: {
          type: "STRING",
          description: "Absolute path to file under /home/user (e.g. '/home/user/output/summary.md').",
        },
        content: {
          type: "STRING",
          description: "Text content to write to the file.",
        },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "downloadSandboxFile",
    description:
      "Verify and stage an artifact file produced in the sandbox so it can be saved as a task output artifact.",
    parameters: {
      type: "OBJECT",
      properties: {
        sandboxPath: {
          type: "STRING",
          description: "Path to the file in /home/user (e.g. '/home/user/output/report.md').",
        },
        filename: {
          type: "STRING",
          description: "User-facing filename (e.g. 'report.md').",
        },
      },
      required: ["sandboxPath"],
    },
  },
  {
    name: "completeTask",
    description:
      "Declare the task complete, providing a structured final summary, key findings, and final outcome status. Call this when you have finished all required computer actions.",
    parameters: {
      type: "OBJECT",
      properties: {
        summary: {
          type: "STRING",
          description: "Concise summary of actions taken and final result.",
        },
        findings: {
          type: "STRING",
          description: "Detailed findings, synthesized content, or answers discovered.",
        },
        status: {
          type: "STRING",
          description: "Overall task outcome: 'success', 'partial', or 'failed'.",
          enum: ["success", "partial", "failed"],
        },
      },
      required: ["summary", "findings", "status"],
    },
  },
] as const;

export function getAgentComputerDeclarations(agentId: string) {
  if (agentId === "seat-1") {
    return [...COMPUTER_TOOL_DECLARATIONS, ...RESEARCH_TOOL_DECLARATIONS];
  }
  if (agentId === "seat-mvj4q0fn") {
    return [...COMPUTER_TOOL_DECLARATIONS, ...CONTENT_CREATOR_TOOL_DECLARATIONS];
  }
  return [...COMPUTER_TOOL_DECLARATIONS];
}

