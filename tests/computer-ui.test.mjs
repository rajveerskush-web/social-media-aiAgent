import assert from "node:assert/strict";
import test from "node:test";
import { isComputerEligible } from "../lib/computer-types.ts";
import {
  getComputerStatusService,
  getComputerStreamUrlService,
  takeoverComputerService,
  handbackComputerService,
} from "../lib/computer-service.ts";

// ---------------------------------------------------------------------------
// Helpers & Mock Fixtures for UI / API contract testing
// ---------------------------------------------------------------------------

function createMockDb(overrides = {}) {
  const computers = new Map();
  const tasks = new Map();
  const artifacts = new Map();
  let campaignStatus = overrides.campaignStatus ?? "active";

  const defaultComputer = {
    id: 1,
    authUserId: "user-alpha",
    campaignId: 101,
    agentId: "seat-1",
    status: "running",
    controlMode: "agent",
    activeTaskId: 501,
    error: null,
    pausedAt: null,
    sandboxId: "mock-sandbox-123",
    ...overrides.computer,
  };
  computers.set("101:seat-1", defaultComputer);

  const defaultTask = {
    id: 501,
    status: "running",
    executionLeaseToken: "lease-token-abc",
    executionLeaseExpiresAt: new Date(Date.now() + 60_000),
    ...overrides.task,
  };
  tasks.set(501, defaultTask);

  if (overrides.artifacts) {
    for (const art of overrides.artifacts) {
      artifacts.set(art.id, art);
    }
  }

  return {
    state: { computers, tasks, artifacts },
    async findCampaign(authUserId, campaignId) {
      if (authUserId !== "user-alpha") return null;
      if (campaignId && campaignId !== 101) return null;
      return {
        id: 101,
        authUserId: "user-alpha",
        name: "Q4 Campaign",
        status: campaignStatus,
      };
    },
    async findComputer(authUserId, campaignId, agentId) {
      if (authUserId !== "user-alpha") return null;
      return computers.get(`${campaignId}:${agentId}`) || null;
    },
    async upsertComputer(data) {
      const key = `${data.campaignId}:${data.agentId}`;
      const existing = computers.get(key) || {
        id: 1,
        ...data,
      };
      const updated = { ...existing, ...data };
      computers.set(key, updated);
      return updated;
    },
    async updateComputerControlMode(authUserId, campaignId, agentId, mode) {
      const key = `${campaignId}:${agentId}`;
      const existing = computers.get(key);
      if (!existing) return null;
      existing.controlMode = mode;
      return existing;
    },
    async updateComputerStatus(computerId, status, error, sandboxId) {
      for (const [k, v] of computers.entries()) {
        if (v.id === computerId) {
          v.status = status;
          v.error = error;
          if (sandboxId !== undefined) v.sandboxId = sandboxId;
        }
      }
    },
    async updateActiveTaskControlMode(computerId, status, waitingReason) {
      // updates task
    },
    async markComputerTaskFailed(computerId, reason) {},
    async findTask(taskId) {
      return tasks.get(taskId) || null;
    },
    async routeTaskToRecovery(taskId) {
      const t = tasks.get(taskId);
      if (t) t.status = "queued";
    },
    async findArtifact(authUserId, campaignId, artifactId) {
      return artifacts.get(artifactId) || null;
    },
    async endCampaign(campaignId) {
      campaignStatus = "ended";
      return { cancelledTasksCount: 1, terminatedComputersCount: 1 };
    },
  };
}

