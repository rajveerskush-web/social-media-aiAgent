import assert from "node:assert/strict";
import test from "node:test";
import {
  isComputerEligible,
  COMPUTER_AGENT_IDS,
  HumanTakeoverActiveError,
  CampaignEndedAbortError,
  IneligibleAgentComputerError,
  ComputerConcurrencyConflictError,
  assertComputerActionAllowed,
} from "../lib/computer-types.ts";

test("identifies computer eligible specialists strictly", () => {
  assert.equal(isComputerEligible("seat-1"), true);
  assert.equal(isComputerEligible("seat-mvj4q0fn"), true);
  assert.equal(isComputerEligible("seat-mvj4q1b7"), false); // Scheduling agent
  assert.equal(isComputerEligible("seat-mvj4q1mo"), false); // Analytics agent
  assert.equal(isComputerEligible("master-agent"), false);
  assert.equal(isComputerEligible(""), false);
  assert.equal(isComputerEligible(null), false);
  assert.equal(isComputerEligible(undefined), false);
  assert.deepEqual(COMPUTER_AGENT_IDS, ["seat-1", "seat-mvj4q0fn"]);
});

test("assertComputerActionAllowed permits AI execution only in agent mode for active campaigns", () => {
  // Active and agent mode -> passes cleanly
  assert.doesNotThrow(() => assertComputerActionAllowed("agent", "active"));

  // Human mode -> throws HumanTakeoverActiveError
  assert.throws(
    () => assertComputerActionAllowed("human", "active"),
    HumanTakeoverActiveError,
  );

  // Ended campaign -> throws CampaignEndedAbortError even if agent mode
  assert.throws(
    () => assertComputerActionAllowed("agent", "ended"),
    CampaignEndedAbortError,
  );

  // Both human and ended -> throws CampaignEndedAbortError first
  assert.throws(
    () => assertComputerActionAllowed("human", "ended"),
    CampaignEndedAbortError,
  );
});

test("error classes construct with expected names and messages", () => {
  const takeoverErr = new HumanTakeoverActiveError();
  assert.equal(takeoverErr.name, "HumanTakeoverActiveError");
  assert.match(takeoverErr.message, /blocked while user is in control/i);

  const endedErr = new CampaignEndedAbortError();
  assert.equal(endedErr.name, "CampaignEndedAbortError");
  assert.match(endedErr.message, /campaign has ended/i);

  const ineligibleErr = new IneligibleAgentComputerError("seat-mvj4q1b7");
  assert.equal(ineligibleErr.name, "IneligibleAgentComputerError");
  assert.match(ineligibleErr.message, /seat-mvj4q1b7 is not eligible/i);

  const concurrencyErr = new ComputerConcurrencyConflictError();
  assert.equal(concurrencyErr.name, "ComputerConcurrencyConflictError");
  assert.match(concurrencyErr.message, /another task is already controlling/i);
});
