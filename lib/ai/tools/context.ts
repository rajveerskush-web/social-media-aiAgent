/**
 * Shared execution context for all Gemini AI tools in SOTO AI.
 */

export type ToolExecutionContext = {
  authUserId: string;
  campaignId: number;
  taskId: number;
  agentId: string;
  computerId?: number | null;
  campaignName?: string;
  /**
   * Reference to active E2B sandbox instance if computer mode is active
   */
  sandbox?: unknown;
};

export type ToolResult<T = unknown> = {
  success: boolean;
  output: string;
  data?: T;
  artifactId?: number;
  publicUrl?: string;
  error?: string;
};

