import assert from "node:assert/strict";
import test from "node:test";
import {
  RESEARCH_TOOL_DECLARATIONS,
  CONTENT_CREATOR_TOOL_DECLARATIONS,
  getSpecialistToolDeclarations,
} from "../lib/specialist-tools.ts";
import { getAgentComputerDeclarations } from "../lib/computer-declarations.ts";
import { formatExecutionStatus, formatElapsedTime } from "../lib/agent-activity-format.ts";

test("specialist tool declarations: Research Agent has native search and report recording", () => {
  const toolNames = RESEARCH_TOOL_DECLARATIONS.map((t) => t.name);
  assert.ok(toolNames.includes("recordResearchFindings"));
  assert.ok(toolNames.includes("searchWeb"));

  const recordTool = RESEARCH_TOOL_DECLARATIONS.find((t) => t.name === "recordResearchFindings");
  assert.equal(recordTool?.parameters?.type, "OBJECT");
  assert.ok(recordTool?.parameters?.properties?.title);
  assert.ok(recordTool?.parameters?.properties?.summary);
  assert.ok(recordTool?.parameters?.properties?.detailedFindings);
  assert.ok(recordTool?.parameters?.properties?.sourceUrls);
});

test("specialist tool declarations: Content Creator Agent has image generation and draft saving", () => {
  const toolNames = CONTENT_CREATOR_TOOL_DECLARATIONS.map((t) => t.name);
  assert.ok(toolNames.includes("generateImage"));
  assert.ok(toolNames.includes("saveContentDraft"));
  assert.ok(toolNames.includes("createCarouselBrief"));

  const imgTool = CONTENT_CREATOR_TOOL_DECLARATIONS.find((t) => t.name === "generateImage");
  assert.equal(imgTool?.parameters?.type, "OBJECT");
  assert.ok(imgTool?.parameters?.properties?.prompt);
  assert.ok(imgTool?.parameters?.properties?.aspectRatio);
  assert.ok(imgTool?.parameters?.properties?.stylePreset);

  const draftTool = CONTENT_CREATOR_TOOL_DECLARATIONS.find((t) => t.name === "saveContentDraft");
  assert.ok(draftTool?.parameters?.properties?.caption);
  assert.ok(draftTool?.parameters?.properties?.hashtags);
  assert.ok(draftTool?.parameters?.properties?.hookText);
});

test("getSpecialistToolDeclarations returns correct subset per agent ID", () => {
  const researchTools = getSpecialistToolDeclarations("seat-1");
  const contentTools = getSpecialistToolDeclarations("seat-mvj4q0fn");
  const otherTools = getSpecialistToolDeclarations("seat-mvj4q1b7");

  assert.equal(researchTools.length, 2);
  assert.equal(contentTools.length, 3);
  assert.equal(otherTools.length, 0);
});

test("getAgentComputerDeclarations merges primitives with specialist tools for eligible agents", () => {
  const researchComputerDecls = getAgentComputerDeclarations("seat-1");
  const contentComputerDecls = getAgentComputerDeclarations("seat-mvj4q0fn");
  const schedulerDecls = getAgentComputerDeclarations("seat-mvj4q1b7");

  const researchNames = researchComputerDecls.map((d) => d.name);
  assert.ok(researchNames.includes("takeScreenshot"));
  assert.ok(researchNames.includes("clickMouse"));
  assert.ok(researchNames.includes("openBrowser"));
  assert.ok(researchNames.includes("recordResearchFindings"));
  assert.ok(researchNames.includes("searchWeb"));

  const contentNames = contentComputerDecls.map((d) => d.name);
  assert.ok(contentNames.includes("takeScreenshot"));
  assert.ok(contentNames.includes("generateImage"));
  assert.ok(contentNames.includes("saveContentDraft"));
  assert.ok(contentNames.includes("createCarouselBrief"));

  // Non-specialist agents get the standard base primitive declarations
  assert.equal(schedulerDecls.length, 13);
});

test("popover formatters and execution status integrity", () => {
  assert.equal(formatExecutionStatus("running").label, "Working");
  assert.equal(formatExecutionStatus("ready").label, "Ready");
  assert.equal(formatExecutionStatus("failed").label, "Failed");
  assert.equal(formatExecutionStatus("waiting_for_user").label, "Waiting for You");

  assert.equal(formatElapsedTime(undefined), "—");
  assert.equal(formatElapsedTime(45000), "45s");
  assert.equal(formatElapsedTime(125000), "2m 5s");
});
