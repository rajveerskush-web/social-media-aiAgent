import { and, eq, inArray, asc } from "drizzle-orm";
import { getDb, agentTasks, agentTaskArtifacts, agentMessages, agentConversations } from "../db/index.ts";
import { getGeminiClient, getGeminiModel, GEMINI_REQUEST_OPTIONS } from "./gemini.ts";

const TERMINAL_STATUSES = new Set(["completed", "failed", "aborted"]);

export type SynthesisResult = {
  triggered: boolean;
  reason: "already_synthesized" | "tasks_in_progress" | "no_tasks" | "completed" | "error";
  messageId?: number;
  reportContent?: string;
  error?: string;
};

/**
 * Checks whether all subtasks for a task's requestKey have finished,
 * and if so, triggers Master Agent synthesis to produce the final consolidated report.
 */
export async function checkAndTriggerMasterSynthesis(taskId: number): Promise<SynthesisResult> {
  try {
    const db = getDb();
    const [task] = await db
      .select({
        id: agentTasks.id,
        masterConversationId: agentTasks.masterConversationId,
        requestKey: agentTasks.requestKey,
      })
      .from(agentTasks)
      .where(eq(agentTasks.id, taskId));

    if (!task || !task.masterConversationId || !task.requestKey) {
      return { triggered: false, reason: "no_tasks" };
    }

    return await checkAndTriggerMasterSynthesisForRequest(task.masterConversationId, task.requestKey);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[master-agent-synthesis] Failed for taskId", taskId, message);
    return { triggered: false, reason: "error", error: message };
  }
}

/**
 * Checks whether all tasks for a conversation have finished and triggers synthesis if needed.
 */
export async function checkAndTriggerMasterSynthesisForConversation(conversationId: number): Promise<SynthesisResult[]> {
  try {
    const db = getDb();
    const tasks = await db
      .select({
        requestKey: agentTasks.requestKey,
      })
      .from(agentTasks)
      .where(eq(agentTasks.masterConversationId, conversationId));

    const distinctRequestKeys = Array.from(
      new Set(tasks.map((t) => t.requestKey).filter((k): k is string => Boolean(k)))
    );

    const results: SynthesisResult[] = [];
    for (const key of distinctRequestKeys) {
      const res = await checkAndTriggerMasterSynthesisForRequest(conversationId, key);
      results.push(res);
    }
    return results;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[master-agent-synthesis] Failed for conversation", conversationId, message);
    return [{ triggered: false, reason: "error", error: message }];
  }
}

/**
 * Core synthesis function for a specific masterConversationId and requestKey.
 */
