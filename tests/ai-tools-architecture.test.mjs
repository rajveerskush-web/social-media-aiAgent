import assert from "node:assert/strict";
import test from "node:test";

import {
  registerTool,
  getTool,
  getAllToolDeclarations,
  executeRegisteredTool,
  formatFunctionResponsePart,
} from "../lib/ai/tools/runtime.ts";
import { COMPUTER_ACTION_TOOLS } from "../lib/ai/tools/computer-action.ts";
import { RESEARCH_TOOLS, searchWebTool, recordResearchFindingsTool } from "../lib/ai/tools/research.ts";
import { CONTENT_TOOLS, saveContentDraftTool, createCarouselBriefTool } from "../lib/ai/tools/content.ts";
import { IMAGE_TOOLS, generateImageTool } from "../lib/ai/tools/generate-image.ts";
import { FILE_STORAGE_TOOLS, saveArtifactTool } from "../lib/ai/tools/file-storage.ts";
import { USER_AND_RESULT_TOOLS, completeTaskTool, requestUserInputTool } from "../lib/ai/tools/user-and-result.ts";
import { AGENT_CONFIGS, getAgentConfig, getAgentTools } from "../lib/ai/agent-definitions.ts";
import { executeSpecialistAgent } from "../lib/ai/agents.ts";
import { validateMasterPlan, summarizeTaskStatuses } from "../lib/ai/master.ts";

test("lib/ai architecture: all modular tool categories are properly registered in runtime", () => {
  const allDecls = getAllToolDeclarations();
  const names = allDecls.map((d) => d.name);

  // Computer Actions
  assert.ok(names.includes("takeScreenshot"));
  assert.ok(names.includes("openBrowser"));
  assert.ok(names.includes("navigateTo"));
  assert.ok(names.includes("clickMouse"));
  assert.ok(names.includes("typeInput"));
  assert.ok(names.includes("scrollDisplay"));

  // Research
  assert.ok(names.includes("searchWeb"));
  assert.ok(names.includes("recordResearchFindings"));

  // Content & Image
  assert.ok(names.includes("generateImage"));
  assert.ok(names.includes("saveContentDraft"));
  assert.ok(names.includes("createCarouselBrief"));

  // File Storage & Task Terminal
  assert.ok(names.includes("readSandboxFile"));
  assert.ok(names.includes("writeSandboxFile"));
  assert.ok(names.includes("downloadSandboxFile"));
  assert.ok(names.includes("saveArtifact"));
  assert.ok(names.includes("completeTask"));
  assert.ok(names.includes("requestUserInput"));
});

test("lib/ai runtime: executeRegisteredTool safely handles unknown tools and error formatting", async () => {
  const context = {
    authUserId: "user-123",
    campaignId: 42,
    taskId: 101,
    agentId: "seat-1",
  };

  const unknown = await executeRegisteredTool("nonExistentTool", {}, context);
  assert.equal(unknown.success, false);
  assert.ok(unknown.error?.includes("Unknown tool"));

  // Format functionResponse part for Gemini
  const part = formatFunctionResponsePart("searchWeb", {
    success: true,
    output: "Query completed",
    data: { query: "NYC specialty coffee" },
  });
  assert.equal(part.functionResponse.name, "searchWeb");
  assert.equal(part.functionResponse.response.success, true);
  assert.equal(part.functionResponse.response.output, "Query completed");
});

test("lib/ai research tools: searchWeb formats queries and platform hints cleanly", async () => {
  const context = {
    authUserId: "user-123",
    campaignId: 42,
    taskId: 101,
    agentId: "seat-1",
  };

  const res = await searchWebTool.execute(
    { query: "artisan sourdough bakeries", focus: "google" },
    context,
  );
  assert.equal(res.success, true);
  assert.ok(res.output.includes("artisan sourdough bakeries"));
  assert.ok(res.data?.searchUrl?.includes("google.com"));
});

test("lib/ai user and result tools: completeTask and requestUserInput handle outcomes cleanly", async () => {
  const context = {
    authUserId: "user-123",
    campaignId: 42,
    taskId: 101,
    agentId: "seat-1",
  };

  const completeRes = await completeTaskTool.execute(
    {
      summary: "Finished competitor analysis",
      findings: "Competitors post twice weekly with high reel engagement",
      status: "success",
    },
    context,
  );
  assert.equal(completeRes.success, true);
  assert.ok(completeRes.output.includes("competitor analysis"));

  const userReq = await requestUserInputTool.execute(
    {
      reason: "requires_login",
      prompt: "Please log into your Instagram business account to grant access",
      loginUrl: "https://instagram.com/accounts/login",
    },
    context,
  );
  assert.equal(userReq.success, true);
  assert.equal(userReq.data?.waitingForUser, true);
  assert.ok(userReq.output.includes("Instagram"));
});

test("lib/ai agent definitions: configurations assign appropriate specialist tools per seat", () => {
  const research = getAgentConfig("seat-1");
  const content = getAgentConfig("seat-mvj4q0fn");
  const scheduler = getAgentConfig("seat-mvj4q1b7");
  const analytics = getAgentConfig("seat-mvj4q1mo");

  assert.ok(research);
  assert.ok(content);
  assert.ok(scheduler);
  assert.ok(analytics);

  assert.equal(research?.computerEligible, true);
  assert.equal(content?.computerEligible, true);
  assert.equal(scheduler?.computerEligible, false);
  assert.equal(analytics?.computerEligible, false);

  const researchTools = getAgentTools("seat-1", "direct").map((t) => t.declaration.name);
  assert.ok(researchTools.includes("searchWeb"));
  assert.ok(researchTools.includes("recordResearchFindings"));

  const contentTools = getAgentTools("seat-mvj4q0fn", "direct").map((t) => t.declaration.name);
  assert.ok(contentTools.includes("generateImage"));
  assert.ok(contentTools.includes("saveContentDraft"));
  assert.ok(contentTools.includes("createCarouselBrief"));

  // Non-computer agents should not get desktop tools
  const schedulerTools = getAgentTools("seat-mvj4q1b7", "computer").map((t) => t.declaration.name);
  assert.ok(!schedulerTools.includes("clickMouse"));
});

test("lib/ai master planner: plan validation and status summarization work cleanly", () => {
  const validPlan = JSON.stringify({
    tasks: [
      {
        agentId: "seat-1",
        title: "Analyze coffee roasters",
        instructions: "Find top 5 local coffee brands",
        dependsOn: [],
      },
      {
        agentId: "seat-mvj4q0fn",
        title: "Create carousel post",
        instructions: "Draft 3-slide visual post using research",
        dependsOn: [0],
      },
    ],
  });

  const availableSpecialistIds = ["seat-1", "seat-mvj4q0fn", "seat-mvj4q1b7", "seat-mvj4q1mo"];
  const validation = validateMasterPlan(validPlan, availableSpecialistIds);
  assert.equal(validation.ok, true);

  if (validation.ok) {
    assert.equal(validation.plan.tasks.length, 2);
    assert.equal(validation.plan.tasks[0].agentId, "seat-1");
    assert.equal(validation.plan.tasks[1].agentId, "seat-mvj4q0fn");
  }

  const summary = summarizeTaskStatuses([
    { id: 1, title: "Market research", status: "completed", assignedAgentId: "seat-1", response: "Top competitors identified." },
    { id: 2, title: "Draft carousel", status: "pending", assignedAgentId: "seat-mvj4q0fn" },
  ]);
  assert.ok(summary.includes("Market research"));
  assert.ok(summary.includes("completed"));
});
