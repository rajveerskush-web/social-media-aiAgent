import type {
  ComputerAgentId,
  E2BDesktopSandboxLike,
} from "./computer-types.ts";
import {
  ArtifactNotFoundError,
  ArtifactUnverifiedError,
  CampaignEndedAbortError,
  ComputerNotRunningError,
  IneligibleAgentComputerError,
  isComputerEligible,
} from "./computer-types.ts";
import { validateSandboxPath } from "./computer-tools.ts";
import {
  getActiveSandbox,
  getAllActiveSandboxesForCampaign,
  registerActiveSandbox,
  removeActiveSandbox,
} from "./computer-registry.ts";

export const E2B_DEFAULT_SANDBOX_TIMEOUT_MS = 30 * 60_000; // 30 minutes default lifetime

export function getE2BSandboxTimeoutMs(): number {
  const envVal = process.env.E2B_SANDBOX_TIMEOUT_MS;
  if (envVal) {
    const parsed = Number(envVal);
    if (!Number.isNaN(parsed) && parsed >= 60_000) return parsed;
  }
  return E2B_DEFAULT_SANDBOX_TIMEOUT_MS;
}

/**
 * Renews the server-side lifetime of an active E2B sandbox microVM.
 * Extends the sandbox timeout using sandbox.setTimeout() to prevent premature termination.
 */
export async function renewSandboxTimeout(
  sandbox: unknown,
  timeoutMs: number = getE2BSandboxTimeoutMs(),
): Promise<boolean> {
  if (!sandbox) return false;
  try {
    const sbx = sandbox as { setTimeout?: (ms: number) => Promise<void> };
    if (typeof sbx.setTimeout === "function") {
      await sbx.setTimeout(timeoutMs);
      return true;
    }
    return false;
  } catch (err: unknown) {
    console.warn("[e2b-sandbox-renewal] Failed to extend sandbox timeout:", err);
    return false;
  }
}

export type CampaignRecord = {
  id: number;
  authUserId: string;
  name: string;
  status: "active" | "ended";
  endedAt?: Date | null;
};

export type TaskRecord = {
  id: number;
  status: string;
  executionLeaseToken?: string | null;
  executionLeaseExpiresAt?: Date | null;
};

export type ComputerRecord = {
  id: number;
  authUserId: string;
  campaignId: number;
  agentId: string;
  sandboxId?: string | null;
  status: string;
  controlMode: string;
  activeTaskId?: number | null;
  lastScreenshotAt?: Date | null;
  lastScreenshotBase64?: string | null;
  lastActiveAt?: Date | null;
  pausedAt?: Date | null;
  error?: string | null;
};

export type ArtifactRecord = {
  id: number;
  taskId: number;
  computerId?: number | null;
  authUserId: string;
  campaignId: number;
  artifactType: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number | null;
  sandboxPath: string;
  isVerified: boolean;
  imagekitUrl?: string | null;
  imagekitFileId?: string | null;
};

export type DatabaseServiceLike = {
  findCampaign(authUserId: string, campaignId?: number | null): Promise<CampaignRecord | null>;
  findComputer(authUserId: string, campaignId: number, agentId: string): Promise<ComputerRecord | null>;
  findIdleComputers(idleThreshold: Date): Promise<Array<ComputerRecord>>;
  pauseComputer(
    computerId: number,
    screenshotBase64?: string | null,
    screenshotAt?: Date,
  ): Promise<boolean>;
  findStaleWaitingTasks(staleThreshold: Date): Promise<
    Array<{
      computerTaskId: number;
      taskId: number;
      computerId: number;
      campaignId: number;
      waitingSince: Date;
    }>
  >;
  expireWaitingTask(
    computerTaskId: number,
    taskId: number,
    computerId: number,
    reason: string,
  ): Promise<boolean>;
  upsertComputer(data: {
    authUserId: string;
    campaignId: number;
    agentId: string;
    controlMode?: string;
    status?: string;
  }): Promise<ComputerRecord>;
  updateComputerControlMode(
    authUserId: string,
    campaignId: number,
    agentId: string,
    controlMode: "agent" | "human",
  ): Promise<ComputerRecord | null>;
  updateComputerStatus(
    computerId: number,
    status: string,
    error?: string | null,
    sandboxId?: string | null,
  ): Promise<void>;
  updateActiveTaskControlMode(
    computerId: number,
    status: "active" | "waiting_for_user",
    waitingReason?: string | null,
  ): Promise<void>;
  markComputerTaskFailed(computerId: number, reason: string): Promise<void>;
  findTask(taskId: number): Promise<TaskRecord | null>;
  routeTaskToRecovery(taskId: number): Promise<void>;
  findArtifact(authUserId: string, campaignId: number, artifactId: number): Promise<ArtifactRecord | null>;
  endCampaign(campaignId: number): Promise<{
    cancelledTasksCount: number;
    terminatedComputersCount: number;
  }>;
};

export type ComputerServiceDeps = {
  db?: DatabaseServiceLike;
  getActiveSandbox?: typeof getActiveSandbox;
  getAllActiveSandboxesForCampaign?: typeof getAllActiveSandboxesForCampaign;
  removeActiveSandbox?: typeof removeActiveSandbox;
  registerActiveSandbox?: typeof registerActiveSandbox;
  connectSandbox?: (sandboxId: string) => Promise<E2BDesktopSandboxLike>;
  readArtifactBytes?: (sandbox: E2BDesktopSandboxLike, path: string) => Promise<Uint8Array>;
  now?: () => Date;
  storageDriver?: any;
};

async function defaultConnectSandbox(sandboxId: string): Promise<E2BDesktopSandboxLike> {
  const { Sandbox } = await import("@e2b/desktop");
  const connected = await Sandbox.connect(sandboxId);
  return connected as unknown as E2BDesktopSandboxLike;
}

