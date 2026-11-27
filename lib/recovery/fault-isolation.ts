/**
 * SOTO AI — Fault Isolation & Graceful Degradation Engine
 *
 * Prevents single-step or single-agent failures from cascading across the campaign.
 * Shields downstream specialists while maintaining strict truthfulness in reporting.
 */

export type DegradationResult = {
  isDegraded: boolean;
  statusLabel: string;
  annotatedContent: string;
  missingCapabilities: string[];
  remedyAction: string;
};

/**
 * Applies graceful fallback when live web research encounters network / sandbox limits.
 * Allows Research Agent to provide verified internal knowledge without failing the entire campaign,
 * while transparently labeling the output.
 */
export function isolateResearchFailure(
  query: string,
  platform: string,
  underlyingError: string,
): {
  success: true;
  output: string;
  isLimited: true;
} {
  return {
    success: true,
    isLimited: true,
    output: `[Limited Discovery Mode - Live Browser Unavailable]
Target: "${query}" on ${platform}
Note: Live web browsing was temporarily limited (${underlyingError}).
Synthesis is proceeding using verified baseline market intelligence. Recommended manual verification URL: https://www.google.com/search?q=${encodeURIComponent(query)}`,
  };
}

/**
 * Shields creative copy when image generation encounters quota or provider unavailability.
 * Guarantees that captions, hashtags, Reels scripts, and carousel drafts are preserved and delivered.
 */
export function isolateImageGenerationFailure(
  textDraft: string,
  imageError: string,
): {
  preservedOutput: string;
  imageStatus: "failed_isolated";
} {
  const annotated = `${textDraft}\n\n> ℹ️ **Visual Asset Notice:** Image generation encountered a provider limit (${imageError}). All captions, scripts, and hashtags above have been safely preserved for campaign scheduling.`;
  return {
    preservedOutput: annotated,
    imageStatus: "failed_isolated",
  };
}

/**
 * Resolves dependency outputs for downstream agents safely.
 * If an upstream task had partial deliverables, provides what was completed with explicit notice.
 */
export function formatResilientDependencyContext(
  prerequisiteTasks: Array<{
    id: number;
    title: string;
    response: string | null;
    status: string;
    error: string | null;
  }>,
): {
  contextText: string;
  hasIncompletePrerequisites: boolean;
  missingPrerequisiteIds: number[];
} {
  const missingPrerequisiteIds: number[] = [];
  const entries: string[] = [];

  for (const p of prerequisiteTasks) {
    if (p.status === "completed" && p.response) {
      entries.push(`[Task ${p.id}] ${p.title} (COMPLETED):\n${p.response}`);
    } else if (p.response && p.response.trim().length > 0) {
      entries.push(`[Task ${p.id}] ${p.title} (PARTIAL / DEGRADED):\n${p.response}`);
    } else {
      missingPrerequisiteIds.push(p.id);
      entries.push(`[Task ${p.id}] ${p.title} (UNAVAILABLE: ${p.error ?? p.status})`);
    }
  }

  return {
    contextText: entries.join("\n\n---\n\n"),
    hasIncompletePrerequisites: missingPrerequisiteIds.length > 0,
    missingPrerequisiteIds,
  };
}