export async function checkAndTriggerMasterSynthesisForRequest(
  masterConversationId: number,
  requestKey: string
): Promise<SynthesisResult> {
  const synthesisKey = `final-report:${requestKey}`;
  const db = getDb();

  // 1. Idempotency check: has this final report already been created?
  const [existingReport] = await db
    .select({ id: agentMessages.id, content: agentMessages.content })
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.conversationId, masterConversationId),
        eq(agentMessages.requestKey, synthesisKey),
        eq(agentMessages.role, "assistant")
      )
    );

  if (existingReport) {
    return {
      triggered: false,
      reason: "already_synthesized",
      messageId: existingReport.id,
      reportContent: existingReport.content,
    };
  }

  // 2. Fetch all tasks for this requestKey under this master conversation
  const tasks = await db
    .select({
      id: agentTasks.id,
      title: agentTasks.title,
      instructions: agentTasks.instructions,
      assignedAgentId: agentTasks.assignedAgentId,
      status: agentTasks.status,
      response: agentTasks.response,
      error: agentTasks.error,
      taskIndex: agentTasks.taskIndex,
    })
    .from(agentTasks)
    .where(
      and(
        eq(agentTasks.masterConversationId, masterConversationId),
        eq(agentTasks.requestKey, requestKey)
      )
    )
    .orderBy(asc(agentTasks.taskIndex), asc(agentTasks.id));

  if (tasks.length === 0) {
    return { triggered: false, reason: "no_tasks" };
  }

  // 3. Verify every single task has reached a terminal state
  const hasPending = tasks.some((t) => !TERMINAL_STATUSES.has(t.status));
  if (hasPending) {
    return { triggered: false, reason: "tasks_in_progress" };
  }

  // 4. Fetch all artifacts associated with these tasks
  const taskIds = tasks.map((t) => t.id);
  const artifacts = taskIds.length > 0
    ? await db
        .select({
          id: agentTaskArtifacts.id,
          taskId: agentTaskArtifacts.taskId,
          campaignId: agentTaskArtifacts.campaignId,
          artifactType: agentTaskArtifacts.artifactType,
          filename: agentTaskArtifacts.filename,
          mimeType: agentTaskArtifacts.mimeType,
          imagekitUrl: agentTaskArtifacts.imagekitUrl,
          sandboxPath: agentTaskArtifacts.sandboxPath,
        })
        .from(agentTaskArtifacts)
        .where(inArray(agentTaskArtifacts.taskId, taskIds))
    : [];

  // 5. Fetch the original user request from agentMessages
  const [userMsg] = await db
    .select({ content: agentMessages.content })
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.conversationId, masterConversationId),
        eq(agentMessages.requestKey, requestKey),
        eq(agentMessages.role, "user")
      )
    );

  const userGoal = userMsg?.content ?? "Campaign Execution Request";

  // 6. Build the synthesis payload for Gemini
  const taskSummaries = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    assignedAgent: t.assignedAgentId,
    status: t.status,
    response: t.response ?? "(no output recorded)",
    error: t.error ?? null,
  }));

  const artifactSummaries = artifacts.map((a) => {
    const accessibleUrl =
      a.imagekitUrl ||
      `/api/computer/artifacts/download?campaignId=${a.campaignId}&artifactId=${a.id}&view=1`;
    const downloadUrl = `/api/computer/artifacts/download?campaignId=${a.campaignId}&artifactId=${a.id}`;
    const isImage =
      a.artifactType === "image" ||
      a.mimeType?.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif)$/i.test(a.filename);

    return {
      id: a.id,
      filename: a.filename,
      type: a.artifactType,
      isImage,
      url: accessibleUrl,
      downloadUrl,
    };
  });

  const systemInstruction = `You are the Master Agent for SOTO AI.
Your team of specialist agents (Research, Content Creator, Scheduler, Analytics) has finished executing their assigned tasks for a user request.
Your job is to synthesize all specialist deliverables, research data, generated content, schedule dates, and verified assets into a single comprehensive, executive Final Report.

FORMATTING REQUIREMENTS:
- Use clean GitHub-flavored markdown.
- Present factual information from specialist responses. Never fabricate research data or links.
- Structure the report clearly with these sections:
  1. 🎯 Executive Summary & Mission Overview
  2. 🔍 Research Intelligence & Benchmark Findings (Include source URLs found by Research Agent)
  3. ✍️ Creative & Content Deliverables (Captions, Reels/Stories scripts, hashtags created by Content Creator)
  4. 🖼️ Generated Assets & Media (CRITICAL: Whenever an image asset was produced, you MUST embed the image inline using standard markdown image syntax: ![filename](url) followed by [Download filename](downloadUrl) so the user can view the image directly in the chat. Use ONLY the provided accessible preview URLs; NEVER invent URLs and NEVER use /home/user/... sandbox paths.)
  5. 📅 Campaign Schedule & Publishing Calendar (Include dates, posting slots, and channels from Scheduler)
  6. ✅ Completed Work Checklist
  7. ⚠️ Incomplete or Failed Work (State honestly if any task failed or was partial)
  8. 🚀 Next Steps & Recommended Actions
- Address the user directly as their trusted team leader.`;

  const prompt = `User Request:
"""${userGoal}"""

Tasks Executed:
${JSON.stringify(taskSummaries, null, 2)}

Artifacts Produced:
${JSON.stringify(artifactSummaries, null, 2)}

Please generate the consolidated Master Agent Final Report now.`;

  let reportText = "";
  try {
    const client = getGeminiClient();
    const model = getGeminiModel();
    const { executeWithRetry } = await import("./recovery/retry-policy.ts");
    const resp = await executeWithRetry(
      async () => client.models.generateContent({
        model,
        config: {
          systemInstruction: { parts: [{ text: systemInstruction }] },
          ...GEMINI_REQUEST_OPTIONS,
        },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
      {
        maxAttempts: 3,
        baseDelayMs: 1500,
        maxDelayMs: 8000,
        operationName: "master_agent_synthesis",
      },
    );
    reportText = resp.text?.trim() ?? "";
  } catch (modelErr: unknown) {
    console.error("[master-agent-synthesis] Gemini generation error, using fallback template:", modelErr);
    // Fallback synthesis if AI call encounters transient issue
    reportText = generateFallbackReport(userGoal, taskSummaries, artifactSummaries);
  }

  if (!reportText) {
    reportText = generateFallbackReport(userGoal, taskSummaries, artifactSummaries);
  }

  // 7. Save into agentMessages with idempotent onConflictDoNothing
  const [inserted] = await db
    .insert(agentMessages)
    .values({
      conversationId: masterConversationId,
      role: "assistant",
      content: reportText,
      requestKey: synthesisKey,
    })
    .onConflictDoNothing({
      target: [agentMessages.conversationId, agentMessages.requestKey, agentMessages.role],
    })
    .returning({ id: agentMessages.id });

  return {
    triggered: true,
    reason: "completed",
    messageId: inserted?.id,
    reportContent: reportText,
  };
}

export function generateFallbackReport(
  goal: string,
  tasks: Array<{ id: number; title: string; assignedAgent: string; status: string; response: string; error: string | null }>,
  artifacts: Array<{ filename: string; type: string; url: string; downloadUrl?: string; isImage?: boolean }>
): string {
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const failedTasks = tasks.filter((t) => t.status === "failed");

  const imageArtifacts = artifacts.filter((a) => a.isImage || a.type === "image" || /\.(png|jpe?g|webp|gif)$/i.test(a.filename));
  const docArtifacts = artifacts.filter((a) => !imageArtifacts.includes(a));

  return `## 🎯 Master Agent Campaign Final Report

**Campaign Goal:** ${goal}

---

### 📋 Executive Summary
All specialist tasks for this campaign have completed execution. Here is the synthesized summary of your team's deliverables:

### 🔍 Specialist Outputs
${tasks.map((t) => `#### Task #${t.id}: ${t.title} (${t.assignedAgent}) — **Status:** ${t.status.toUpperCase()}
${t.response ? `\n${t.response.slice(0, 500)}${t.response.length > 500 ? "…" : ""}` : "(No output recorded)"}
${t.error ? `\n> ⚠️ Error: ${t.error}` : ""}
`).join("\n")}

### 🖼️ Generated Deliverables & Artifacts
${imageArtifacts.length > 0 ? imageArtifacts.map((a) => `#### ${a.filename}\n\n![${a.filename}](${a.url})\n\n[Download ${a.filename}](${a.downloadUrl || a.url})`).join("\n\n") : ""}
${docArtifacts.length > 0 ? docArtifacts.map((a) => `- **${a.filename}** (${a.type}): [Download Deliverable](${a.downloadUrl || a.url})`).join("\n") : (imageArtifacts.length === 0 ? "No persistent media artifacts recorded." : "")}

### ✅ Completed Work
${completedTasks.map((t) => `- [x] ${t.title} (${t.assignedAgent})`).join("\n")}

${failedTasks.length > 0 ? `### ⚠️ Failed Work\n${failedTasks.map((t) => `- [ ] ${t.title} (${t.assignedAgent}) — ${t.error ?? "Failed"}`).join("\n")}` : ""}

### 🚀 Next Steps
You can review the generated content above, download saved artifacts, or ask me for refinements!`;
}

