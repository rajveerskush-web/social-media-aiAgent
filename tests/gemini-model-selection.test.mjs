import assert from "node:assert/strict";
import test from "node:test";
import { selectSpecialistModel } from "../lib/gemini-model-selection.ts";

const specialistIds = ["seat-1", "seat-mvj4q0fn", "seat-mvj4q1b7", "seat-mvj4q1mo"];
const defaultModel = "gemini-3.1-flash-lite";
const testModel = "gemini-3.5-flash-lite";

test("uses the test model only for the selected valid specialist", () => {
  assert.equal(selectSpecialistModel({
    agentId: "seat-mvj4q0fn",
    defaultModel,
    selectedSpecialistId: "seat-mvj4q0fn",
    testModel,
    specialistIds,
  }), testModel);

  assert.equal(selectSpecialistModel({
    agentId: "seat-1",
    defaultModel,
    selectedSpecialistId: "seat-mvj4q0fn",
    testModel,
    specialistIds,
  }), defaultModel);
});

test("falls back to the default model for invalid or incomplete test settings", () => {
  assert.equal(selectSpecialistModel({
    agentId: "master-agent",
    defaultModel,
    selectedSpecialistId: "master-agent",
    testModel,
    specialistIds,
  }), defaultModel);

  assert.equal(selectSpecialistModel({
    agentId: "seat-mvj4q0fn",
    defaultModel,
    selectedSpecialistId: "seat-mvj4q0fn",
    specialistIds,
  }), defaultModel);
});
