export const COMPUTER_AGENT_IDS = ["seat-1", "seat-mvj4q0fn"] as const;
export type ComputerAgentId = (typeof COMPUTER_AGENT_IDS)[number];

export function isComputerEligible(agentId: unknown): agentId is ComputerAgentId {
  return typeof agentId === "string" && (COMPUTER_AGENT_IDS as readonly string[]).includes(agentId);
}

export type ComputerStatus =
  | "creating"
  | "running"
  | "paused"
  | "stopping"
  | "stopped"
  | "terminated"
  | "error";

export type ComputerControlMode = "agent" | "human";

export type ComputerTaskStatus =
  | "active"
  | "waiting_for_user"
  | "completed"
  | "failed"
  | "cancelled";

export class HumanTakeoverActiveError extends Error {
  constructor(message = "AI computer actions are blocked while user is in control.") {
    super(message);
    this.name = "HumanTakeoverActiveError";
  }
}

export class CampaignEndedAbortError extends Error {
  constructor(message = "Campaign has ended. Aborting computer execution.") {
    super(message);
    this.name = "CampaignEndedAbortError";
  }
}

export class IneligibleAgentComputerError extends Error {
  constructor(agentId: string) {
    super(`Agent ${agentId} is not eligible for a cloud computer.`);
    this.name = "IneligibleAgentComputerError";
  }
}

export class ComputerConcurrencyConflictError extends Error {
  constructor(message = "Another task is already controlling this agent computer.") {
    super(message);
    this.name = "ComputerConcurrencyConflictError";
  }
}

export class UnsafeNavigationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeNavigationError";
  }
}

export class InvalidPathAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPathAccessError";
  }
}

export class ProhibitedCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProhibitedCommandError";
  }
}

export type ComputerToolContext = {
  authUserId: string;
  campaignId: number;
  agentId: string;
  taskId?: number;
  computerId?: number;
};

export type ToolExecutionResult<T = unknown> = {
  tool: string;
  params: Record<string, unknown>;
  attempted: boolean;
  verified: boolean;
  data?: T;
  screenshotBase64?: string;
  error?: string;
  failureReason?: string;
  timestamp: string;
};

export class ComputerNotRunningError extends Error {
  constructor(message = "Computer sandbox is not currently running.") {
    super(message);
    this.name = "ComputerNotRunningError";
  }
}

export class ArtifactNotFoundError extends Error {
  constructor(message = "Artifact not found or access denied.") {
    super(message);
    this.name = "ArtifactNotFoundError";
  }
}

export class ArtifactUnverifiedError extends Error {
  constructor(message = "Artifact is unverified or has invalid size.") {
    super(message);
    this.name = "ArtifactUnverifiedError";
  }
}

export interface E2BVNCServerLike {
  start(opts?: { requireAuth?: boolean; vncPort?: number; port?: number }): Promise<void>;
  getAuthKey(): string;
  getUrl(opts?: {
    autoConnect?: boolean;
    viewOnly?: boolean;
    resize?: "off" | "scale" | "remote";
    authKey?: string;
  }): string;
  stop?(): Promise<void>;
}

export interface E2BDesktopSandboxLike {
  sandboxId?: string;
  stream?: E2BVNCServerLike;
  kill?(): Promise<void>;
  pause?(): Promise<void>;
  screenshot(format?: "bytes"): Promise<Uint8Array>;
  leftClick(x?: number, y?: number): Promise<void>;
  rightClick(x?: number, y?: number): Promise<void>;
  doubleClick(x?: number, y?: number): Promise<void>;
  middleClick?(x?: number, y?: number): Promise<void>;
  write(text: string, options?: { delay?: number }): Promise<void>;
  press(key: string | string[]): Promise<void>;
  scroll(direction?: "up" | "down", amount?: number): Promise<void>;
  drag(from: [number, number], to: [number, number]): Promise<void>;
  wait(ms: number): Promise<void>;
  open(fileOrUrl: string): Promise<void>;
  launch(application: string, uri?: string): Promise<void>;
  files: {
    read(path: string, opts?: { format?: "text" }): Promise<string>;
    read(path: string, opts: { format: "bytes" }): Promise<Uint8Array>;
    write(path: string, data: string | Uint8Array | ArrayBuffer): Promise<unknown>;
  };
  commands: {
    run(
      cmd: string,
      opts?: { timeoutMs?: number; cwd?: string; envs?: Record<string, string> },
    ): Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>;
  };
}

/**
 * Pure check to verify if AI computer actions are permitted.
 * Throws immediately if user has taken over control or campaign has ended.
 */
export function assertComputerActionAllowed(
  controlMode: string,
  campaignStatus = "active",
): void {
  if (campaignStatus === "ended") {
    throw new CampaignEndedAbortError("Campaign has ended. AI actions are aborted.");
  }
  if (controlMode === "human") {
    throw new HumanTakeoverActiveError(
      "AI computer actions are blocked while user is in control.",
    );
  }
}

export type VerifiedAction = {
  action: string;
  params?: Record<string, unknown>;
  attempted: boolean;
  verified: boolean;
  failureReason?: string;
  timestamp: string;
};

export type ComputerTaskResult = {
  summary: string;
  findings: string;
  computerUsed: boolean;
  actions: VerifiedAction[];
  unverifiedActions: VerifiedAction[];
  artifacts: Array<{
    filename: string;
    verified: boolean;
    sizeBytes?: number;
    artifactType: string;
    url?: string;
  }>;
  sourceUrls: string[];
  status: "success" | "partial" | "failed";
};
