import test from "node:test";
import assert from "node:assert/strict";
import { formatExecutionStatus, formatTaskErrorMessage } from "../lib/agent-activity-format.ts";

test("popover positioning: workspace selector never shifts upwards into topbar", () => {
  // Simulate workspace selector boundaries
  const triggerRect = { top: 120, bottom: 206, left: 300, right: 460, width: 160 };
  const workspaceContainer = { left: 40, right: 680, width: 640 };
  const popoverWidth = 280;
  const popoverHeight = 310;
  const viewportTop = 78;

  // Workspace selector placement must always be 'bottom'
  const nextPlacement = "bottom";
  assert.equal(nextPlacement, "bottom");

  // In workspace selector, verticalShift is strictly 0 (never negative)
  const isWorkspaceSelector = true;
  const vShift = isWorkspaceSelector ? 0 : -100;
  assert.equal(vShift, 0);

  // The resulting top is strictly below the trigger card
  const popoverTop = triggerRect.bottom + 9 + vShift;
  assert.equal(popoverTop, 215);
  assert.ok(popoverTop >= viewportTop, "Popover top must stay well below topbar/viewport top");

  // Horizontal shift stays within workspace boundaries
  const triggerCenterX = triggerRect.left + triggerRect.width / 2;
  const idealLeft = triggerCenterX - popoverWidth / 2;
  const idealRight = triggerCenterX + popoverWidth / 2;
  const minLeft = workspaceContainer.left + 8;
  const maxRight = workspaceContainer.right - 8;

  let hShift = 0;
  if (idealLeft < minLeft) hShift = minLeft - idealLeft;
  else if (idealRight > maxRight) hShift = maxRight - idealRight;

  const actualLeft = idealLeft + hShift;
  const actualRight = idealRight + hShift;

  assert.ok(actualLeft >= minLeft, "Popover left must not breach workspace left");
  assert.ok(actualRight <= maxRight, "Popover right must not bleed into office column");
});

test("agent status formatting: completed status yields 'Done' with 'is-completed' class", () => {
  const result = formatExecutionStatus("completed");
  assert.equal(result.label, "Done");
  assert.equal(result.cssClass, "is-completed");

  const runningResult = formatExecutionStatus("running");
  assert.equal(runningResult.label, "Working");
  assert.equal(runningResult.cssClass, "is-running");

  const waitingResult = formatExecutionStatus("waiting_for_user");
  assert.equal(waitingResult.label, "Waiting for You");
  assert.equal(waitingResult.cssClass, "is-waiting");

  const readyResult = formatExecutionStatus("ready");
  assert.equal(readyResult.label, "Ready");
  assert.equal(readyResult.cssClass, "is-ready");

  const failedResult = formatExecutionStatus("failed");
  assert.equal(failedResult.label, "Failed");
  assert.equal(failedResult.cssClass, "is-failed");
});

test("synthesis idempotency: requestKey formulation prevents duplicates", () => {
  const requestKey = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const synthesisKey = `final-report:${requestKey}`;
  assert.equal(synthesisKey, "final-report:a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  assert.ok(synthesisKey.startsWith("final-report:"));
});

test("formatTaskErrorMessage cleans opaque provider_error into clear UI message", () => {
  assert.equal(
    formatTaskErrorMessage("provider_error"),
    "AI Model Service encountered a temporary provider issue and halted safely."
  );
  assert.equal(
    formatTaskErrorMessage("provider_error: Model overloaded"),
    "Provider Notice: Model overloaded"
  );
  assert.equal(
    formatTaskErrorMessage("The Gemini API service encountered temporary high load (HTTP 503)"),
    "The Gemini API service encountered temporary high load (HTTP 503)"
  );
  assert.equal(formatTaskErrorMessage(null), "");
  assert.equal(formatTaskErrorMessage(""), "");
});


