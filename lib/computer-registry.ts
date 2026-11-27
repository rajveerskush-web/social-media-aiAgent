import type { E2BDesktopSandboxLike } from "./computer-types.ts";

const activeSandboxes = new Map<string, E2BDesktopSandboxLike>();

function sandboxKey(campaignId: number, agentId: string): string {
  return `${campaignId}:${agentId}`;
}

/**
 * Registers an active running sandbox in memory for the campaign and agent.
 */
export function registerActiveSandbox(
  campaignId: number,
  agentId: string,
  sandbox: E2BDesktopSandboxLike,
): void {
  activeSandboxes.set(sandboxKey(campaignId, agentId), sandbox);
}

/**
 * Retrieves the currently active sandbox for a campaign and agent.
 */
export function getActiveSandbox(
  campaignId: number,
  agentId: string,
): E2BDesktopSandboxLike | undefined {
  return activeSandboxes.get(sandboxKey(campaignId, agentId));
}

/**
 * Removes a sandbox from the active in-memory registry.
 */
export function removeActiveSandbox(
  campaignId: number,
  agentId: string,
): E2BDesktopSandboxLike | undefined {
  const key = sandboxKey(campaignId, agentId);
  const existing = activeSandboxes.get(key);
  activeSandboxes.delete(key);
  return existing;
}

/**
 * Retrieves all active sandboxes associated with a campaign.
 */
export function getAllActiveSandboxesForCampaign(
  campaignId: number,
): Array<{ agentId: string; sandbox: E2BDesktopSandboxLike }> {
  const results: Array<{ agentId: string; sandbox: E2BDesktopSandboxLike }> = [];
  const prefix = `${campaignId}:`;
  for (const [key, sandbox] of activeSandboxes.entries()) {
    if (key.startsWith(prefix)) {
      const agentId = key.slice(prefix.length);
      results.push({ agentId, sandbox });
    }
  }
  return results;
}

/**
 * Clears the active registry (used for tests and server restarts).
 */
export function clearActiveSandboxes(): void {
  activeSandboxes.clear();
}