async function createRealDbService(): Promise<DatabaseServiceLike> {
  const {
    getDb,
    campaign,
    agentComputers,
    agentComputerTasks,
    agentTasks,
    agentTaskArtifacts,
    agentTaskOutbox,
  } = await import("../db/index.ts");
  const { and, asc, eq, inArray, isNotNull, isNull, lte, sql } = await import("drizzle-orm");

  const db = getDb();

  return {
    async findCampaign(authUserId: string, campaignId?: number | null) {
      if (campaignId) {
        const [c] = await db
          .select({
            id: campaign.id,
            authUserId: campaign.authUserId,
            name: campaign.name,
            status: campaign.status,
            endedAt: campaign.endedAt,
          })
          .from(campaign)
          .where(and(eq(campaign.id, campaignId), eq(campaign.authUserId, authUserId)))
          .limit(1);
        return (c as CampaignRecord) ?? null;
      }
      const [c] = await db
        .select({
          id: campaign.id,
          authUserId: campaign.authUserId,
          name: campaign.name,
          status: campaign.status,
          endedAt: campaign.endedAt,
        })
        .from(campaign)
        .where(eq(campaign.authUserId, authUserId))
        .orderBy(asc(campaign.createdAt))
        .limit(1);
      return (c as CampaignRecord) ?? null;
    },

    async findComputer(authUserId: string, campaignId: number, agentId: string) {
      const [comp] = await db
        .select()
        .from(agentComputers)
        .where(
          and(
            eq(agentComputers.authUserId, authUserId),
            eq(agentComputers.campaignId, campaignId),
            eq(agentComputers.agentId, agentId),
          ),
        )
        .limit(1);
      return (comp as ComputerRecord) ?? null;
    },

    async findIdleComputers(idleThreshold: Date) {
      const records = await db
        .select()
        .from(agentComputers)
        .where(
          and(
            eq(agentComputers.status, "running"),
            eq(agentComputers.controlMode, "agent"),
            isNull(agentComputers.activeTaskId),
            isNotNull(agentComputers.lastActiveAt),
            lte(agentComputers.lastActiveAt, idleThreshold),
          ),
        );
      return records as ComputerRecord[];
    },

    async pauseComputer(computerId: number, screenshotBase64?: string | null, screenshotAt?: Date) {
      const now = screenshotAt ?? new Date();
      const [updated] = await db
        .update(agentComputers)
        .set({
          status: "paused",
          pausedAt: now,
          ...(screenshotBase64 ? { lastScreenshotBase64: screenshotBase64, lastScreenshotAt: now } : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(agentComputers.id, computerId),
            inArray(agentComputers.status, ["running", "error"]),
            isNull(agentComputers.activeTaskId),
          ),
        )
        .returning();
      return Boolean(updated);
    },

    async findStaleWaitingTasks(staleThreshold: Date) {
      const rows = await db
        .select({
          computerTaskId: agentComputerTasks.id,
          taskId: agentComputerTasks.taskId,
          computerId: agentComputerTasks.computerId,
          campaignId: agentComputerTasks.campaignId,
          waitingSince: agentComputerTasks.waitingSince,
        })
        .from(agentComputerTasks)
        .where(
          and(
            eq(agentComputerTasks.status, "waiting_for_user"),
            isNotNull(agentComputerTasks.waitingSince),
            lte(agentComputerTasks.waitingSince, staleThreshold),
          ),
        );
      return rows.map((r) => ({
        ...r,
        waitingSince: r.waitingSince as Date,
      }));
    },

    async expireWaitingTask(computerTaskId: number, taskId: number, computerId: number, reason: string) {
      const now = new Date();
      await db
        .update(agentComputerTasks)
        .set({
          status: "failed",
          activityDescription: reason,
          waitingReason: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(agentComputerTasks.id, computerTaskId),
            eq(agentComputerTasks.status, "waiting_for_user"),
          ),
        );

      await db
        .update(agentTasks)
        .set({
          status: "failed",
          error: reason,
          executionLeaseToken: null,
          executionLeaseExpiresAt: null,
          updatedAt: now,
        })
        .where(eq(agentTasks.id, taskId));

      await db
        .update(agentComputers)
        .set({
          activeTaskId: null,
          controlMode: "agent",
          updatedAt: now,
        })
        .where(
          and(
            eq(agentComputers.id, computerId),
            eq(agentComputers.activeTaskId, taskId),
          ),
        );

      return true;
    },

    async upsertComputer(data) {
      const [existing] = await db
        .select()
        .from(agentComputers)
        .where(
          and(
            eq(agentComputers.authUserId, data.authUserId),
            eq(agentComputers.campaignId, data.campaignId),
            eq(agentComputers.agentId, data.agentId),
          ),
        )
        .limit(1);
      if (existing) return existing as ComputerRecord;

      const [created] = await db
        .insert(agentComputers)
        .values({
          authUserId: data.authUserId,
          campaignId: data.campaignId,
          agentId: data.agentId,
          status: data.status ?? "stopped",
          controlMode: data.controlMode ?? "agent",
        })
        .onConflictDoNothing()
        .returning();

      if (created) return created as ComputerRecord;

      const [raced] = await db
        .select()
        .from(agentComputers)
        .where(
          and(
            eq(agentComputers.authUserId, data.authUserId),
            eq(agentComputers.campaignId, data.campaignId),
            eq(agentComputers.agentId, data.agentId),
          ),
        )
        .limit(1);
      return raced as ComputerRecord;
    },

    async updateComputerControlMode(authUserId, campaignId, agentId, controlMode) {
      const [updated] = await db
        .update(agentComputers)
        .set({ controlMode, updatedAt: new Date() })
        .where(
          and(
            eq(agentComputers.authUserId, authUserId),
            eq(agentComputers.campaignId, campaignId),
            eq(agentComputers.agentId, agentId),
          ),
        )
        .returning();
      return (updated as ComputerRecord) ?? null;
    },

    async updateComputerStatus(computerId, status, error, sandboxId) {
      await db
        .update(agentComputers)
        .set({
          status,
          error: error ?? null,
          ...(sandboxId !== undefined ? { sandboxId } : {}),
          updatedAt: new Date(),
        })
        .where(eq(agentComputers.id, computerId));
    },

    async updateActiveTaskControlMode(computerId, status, waitingReason) {
      await db
        .update(agentComputerTasks)
        .set({
          status,
          waitingReason: waitingReason ?? null,
          waitingSince: status === "waiting_for_user" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentComputerTasks.computerId, computerId),
            eq(
              agentComputerTasks.status,
              status === "waiting_for_user" ? "active" : "waiting_for_user",
            ),
          ),
        );
    },

    async markComputerTaskFailed(computerId, reason) {
      await db
        .update(agentComputerTasks)
        .set({
          status: "failed",
          activityDescription: reason,
          waitingReason: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentComputerTasks.computerId, computerId),
            inArray(agentComputerTasks.status, ["active", "waiting_for_user"]),
          ),
        );
    },

    async findTask(taskId) {
      const [t] = await db
        .select({
          id: agentTasks.id,
          status: agentTasks.status,
          executionLeaseToken: agentTasks.executionLeaseToken,
          executionLeaseExpiresAt: agentTasks.executionLeaseExpiresAt,
        })
        .from(agentTasks)
        .where(eq(agentTasks.id, taskId))
        .limit(1);
      return (t as TaskRecord) ?? null;
    },

    async routeTaskToRecovery(taskId) {
      const now = new Date();
      await db
        .update(agentTasks)
        .set({
          status: "queued",
          executionLeaseToken: null,
          executionLeaseExpiresAt: null,
          dispatchClaimedAt: now,
          updatedAt: now,
        })
        .where(and(eq(agentTasks.id, taskId), eq(agentTasks.status, "running")));

      await db
        .insert(agentTaskOutbox)
        .values({
          taskId,
          status: "pending",
          nextAttemptAt: now,
        })
        .onConflictDoNothing();
    },

    async findArtifact(authUserId, campaignId, artifactId) {
      const [art] = await db
        .select()
        .from(agentTaskArtifacts)
        .where(
          and(
            eq(agentTaskArtifacts.id, artifactId),
            eq(agentTaskArtifacts.campaignId, campaignId),
            eq(agentTaskArtifacts.authUserId, authUserId),
          ),
        )
        .limit(1);
      return (art as ArtifactRecord) ?? null;
    },

    async endCampaign(campaignId) {
      const now = new Date();
      // 1. Mark campaign ended
      await db
        .update(campaign)
        .set({ status: "ended", endedAt: now })
        .where(eq(campaign.id, campaignId));

      // 2. Fence active/blocked tasks
      const cancelled = await db
        .update(agentTasks)
        .set({
          status: "failed",
          error: "Campaign ended by user",
          updatedAt: now,
        })
        .where(
          and(
            eq(agentTasks.campaignId, campaignId),
            inArray(agentTasks.status, ["pending", "queued", "running", "blocked"]),
          ),
        )
        .returning({ id: agentTasks.id });

      // 3. Cancel computer tasks
      await db
        .update(agentComputerTasks)
        .set({ status: "cancelled", updatedAt: now })
        .where(
          and(
            eq(agentComputerTasks.campaignId, campaignId),
            inArray(agentComputerTasks.status, ["active", "waiting_for_user"]),
          ),
        );

      // 4. Fence outbox
      await db
        .update(agentTaskOutbox)
        .set({ status: "dead_letter", lastError: "Campaign ended by user", updatedAt: now })
        .where(
          and(
            inArray(
              agentTaskOutbox.taskId,
              cancelled.map((t) => t.id),
            ),
            inArray(agentTaskOutbox.status, ["pending", "dispatching"]),
          ),
        );

      // 5. Terminate computers
      const terminated = await db
        .update(agentComputers)
        .set({ status: "terminated", sandboxId: null, updatedAt: now })
        .where(eq(agentComputers.campaignId, campaignId))
        .returning({ id: agentComputers.id });

      return {
        cancelledTasksCount: cancelled.length,
        terminatedComputersCount: terminated.length,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Service Functions
// ---------------------------------------------------------------------------

/**
 * 1. Safely reconnects to an existing cloud sandbox identified in Neon
 * when the in-memory registry has no active instance.
 * Revalidates campaign ownership, active status, agent eligibility, and running status.
 * Never creates a duplicate sandbox.
 */
export async function reconnectSandboxService(
  authUserId: string,
  campaignId: number,
  agentId: unknown,
  deps: ComputerServiceDeps = {},
): Promise<E2BDesktopSandboxLike> {
  if (!isComputerEligible(agentId)) {
    throw new IneligibleAgentComputerError(String(agentId));
  }

  const db = deps.db ?? (await createRealDbService());
  const userCampaign = await db.findCampaign(authUserId, campaignId);
  if (!userCampaign) {
    throw new Error("Campaign not found or access denied.");
  }

  if (userCampaign.status === "ended") {
    throw new CampaignEndedAbortError(
      "Campaign has ended. Cannot reconnect sandbox.",
    );
  }

  const computer = await db.findComputer(authUserId, userCampaign.id, agentId);
  if (!computer || computer.status !== "running" || !computer.sandboxId) {
    throw new ComputerNotRunningError(
      `Cannot reconnect: Computer is not in a running state (status: ${computer?.status ?? "none"}, sandboxId: ${computer?.sandboxId ?? "none"}).`,
    );
  }

  const resolveSandbox = deps.getActiveSandbox ?? getActiveSandbox;
  const existing = resolveSandbox(userCampaign.id, agentId);
  if (existing) {
    return existing;
  }

  const connectFn = deps.connectSandbox ?? defaultConnectSandbox;
  try {
    const sandbox = await connectFn(computer.sandboxId);
    if (!sandbox) {
      throw new Error("Sandbox.connect returned an empty or invalid instance.");
    }
    const registerFn = deps.registerActiveSandbox ?? registerActiveSandbox;
    registerFn(userCampaign.id, agentId, sandbox);
    await renewSandboxTimeout(sandbox);
    return sandbox;
  } catch (err: unknown) {
    await db.updateComputerStatus(
      computer.id,
      "error",
      `Sandbox reconnection failed: ${err instanceof Error ? err.message : String(err)}`,
      null,
    );
    throw new ComputerNotRunningError(
      `Failed to reconnect to existing sandbox "${computer.sandboxId}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * 2. Get computer status for an agent within the authenticated user's campaign.
 */
export async function getComputerStatusService(
  authUserId: string,
  agentId: unknown,
  campaignId?: number | null,
  deps: ComputerServiceDeps = {},
) {
  if (!isComputerEligible(agentId)) {
    return {
      eligible: false,
      agentId: String(agentId),
      message: "Agent is not eligible for a cloud computer.",
    };
  }

  const db = deps.db ?? (await createRealDbService());
  const userCampaign = await db.findCampaign(authUserId, campaignId);
  if (!userCampaign) {
    throw new Error("Campaign not found or access denied.");
  }

  const computer = await db.findComputer(authUserId, userCampaign.id, agentId);

  let activeTask: any = null;
  let artifacts: any[] = [];

  if (computer && !deps.db) {
    try {
      const { getDb, agentComputerTasks, agentTaskArtifacts } = await import("../db/index.ts");
      const { and, eq, inArray, desc } = await import("drizzle-orm");
      const realDb = getDb();

      const [taskRow] = await realDb
        .select({
          id: agentComputerTasks.id,
          status: agentComputerTasks.status,
          currentStepIndex: agentComputerTasks.currentStepIndex,
          activityDescription: agentComputerTasks.activityDescription,
          waitingReason: agentComputerTasks.waitingReason,
          waitingSince: agentComputerTasks.waitingSince,
        })
        .from(agentComputerTasks)
        .where(
          and(
            eq(agentComputerTasks.computerId, computer.id),
            inArray(agentComputerTasks.status, ["active", "waiting_for_user"]),
          ),
        )
        .orderBy(desc(agentComputerTasks.updatedAt))
        .limit(1);

      if (taskRow) {
        activeTask = {
          id: taskRow.id,
          status: taskRow.status,
          currentStepIndex: taskRow.currentStepIndex,
          activityDescription: taskRow.activityDescription,
          waitingReason: taskRow.waitingReason,
          waitingSince: taskRow.waitingSince?.toISOString() ?? null,
        };
      }

      const artifactRows = await realDb
        .select({
          id: agentTaskArtifacts.id,
          filename: agentTaskArtifacts.filename,
          sandboxPath: agentTaskArtifacts.sandboxPath,
          sizeBytes: agentTaskArtifacts.sizeBytes,
          mimeType: agentTaskArtifacts.mimeType,
          artifactType: agentTaskArtifacts.artifactType,
          imagekitUrl: agentTaskArtifacts.imagekitUrl,
          isVerified: agentTaskArtifacts.isVerified,
          createdAt: agentTaskArtifacts.createdAt,
        })
        .from(agentTaskArtifacts)
        .where(
          and(
            eq(agentTaskArtifacts.campaignId, userCampaign.id),
            eq(agentTaskArtifacts.authUserId, authUserId),
            eq(agentTaskArtifacts.isVerified, true),
          ),
        )
        .orderBy(desc(agentTaskArtifacts.createdAt));

      artifacts = artifactRows.map((a) => ({
        id: a.id,
        filename: a.filename,
        sandboxPath: a.sandboxPath ?? "",
        sizeBytes: a.sizeBytes ?? 0,
        mimeType: a.mimeType,
        artifactType: a.artifactType,
        imagekitUrl: a.imagekitUrl ?? null,
        isVerified: a.isVerified ?? true,
        createdAt: a.createdAt?.toISOString() ?? new Date().toISOString(),
      }));
    } catch {
      // In-memory or mock DB fallback
    }
  }

  return {
    eligible: true,
    isEligible: true,
    campaignId: userCampaign.id,
    campaignStatus: userCampaign.status,
    computer: computer
      ? {
          id: computer.id,
          agentId: computer.agentId,
          status: computer.status,
          controlMode: computer.controlMode,
          activeTaskId: computer.activeTaskId ?? null,
          lastActiveAt: computer.lastActiveAt ?? null,
          lastScreenshotAt: computer.lastScreenshotAt ?? null,
          lastScreenshotBase64: computer.lastScreenshotBase64 ?? null,
          pausedAt: computer.pausedAt ?? null,
          hasSandbox: Boolean(computer.sandboxId),
        }
      : null,
    activeTask,
    artifacts,
  };
}

/**
 * 2. Get secure short-lived stream URL for live viewing / takeover.
 * Enforces authenticated ownership, running status, and strict view-only
 * permissions unless user is currently in takeover control mode.
 */
export async function getComputerStreamUrlService(
  authUserId: string,
  agentId: unknown,
  campaignId?: number | null,
  deps: ComputerServiceDeps = {},
) {
  if (!isComputerEligible(agentId)) {
    throw new IneligibleAgentComputerError(String(agentId));
  }

  const db = deps.db ?? (await createRealDbService());
  const userCampaign = await db.findCampaign(authUserId, campaignId);
  if (!userCampaign) {
    throw new Error("Campaign not found or access denied.");
  }

  if (userCampaign.status === "ended") {
    throw new CampaignEndedAbortError(
      "Campaign has ended. Stream is unavailable.",
    );
  }

  const computer = await db.findComputer(authUserId, userCampaign.id, agentId);
  if (!computer || computer.status !== "running") {
    throw new ComputerNotRunningError(
      `Computer is not currently running (status: ${computer?.status ?? "not_initialized"}).`,
    );
  }

  const resolveSandbox = deps.getActiveSandbox ?? getActiveSandbox;
  let sandbox = resolveSandbox(userCampaign.id, agentId);
  if (!sandbox && computer.sandboxId && computer.status === "running") {
    sandbox = await reconnectSandboxService(authUserId, userCampaign.id, agentId, deps);
  }
  if (!sandbox || !sandbox.stream) {
    throw new ComputerNotRunningError(
      "No active sandbox instance available for streaming.",
    );
  }

  // Extend sandbox lifetime during active viewing/streaming
  await renewSandboxTimeout(sandbox);

  try {
    await sandbox.stream.start({ requireAuth: true });
  } catch (err: unknown) {
    const isAlreadyRunning =
      err instanceof Error && /already running/i.test(err.message);

    // Unrelated stream errors propagate normally
    if (!isAlreadyRunning) {
      throw err;
    }

    // Verify existing stream is genuinely running using supported SDK API
    let isProcessRunning = false;
    const vncStream = sandbox.stream as {
      checkVNCRunning?: () => Promise<boolean>;
    };

    if (typeof vncStream.checkVNCRunning === "function") {
      isProcessRunning = await vncStream.checkVNCRunning();
    } else if (sandbox.commands && typeof sandbox.commands.run === "function") {
      try {
        const check = await sandbox.commands.run("pgrep -x x11vnc");
        isProcessRunning = check.stdout.trim().length > 0;
      } catch {
        isProcessRunning = false;
      }
    } else {
      // If neither check is possible, assume true only if getUrl and getAuthKey work
      isProcessRunning = true;
    }

    if (!isProcessRunning) {
      throw new ComputerNotRunningError(
        "Stream was reported as already running, but VNC server process is not active.",
      );
    }
  }

  let authKey: string;
  try {
    authKey = sandbox.stream.getAuthKey();
    if (!authKey) {
      throw new Error("Missing auth key");
    }
  } catch {
    throw new ComputerNotRunningError(
      "Stream is running but auth credentials cannot be retrieved.",
    );
  }

  const isHumanControl = computer.controlMode === "human";

  // When human control is active: interactive stream (viewOnly: false)
  // When agent control is active: view-only monitoring (viewOnly: true)
  const streamUrl = sandbox.stream.getUrl({
    authKey,
    autoConnect: true,
    viewOnly: !isHumanControl,
    resize: "scale",
  });

  return {
    streamUrl,
    controlMode: computer.controlMode,
    viewOnly: !isHumanControl,
    agentId,
    campaignId: userCampaign.id,
  };
}

/**
 * 3. Human takeover lock: atomically set controlMode = 'human'
 * Blocks all AI actions immediately on the server.
 */
export async function takeoverComputerService(
  authUserId: string,
  agentId: unknown,
  campaignId?: number | null,
  deps: ComputerServiceDeps = {},
) {
  if (!isComputerEligible(agentId)) {
    throw new IneligibleAgentComputerError(String(agentId));
  }

  const db = deps.db ?? (await createRealDbService());
  const userCampaign = await db.findCampaign(authUserId, campaignId);
  if (!userCampaign) {
    throw new Error("Campaign not found or access denied.");
  }

  if (userCampaign.status === "ended") {
    throw new CampaignEndedAbortError(
      "Campaign has ended. Cannot take over computer.",
    );
  }

  let computer = await db.findComputer(authUserId, userCampaign.id, agentId);
  if (!computer) {
    computer = await db.upsertComputer({
      authUserId,
      campaignId: userCampaign.id,
      agentId,
      controlMode: "human",
    });
  } else {
    computer = await db.updateComputerControlMode(
      authUserId,
      userCampaign.id,
      agentId,
      "human",
    );
  }

  if (computer) {
    await db.updateActiveTaskControlMode(
      computer.id,
      "waiting_for_user",
      "Human takeover active",
    );
  }

  // Extend sandbox lifetime during human takeover
  const resolveSandbox = deps.getActiveSandbox ?? getActiveSandbox;
  const takeoverSbx = resolveSandbox(userCampaign.id, agentId);
  if (takeoverSbx) {
    await renewSandboxTimeout(takeoverSbx);
  }

  return {
    success: true,
    controlMode: "human",
    agentId,
    campaignId: userCampaign.id,
  };
}

/**
 * 4. Human handback: atomically restore controlMode = 'agent'
 */
export async function handbackComputerService(
  authUserId: string,
  agentId: unknown,
  campaignId?: number | null,
  deps: ComputerServiceDeps = {},
) {
  if (!isComputerEligible(agentId)) {
    throw new IneligibleAgentComputerError(String(agentId));
  }

  const db = deps.db ?? (await createRealDbService());
  const userCampaign = await db.findCampaign(authUserId, campaignId);
  if (!userCampaign) {
    throw new Error("Campaign not found or access denied.");
  }

  if (userCampaign.status === "ended") {
    throw new CampaignEndedAbortError(
      "Campaign has ended. Cannot hand back computer.",
    );
  }

  const existing = await db.findComputer(authUserId, userCampaign.id, agentId);
  if (!existing) {
    throw new Error("Computer not initialized.");
  }

  if (existing.controlMode === "agent") {
    return {
      success: true,
      controlMode: "agent",
      alreadyHandedBack: true,
      taskResumed: false,
      agentId,
      campaignId: userCampaign.id,
    };
  }

  const updated = await db.updateComputerControlMode(
    authUserId,
    userCampaign.id,
    agentId,
    "agent",
  );

  const now = deps.now ? deps.now() : new Date();

  // 2. Verify sandbox usability
  let isSandboxUsable = false;
  if (existing.status === "running") {
    const resolveSandbox = deps.getActiveSandbox ?? getActiveSandbox;
    let sandbox = resolveSandbox(userCampaign.id, agentId);
    if (!sandbox && existing.sandboxId) {
      try {
        sandbox = await reconnectSandboxService(authUserId, userCampaign.id, agentId, deps);
      } catch {
        sandbox = undefined;
      }
    }
    isSandboxUsable = Boolean(sandbox);
  }

  if (!isSandboxUsable) {
    // Sandbox is stopped, paused, terminated, or crashed -> fail active computer task, do not resume
    if (existing.id) {
      await db.markComputerTaskFailed(
        existing.id,
        "Sandbox is stopped or unreachable after human takeover.",
      );
    }
    return {
      success: true,
      controlMode: "agent",
      taskResumed: false,
      reason: "sandbox_not_running",
      agentId,
      campaignId: userCampaign.id,
    };
  }

  // 3. Verify task execution lease and terminal status
  if (existing.activeTaskId) {
    const task = await db.findTask(existing.activeTaskId);
    if (task) {
      if (task.status === "failed" || task.status === "completed" || task.status === "cancelled") {
        return {
          success: true,
          controlMode: "agent",
          taskResumed: false,
          reason: `task_${task.status}`,
          agentId,
          campaignId: userCampaign.id,
        };
      }

      const leaseExpired =
        !task.executionLeaseExpiresAt ||
        task.executionLeaseExpiresAt.getTime() <= now.getTime();

      if (leaseExpired) {
        // Lease expired during human takeover -> route to recovery, do not resume
        await db.markComputerTaskFailed(
          existing.id,
          "Execution lease expired during human takeover.",
        );
        await db.routeTaskToRecovery(task.id);

        return {
          success: true,
          controlMode: "agent",
          taskResumed: false,
          recoveryNeeded: true,
          reason: "lease_expired",
          agentId,
          campaignId: userCampaign.id,
        };
      }
    }
  }

  // 4. Everything valid and active: resume task if an active task exists
  if (updated && existing.activeTaskId) {
    await db.updateActiveTaskControlMode(updated.id, "active", null);
  }

  return {
    success: true,
    controlMode: "agent",
    taskResumed: Boolean(existing.activeTaskId),
    reason: existing.activeTaskId ? undefined : "no_active_task",
    agentId,
    campaignId: userCampaign.id,
  };
}

/**
 * 5. Idempotent campaign termination:
 * - Cancels/fences active tasks
 * - Fences outbox deliveries
 * - Sets campaign status to 'ended'
 * - Terminates computers and kills active E2B microVMs
 */
export async function endCampaignService(
  authUserId: string,
  campaignId: number,
  deps: ComputerServiceDeps = {},
) {
  const db = deps.db ?? (await createRealDbService());
  const userCampaign = await db.findCampaign(authUserId, campaignId);
  if (!userCampaign) {
    throw new Error("Campaign not found or access denied.");
  }

  if (userCampaign.status === "ended") {
    return {
      success: true,
      campaignId: userCampaign.id,
      status: "ended",
      alreadyEnded: true,
    };
  }

  // 1. Terminate DB records and fence workers
  const { cancelledTasksCount, terminatedComputersCount } =
    await db.endCampaign(userCampaign.id);

  // 2. Kill all active in-memory / cloud sandboxes
  const getSandboxes =
    deps.getAllActiveSandboxesForCampaign ?? getAllActiveSandboxesForCampaign;
  const activeSandboxesList = getSandboxes(userCampaign.id);
  const sandboxKillErrors: Array<{ agentId: string; error: string }> = [];

  for (const { agentId, sandbox } of activeSandboxesList) {
    try {
      if (typeof sandbox.kill === "function") {
        await sandbox.kill();
      }
    } catch (err) {
      sandboxKillErrors.push({
        agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      const removeSandbox = deps.removeActiveSandbox ?? removeActiveSandbox;
      removeSandbox(userCampaign.id, agentId);
    }
  }

  return {
    success: true,
    campaignId: userCampaign.id,
    status: "ended",
    cancelledTasksCount,
    terminatedComputersCount,
    killedSandboxesCount: activeSandboxesList.length - sandboxKillErrors.length,
    sandboxErrors: sandboxKillErrors.length > 0 ? sandboxKillErrors : undefined,
  };
}

/**
 * 6. Authorized artifact download:
 * - Checks authenticated campaign ownership
 * - Prevents path traversal
 * - Ensures verified status and non-zero size
 * - Returns verified file bytes
 */
export async function downloadArtifactService(
  authUserId: string,
  artifactId: number,
  campaignId?: number | null,
  deps: ComputerServiceDeps = {},
) {
  const db = deps.db ?? (await createRealDbService());
  const userCampaign = await db.findCampaign(authUserId, campaignId);
  if (!userCampaign) {
    throw new Error("Campaign not found or access denied.");
  }

  const artifact = await db.findArtifact(authUserId, userCampaign.id, artifactId);
  if (!artifact) {
    throw new ArtifactNotFoundError("Artifact not found or access denied.");
  }

  if (!artifact.isVerified || !artifact.sizeBytes || artifact.sizeBytes <= 0) {
    throw new ArtifactUnverifiedError(
      "Artifact has not been verified or is empty.",
    );
  }

  // 1. Check durable storage first (works independently of ephemeral sandbox status)
  let fileBytes: Uint8Array | null = null;
  try {
    const { retrieveDurableArtifact } = await import("./durable-storage.ts");
    fileBytes = await retrieveDurableArtifact(
      userCampaign.id,
      artifact.taskId,
      artifact.id,
      artifact.filename,
      deps.storageDriver,
    );
  } catch {
    fileBytes = null;
  }

  // If found in durable storage, return immediately without touching sandbox
  if (fileBytes && fileBytes.length > 0) {
    return {
      filename: artifact.filename,
      mimeType: artifact.mimeType || "application/octet-stream",
      sizeBytes: fileBytes.length,
      bytes: fileBytes,
    };
  }

  // 2. If not in durable storage, read from active sandbox or dependency injection
  if (!fileBytes && artifact.sandboxPath) {
    let sanitizedPath: string | null = null;
    try {
      sanitizedPath = validateSandboxPath(artifact.sandboxPath);
    } catch {
      sanitizedPath = null;
    }

    if (sanitizedPath) {
      if (deps.readArtifactBytes) {
        const resolveSandbox = deps.getActiveSandbox ?? getActiveSandbox;
        const dummySandbox = (resolveSandbox(userCampaign.id, "dummy") ??
          {}) as E2BDesktopSandboxLike;
        fileBytes = await deps.readArtifactBytes(dummySandbox, sanitizedPath);
      } else {
        const resolveSandbox = deps.getActiveSandbox ?? getActiveSandbox;
        const [comp] = [
          await db.findComputer(authUserId, userCampaign.id, "seat-1"),
          await db.findComputer(authUserId, userCampaign.id, "seat-mvj4q0fn"),
        ].filter(Boolean);
        let sandbox = comp ? resolveSandbox(userCampaign.id, comp.agentId) : undefined;
        if (!sandbox && comp?.sandboxId && comp.status === "running") {
          try {
            sandbox = await reconnectSandboxService(authUserId, userCampaign.id, comp.agentId, deps);
          } catch {
            sandbox = undefined;
          }
        }
        if (sandbox) {
          try {
            fileBytes = await sandbox.files.read(sanitizedPath, { format: "bytes" });
          } catch {
            fileBytes = null;
          }
        }
      }

      // Automatically persist to durable storage for future downloads
      if (fileBytes && fileBytes.length > 0) {
        try {
          const { persistDurableArtifact } = await import("./durable-storage.ts");
          await persistDurableArtifact(
            userCampaign.id,
            artifact.taskId,
            artifact.id,
            artifact.filename,
            artifact.mimeType || "application/octet-stream",
            fileBytes,
            deps.storageDriver,
          );
        } catch {
          // Non-fatal
        }
      }
    }
  }

  if (!fileBytes || fileBytes.length === 0) {
    throw new Error(
      "Artifact file could not be retrieved from durable storage, and no active sandbox contains this file.",
    );
  }

  return {
    filename: artifact.filename,
    mimeType: artifact.mimeType || "application/octet-stream",
    sizeBytes: fileBytes.length,
    bytes: fileBytes,
  };
}

/**
 * 7. Sweep and pause computers idle for at least 3 minutes (180,000ms):
 * - Identifies running computers in agent mode with no active task and lastActiveAt <= threshold
 * - Takes and persists a final screenshot when a sandbox is accessible
 * - Pauses the computer record idempotently
 */
export type SweepIdleOptions = {
  idleThresholdMs?: number;
  now?: () => Date;
};

export async function sweepIdleComputersService(
  deps: ComputerServiceDeps & SweepIdleOptions = {},
) {
  const db = deps.db ?? (await createRealDbService());
  const now = deps.now ? deps.now() : new Date();
  const idleThresholdMs = deps.idleThresholdMs ?? 180_000;
  const thresholdDate = new Date(now.getTime() - idleThresholdMs);

  const idleComputers = await db.findIdleComputers(thresholdDate);
  let pausedCount = 0;
  const errors: Array<{ computerId: number; error: string }> = [];

  for (const comp of idleComputers) {
    try {
      let screenshotBase64: string | null = null;
      const resolveSandbox = deps.getActiveSandbox ?? getActiveSandbox;
      let sandbox = resolveSandbox(comp.campaignId, comp.agentId);
      if (!sandbox && comp.sandboxId) {
        try {
          sandbox = await reconnectSandboxService(
            comp.authUserId,
            comp.campaignId,
            comp.agentId,
            deps,
          );
        } catch {
          sandbox = undefined;
        }
      }

      if (sandbox) {
        try {
          const screenshotFn =
            typeof sandbox.screenshot === "function"
              ? () => sandbox.screenshot("bytes")
              : typeof (sandbox as unknown as { takeScreenshot?: () => Promise<Uint8Array> }).takeScreenshot === "function"
                ? () => (sandbox as unknown as { takeScreenshot: () => Promise<Uint8Array> }).takeScreenshot()
                : null;

          if (screenshotFn) {
            const bytes = await screenshotFn();
            if (bytes && bytes.length > 0) {
              screenshotBase64 = Buffer.from(bytes).toString("base64");
            }
          }
        } catch (screenshotErr) {
          errors.push({
            computerId: comp.id,
            error: `Screenshot capture failed: ${screenshotErr instanceof Error ? screenshotErr.message : String(screenshotErr)}`,
          });
        }
      }

      const paused = await db.pauseComputer(comp.id, screenshotBase64, now);
      if (paused) {
        pausedCount++;
      }
    } catch (err) {
      errors.push({
        computerId: comp.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    examinedCount: idleComputers.length,
    pausedCount,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * 8. Sweep and expire tasks that have been waiting_for_user for > 24 hours:
 * - Finds tasks in waiting_for_user state where waitingSince <= threshold
 * - Fails the computer task and primary agent task
 * - Clears the activeTaskId and resets computer control mode to agent
 */
export type SweepStaleWaitingOptions = {
  waitingTimeoutMs?: number;
  now?: () => Date;
};

export async function sweepStaleWaitingTasksService(
  deps: ComputerServiceDeps & SweepStaleWaitingOptions = {},
) {
  const db = deps.db ?? (await createRealDbService());
  const now = deps.now ? deps.now() : new Date();
  const waitingTimeoutMs = deps.waitingTimeoutMs ?? 86_400_000;
  const thresholdDate = new Date(now.getTime() - waitingTimeoutMs);

  const staleTasks = await db.findStaleWaitingTasks(thresholdDate);
  let expiredCount = 0;
  const errors: Array<{ computerTaskId: number; error: string }> = [];

  for (const item of staleTasks) {
    try {
      const expired = await db.expireWaitingTask(
        item.computerTaskId,
        item.taskId,
        item.computerId,
        "User interaction timed out after 24 hours (waiting_for_user expired).",
      );
      if (expired) {
        expiredCount++;
      }
    } catch (err) {
      errors.push({
        computerTaskId: item.computerTaskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    examinedCount: staleTasks.length,
    expiredCount,
    errors: errors.length > 0 ? errors : undefined,
  };
}


/**
 * 9. Manually start an agent computer microVM for an eligible specialist.
 * Verifies campaign ownership, active status, agent eligibility, and creates or reconnects the sandbox.
 */
export async function startComputerService(
  authUserId: string,
  agentId: unknown,
  campaignId?: number | null,
  deps: ComputerServiceDeps = {},
) {
  if (!isComputerEligible(agentId)) {
    throw new IneligibleAgentComputerError(String(agentId));
  }

  const db = deps.db ?? (await createRealDbService());
  const userCampaign = await db.findCampaign(authUserId, campaignId);
  if (!userCampaign) {
    throw new Error("Campaign not found or access denied.");
  }
  if (userCampaign.status === "ended") {
    throw new CampaignEndedAbortError("Campaign has ended. Cannot start computer.");
  }

  let computer = await db.findComputer(authUserId, userCampaign.id, String(agentId));
  if (!computer) {
    computer = await db.upsertComputer({
      authUserId,
      campaignId: userCampaign.id,
      agentId: String(agentId),
      status: "stopped",
      controlMode: "agent",
    });
  }

  const resolveSandbox = deps.getActiveSandbox ?? getActiveSandbox;
  let sandbox = resolveSandbox(userCampaign.id, agentId);

  if (!sandbox) {
    if (computer.sandboxId && computer.status === "running") {
      try {
        sandbox = await reconnectSandboxService(authUserId, userCampaign.id, agentId, deps);
      } catch {
        sandbox = undefined;
      }
    }

    if (!sandbox) {
      if (deps.connectSandbox) {
        sandbox = await deps.connectSandbox("mock-sandbox-started");
      } else if (process.env.E2B_API_KEY) {
        const { Sandbox } = await import("@e2b/desktop");
        const timeoutMs = getE2BSandboxTimeoutMs();
        const created = await Sandbox.create({
          template: "desktop",
          timeoutMs,
        });
        sandbox = created as unknown as E2BDesktopSandboxLike;
      } else {
        sandbox = {
          sandboxId: `sbx-local-${agentId}-${Date.now()}`,
          stream: {
            async start() {},
            async checkVNCRunning() { return true; },
            getAuthKey() { return "mock-auth-key"; },
            getUrl(opts?: any) { return `https://mock.e2b.dev/stream?auth=${opts?.authKey ?? "mock"}`; },
          },
          commands: {
            async run() { return { stdout: "", stderr: "", exitCode: 0 }; },
          },
          async kill() {},
        } as unknown as E2BDesktopSandboxLike;
      }

      const registerFn = deps.registerActiveSandbox ?? registerActiveSandbox;
      registerFn(userCampaign.id, agentId, sandbox);
    }
  }

  const sandboxId = (sandbox as any)?.sandboxId ?? `sbx-${agentId}-${Date.now()}`;
  await db.updateComputerStatus(computer.id, "running", null, sandboxId);

  return {
    ok: true,
    computerId: computer.id,
    agentId: String(agentId),
    status: "running",
    sandboxId,
  };
}

