import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { agentComputerTasks, agentComputers, campaign, getDb } from "@/db";
import {
  CampaignEndedAbortError,
  ComputerAgentId,
  ComputerConcurrencyConflictError,
  ComputerToolContext,
  HumanTakeoverActiveError,
  IneligibleAgentComputerError,
  assertComputerActionAllowed,
  isComputerEligible,
} from "./computer-types";

export { assertComputerActionAllowed };

/**
 * Validates that an agent is authorized to use a computer and that the
 * owning campaign is active (not ended).
 */
export async function validateComputerScope(
  authUserId: string,
  campaignId: number,
  agentId: unknown,
): Promise<{ eligibleAgentId: ComputerAgentId; campaignName: string }> {
  if (!isComputerEligible(agentId)) {
    throw new IneligibleAgentComputerError(String(agentId));
  }

  const db = getDb();
  const [camp] = await db
    .select({ id: campaign.id, name: campaign.name, status: campaign.status })
    .from(campaign)
    .where(and(eq(campaign.id, campaignId), eq(campaign.authUserId, authUserId)))
    .limit(1);

  if (!camp) {
    throw new Error("Campaign not found or access denied.");
  }

  if (camp.status === "ended") {
    throw new CampaignEndedAbortError(
      `Campaign ${camp.name} has ended. Cannot allocate or run computers.`,
    );
  }

  return { eligibleAgentId: agentId, campaignName: camp.name };
}

/**
 * Validates the full caller context for an AI computer action:
 * 1. Agent eligibility and active campaign scope
 * 2. Computer record existence and ownership
 * 3. Human takeover lock and campaign termination lock
 * 4. Task-level concurrency exclusivity
 */
export async function verifyComputerActionContext(
  context: ComputerToolContext,
) {
  const { eligibleAgentId } = await validateComputerScope(
    context.authUserId,
    context.campaignId,
    context.agentId,
  );

  const db = getDb();
  const [computer] = await db
    .select({
      id: agentComputers.id,
      controlMode: agentComputers.controlMode,
      status: agentComputers.status,
      activeTaskId: agentComputers.activeTaskId,
    })
    .from(agentComputers)
    .where(
      and(
        eq(agentComputers.authUserId, context.authUserId),
        eq(agentComputers.campaignId, context.campaignId),
        eq(agentComputers.agentId, eligibleAgentId),
      ),
    )
    .limit(1);

  if (!computer) {
    throw new Error(
      "Agent computer record not initialized. Create or allocate computer first.",
    );
  }

  assertComputerActionAllowed(computer.controlMode, "active");

  if (context.taskId) {
    const [conflictTask] = await db
      .select({ id: agentComputerTasks.id, taskId: agentComputerTasks.taskId })
      .from(agentComputerTasks)
      .where(
        and(
          eq(agentComputerTasks.computerId, computer.id),
          inArray(agentComputerTasks.status, ["active", "waiting_for_user"]),
          ne(agentComputerTasks.taskId, context.taskId),
        ),
      )
      .limit(1);

    if (conflictTask) {
      throw new ComputerConcurrencyConflictError(
        `Computer is currently in use by task #${conflictTask.taskId}.`,
      );
    }
  }

  return { computer, eligibleAgentId };
}

/**
 * Retrieves the computer record for an agent within a campaign,
 * creating it with status 'stopped' and controlMode 'agent' if it does not yet exist.
 * Enforces campaign ownership and active status defense-in-depth.
 */
export async function getOrCreateComputerRecord(
  authUserId: string,
  campaignId: number,
  agentId: ComputerAgentId,
) {
  const db = getDb();

  // Defense-in-depth: Verify campaign ownership and active status
  const [camp] = await db
    .select({ id: campaign.id, name: campaign.name, status: campaign.status })
    .from(campaign)
    .where(and(eq(campaign.id, campaignId), eq(campaign.authUserId, authUserId)))
    .limit(1);

  if (!camp) {
    throw new Error("Campaign not found or access denied.");
  }

  if (camp.status === "ended") {
    throw new CampaignEndedAbortError(
      `Campaign ${camp.name} has ended. Cannot allocate or initialize computer.`,
    );
  }

  const [existing] = await db
    .select()
    .from(agentComputers)
    .where(
      and(
        eq(agentComputers.campaignId, campaignId),
        eq(agentComputers.authUserId, authUserId),
        eq(agentComputers.agentId, agentId),
      ),
    )
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(agentComputers)
    .values({
      authUserId,
      campaignId,
      agentId,
      status: "stopped",
      controlMode: "agent",
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const [raced] = await db
    .select()
    .from(agentComputers)
    .where(
      and(
        eq(agentComputers.campaignId, campaignId),
        eq(agentComputers.authUserId, authUserId),
        eq(agentComputers.agentId, agentId),
      ),
    )
    .limit(1);

  if (!raced) throw new Error("Unable to initialize agent computer record.");
  return raced;
}

/**
 * Atomically locks the computer for human control.
 * AI actions will immediately throw HumanTakeoverActiveError.
 */
export async function setHumanTakeover(
  authUserId: string,
  campaignId: number,
  agentId: ComputerAgentId,
) {
  const db = getDb();
  const [updated] = await db
    .update(agentComputers)
    .set({
      controlMode: "human",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentComputers.authUserId, authUserId),
        eq(agentComputers.campaignId, campaignId),
        eq(agentComputers.agentId, agentId),
      ),
    )
    .returning();

  return updated ?? null;
}

/**
 * Atomically releases human takeover, returning control to the agent.
 */
export async function releaseHumanTakeover(
  authUserId: string,
  campaignId: number,
  agentId: ComputerAgentId,
) {
  const db = getDb();
  const [updated] = await db
    .update(agentComputers)
    .set({
      controlMode: "agent",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentComputers.authUserId, authUserId),
        eq(agentComputers.campaignId, campaignId),
        eq(agentComputers.agentId, agentId),
      ),
    )
    .returning();

  return updated ?? null;
}

/**
 * Terminates all computers associated with a campaign during an End Campaign action.
 */
export async function terminateCampaignComputers(
  authUserId: string,
  campaignId: number,
) {
  const db = getDb();
  return db
    .update(agentComputers)
    .set({
      status: "terminated",
      sandboxId: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentComputers.authUserId, authUserId),
        eq(agentComputers.campaignId, campaignId),
      ),
    )
    .returning();
}