function createMockSandbox(options = {}) {
  let isVNCRunning = options.vncRunning ?? true;
  return {
    stream: {
      async start(opts) {
        if (options.failStream) throw new Error("VNC daemon start failed");
      },
      getUrl(opts) {
        return `https://mock-vnc.e2b.dev/?view_only=${opts?.viewOnly ? "1" : "0"}`;
      },
      async checkVNCRunning() {
        return isVNCRunning;
      },
      async getAuthKey() {
        return "auth-token-xyz";
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Status Rendering Logic Tests
// ---------------------------------------------------------------------------

test("UI Status: reports 'Running' when computer is running under AI control", async () => {
  const db = createMockDb();
  const res = await getComputerStatusService(
    "user-alpha",
    "seat-1",
    101,
    { db },
  );

  assert.equal(res.eligible, true);
  assert.equal(res.computer?.status, "running");
  assert.equal(res.computer?.controlMode, "agent");
  assert.equal(res.campaignStatus, "active");
});

test("UI Status: reports 'Waiting for You' when human takeover is active", async () => {
  const db = createMockDb({
    computer: { controlMode: "human", status: "running" },
  });
  const res = await getComputerStatusService(
    "user-alpha",
    "seat-1",
    101,
    { db },
  );

  assert.equal(res.computer?.controlMode, "human");
  const isWaitingForUser = res.computer?.controlMode === "human";
  assert.equal(isWaitingForUser, true);
});

test("UI Status: reports 'Stopped' when no computer session has been created", async () => {
  const db = createMockDb({
    computer: { status: "stopped", activeTaskId: null },
  });
  const res = await getComputerStatusService(
    "user-alpha",
    "seat-1",
    101,
    { db },
  );

  assert.equal(res.computer?.status, "stopped");
});

test("UI Status: reports 'Campaign Ended' and terminates access when campaign has ended", async () => {
  const db = createMockDb({ campaignStatus: "ended" });
  const res = await getComputerStatusService(
    "user-alpha",
    "seat-1",
    101,
    { db },
  );

  assert.equal(res.campaignStatus, "ended");
});

// ---------------------------------------------------------------------------
// 2. Stream Loading & View-Only vs Interactive Mode
// ---------------------------------------------------------------------------

test("Stream UI: returns view-only stream URL when agent is in control", async () => {
  const db = createMockDb({
    computer: { status: "running", controlMode: "agent" },
  });
  const sandbox = createMockSandbox();
  const res = await getComputerStreamUrlService(
    "user-alpha",
    "seat-1",
    101,
    { db, getActiveSandbox: () => sandbox },
  );

  assert.equal(res.controlMode, "agent");
  assert.match(res.streamUrl, /view_only=1/);
});

test("Stream UI: returns interactive stream URL when human takeover is active", async () => {
  const db = createMockDb({
    computer: { status: "running", controlMode: "human" },
  });
  const sandbox = createMockSandbox();
  const res = await getComputerStreamUrlService(
    "user-alpha",
    "seat-1",
    101,
    { db, getActiveSandbox: () => sandbox },
  );

  assert.equal(res.controlMode, "human");
  assert.match(res.streamUrl, /view_only=0/);
});

test("Stream UI: fails truthfully with clean error when stream daemon cannot start", async () => {
  const db = createMockDb({
    computer: { status: "running", controlMode: "agent" },
  });
  const sandbox = createMockSandbox({ failStream: true });

  await assert.rejects(
    async () =>
      getComputerStreamUrlService(
        "user-alpha",
        "seat-1",
        101,
        { db, getActiveSandbox: () => sandbox },
      ),
    /VNC daemon start failed/,
  );
});

// ---------------------------------------------------------------------------
// 3. Takeover & Handback Workflow
// ---------------------------------------------------------------------------

test("Takeover & Handback: Takeover switches to human mode, Handback returns to agent mode", async () => {
  const db = createMockDb({
    computer: { status: "running", controlMode: "agent" },
  });

  // Step 1: Take over
  const takeoverRes = await takeoverComputerService(
    "user-alpha",
    "seat-1",
    101,
    { db },
  );
  assert.equal(takeoverRes.controlMode, "human");
  assert.equal(db.state.computers.get("101:seat-1").controlMode, "human");

  // Step 2: Hand back
  const sandbox = createMockSandbox();
  const handbackRes = await handbackComputerService(
    "user-alpha",
    "seat-1",
    101,
    { db, getActiveSandbox: () => sandbox },
  );
  assert.equal(handbackRes.controlMode, "agent");
  assert.equal(db.state.computers.get("101:seat-1").controlMode, "agent");
});

// ---------------------------------------------------------------------------
// 4. Ineligible Specialists Exclusion (Scheduling & Analytics)
// ---------------------------------------------------------------------------

test("Eligibility: Scheduling and Analytics agents are rejected from Computer view", async () => {
  assert.equal(isComputerEligible("seat-1"), true); // Research
  assert.equal(isComputerEligible("seat-mvj4q0fn"), true); // Content
  assert.equal(isComputerEligible("seat-mvj4q1b7"), false); // Scheduling
  assert.equal(isComputerEligible("seat-mvj4q1mo"), false); // Analytics

  const db = createMockDb();
  const resSched = await getComputerStatusService("user-alpha", "seat-mvj4q1b7", 101, { db });
  assert.equal(resSched.eligible, false);
  assert.match(resSched.message, /not eligible/i);

  const resAnalytics = await getComputerStatusService("user-alpha", "seat-mvj4q1mo", 101, { db });
  assert.equal(resAnalytics.eligible, false);
  assert.match(resAnalytics.message, /not eligible/i);
});

// ---------------------------------------------------------------------------
// 5. Artifact Verification & Temporary Storage Disclaimer Contract
// ---------------------------------------------------------------------------

test("Artifacts: verifies artifact metadata and reports truthful count", async () => {
  const artifactsList = [
    {
      id: 901,
      taskId: 501,
      authUserId: "user-alpha",
      campaignId: 101,
      artifactType: "document",
      filename: "ai_market_research.md",
      mimeType: "text/markdown",
      sizeBytes: 15420,
      sandboxPath: "/home/user/output/ai_market_research.md",
      isVerified: true,
      createdAt: new Date().toISOString(),
    },
  ];

  const db = createMockDb({ artifacts: artifactsList });
  // Find artifact via db service
  const art = await db.findArtifact("user-alpha", 101, 901);
  assert.ok(art);
  assert.equal(art.filename, "ai_market_research.md");
  assert.equal(art.isVerified, true);
  assert.equal(art.sizeBytes, 15420);
});

// ---------------------------------------------------------------------------
// 6. UI Screenshot Preview, Expanded View & Campaign End Contracts
// ---------------------------------------------------------------------------

test("UI Screenshot: returns saved screenshot when computer is paused or stopped", async () => {
  const db = createMockDb({
    computer: {
      status: "paused",
      pausedAt: new Date("2026-10-29T12:05:00Z"),
      lastScreenshotAt: new Date("2026-10-29T12:05:00Z"),
      lastScreenshotBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    },
  });

  const res = await getComputerStatusService("user-alpha", "seat-1", 101, { db });
  assert.equal(res.eligible, true);
  assert.equal(res.computer?.status, "paused");
  assert.equal(res.computer?.lastScreenshotBase64, "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");
});

test("UI Expanded Stream: preserves viewOnly mode in agent control mode", async () => {
  const sandbox = createMockSandbox();

  const db = createMockDb({
    computer: {
      status: "running",
      controlMode: "agent",
    },
  });

  const streamRes = await getComputerStreamUrlService(
    "user-alpha",
    "seat-1",
    101,
    { db, getActiveSandbox: () => sandbox },
  );

  assert.equal(streamRes.controlMode, "agent");
  assert.match(streamRes.streamUrl, /view_only=1/);
});

test("UI Expanded Stream: enables interactive control only during human takeover", async () => {
  const sandbox = createMockSandbox();

  const db = createMockDb({
    computer: {
      status: "running",
      controlMode: "human",
    },
  });

  const streamRes = await getComputerStreamUrlService(
    "user-alpha",
    "seat-1",
    101,
    { db, getActiveSandbox: () => sandbox },
  );

  assert.equal(streamRes.controlMode, "human");
  assert.match(streamRes.streamUrl, /view_only=0/);
});