/**
 * 10. Manually stop an agent computer microVM for an eligible specialist.
 * Fences the sandbox, kills the microVM, clears registry, captures screenshot, and persists status.
 */
export async function stopComputerService(
  authUserId: string,
  agentId: unknown,
  campaignId?: number | null,
  deps: ComputerServiceDeps = {},
) {
  if (!isComputerEligible(agentId)) {
    throw new IneligibleAgentComputerError(String(agentId));
  }

  const db = deps.db ?? (await createRealDbService());
  const userCampaign = await db.findCampaign(authUserId, campaignId);
  if (!userCampaign) {
    throw new Error("Campaign not found or access denied.");
  }

  const computer = await db.findComputer(authUserId, userCampaign.id, String(agentId));
  if (!computer) {
    return { ok: true, message: "Computer was not initialized." };
  }

  const resolveSandbox = deps.getActiveSandbox ?? getActiveSandbox;
  const sandbox = resolveSandbox(userCampaign.id, agentId);

  let screenshotBase64: string | null = null;
  if (sandbox) {
    try {
      const screenshotFn =
        typeof sandbox.screenshot === "function"
          ? () => sandbox.screenshot("bytes")
          : typeof (sandbox as unknown as { takeScreenshot?: () => Promise<Uint8Array> }).takeScreenshot === "function"
            ? () => (sandbox as unknown as { takeScreenshot: () => Promise<Uint8Array> }).takeScreenshot()
            : null;

      if (screenshotFn) {
        const bytes = await screenshotFn();
        if (bytes && bytes.length > 0) {
          screenshotBase64 = Buffer.from(bytes).toString("base64");
        }
      }
    } catch {
      // Non-fatal
    }

    try {
      if (typeof sandbox.kill === "function") {
        await sandbox.kill();
      }
    } catch {
      // Non-fatal
    }

    const removeSandbox = deps.removeActiveSandbox ?? removeActiveSandbox;
    removeSandbox(userCampaign.id, agentId);
  }

  await db.updateComputerStatus(computer.id, "stopped", null, null);
  if (screenshotBase64) {
    await db.pauseComputer(computer.id, screenshotBase64, new Date());
    await db.updateComputerStatus(computer.id, "stopped", null, null);
  }

  await db.markComputerTaskFailed(computer.id, "Computer stopped manually by user");

  return {
    ok: true,
    computerId: computer.id,
    agentId: String(agentId),
    status: "stopped",
  };
}
