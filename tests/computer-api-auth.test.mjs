import assert from "node:assert/strict";
import test from "node:test";
import {
  ArtifactNotFoundError,
  ArtifactUnverifiedError,
  CampaignEndedAbortError,
  ComputerNotRunningError,
  HumanTakeoverActiveError,
  IneligibleAgentComputerError,
  InvalidPathAccessError,
  assertComputerActionAllowed,
} from "../lib/computer-types.ts";
import {
  downloadArtifactService,
  endCampaignService,
  getComputerStatusService,
  getComputerStreamUrlService,
  handbackComputerService,
  reconnectSandboxService,
  startComputerService,
  stopComputerService,
  sweepIdleComputersService,
  sweepStaleWaitingTasksService,
  takeoverComputerService,
} from "../lib/computer-service.ts";

// ---------------------------------------------------------------------------
// Mock Database & State Harness
// ---------------------------------------------------------------------------

function createMockDb(initialState = {}) {
  const state = {
    campaigns: initialState.campaigns ?? [
      { id: 101, authUserId: "user-alpha", name: "Alpha Campaign", status: "active" },
      { id: 102, authUserId: "user-bravo", name: "Bravo Campaign", status: "active" },
      { id: 103, authUserId: "user-alpha", name: "Ended Campaign", status: "ended", endedAt: new Date() },
    ],
    computers: initialState.computers ?? [
      {
        id: 1,
        authUserId: "user-alpha",
        campaignId: 101,
        agentId: "seat-1",
        sandboxId: "sbx-alpha-research",
        status: "running",
        controlMode: "agent",
        activeTaskId: 501,
        lastActiveAt: new Date(),
        lastScreenshotAt: new Date(),
      },
      {
        id: 2,
        authUserId: "user-alpha",
        campaignId: 101,
        agentId: "seat-mvj4q0fn",
        sandboxId: null,
        status: "stopped",
        controlMode: "agent",
        activeTaskId: null,
      },
    ],
    activeTasks: initialState.activeTasks ?? [
      { id: 501, computerId: 1, status: "active", waitingReason: null },
    ],
    tasks: initialState.tasks ?? [
      {
        id: 501,
        status: "running",
        executionLeaseToken: "lease-501-valid",
        executionLeaseExpiresAt: new Date(Date.now() + 10 * 60_000), // valid
      },
      {
        id: 502,
        status: "running",
        executionLeaseToken: "lease-502-expired",
        executionLeaseExpiresAt: new Date(Date.now() - 60_000), // expired
      },
    ],
    recoveredTasks: [],
    artifacts: initialState.artifacts ?? [
      {
        id: 801,
        taskId: 501,
        authUserId: "user-alpha",
        campaignId: 101,
        artifactType: "markdown",
        filename: "competitor_analysis.md",
        mimeType: "text/markdown",
        sizeBytes: 1024,
        sandboxPath: "/home/user/research/competitor_analysis.md",
        isVerified: true,
      },
      {
        id: 802,
        taskId: 501,
        authUserId: "user-alpha",
        campaignId: 101,
        artifactType: "image",
        filename: "unverified.png",
        mimeType: "image/png",
        sizeBytes: 0,
        sandboxPath: "/home/user/assets/unverified.png",
        isVerified: false,
      },
      {
        id: 803,
        taskId: 501,
        authUserId: "user-alpha",
        campaignId: 101,
        artifactType: "text",
        filename: "traversal.txt",
        mimeType: "text/plain",
        sizeBytes: 100,
        sandboxPath: "/home/user/../../etc/shadow",
        isVerified: true,
      },
      {
        id: 804,
        taskId: 502,
        authUserId: "user-bravo",
        campaignId: 102,
        artifactType: "markdown",
        filename: "bravo_secret.md",
        mimeType: "text/markdown",
        sizeBytes: 500,
        sandboxPath: "/home/user/output/bravo_secret.md",
        isVerified: true,
      },
    ],
    endCampaignCalls: [],
  };

  return {
    state,
    async findCampaign(authUserId, campaignId) {
      if (campaignId) {
        return state.campaigns.find((c) => c.id === campaignId && c.authUserId === authUserId) ?? null;
      }
      return state.campaigns.find((c) => c.authUserId === authUserId) ?? null;
    },
    async findComputer(authUserId, campaignId, agentId) {
      return (
        state.computers.find(
          (c) => c.authUserId === authUserId && c.campaignId === campaignId && c.agentId === agentId,
        ) ?? null
      );
    },
    async upsertComputer(data) {
      let comp = state.computers.find(
        (c) => c.authUserId === data.authUserId && c.campaignId === data.campaignId && c.agentId === data.agentId,
      );
      if (!comp) {
        comp = {
          id: state.computers.length + 1,
          authUserId: data.authUserId,
          campaignId: data.campaignId,
          agentId: data.agentId,
          status: data.status ?? "stopped",
          controlMode: data.controlMode ?? "agent",
        };
        state.computers.push(comp);
      }
      return comp;
    },
    async updateComputerControlMode(authUserId, campaignId, agentId, controlMode) {
      const comp = state.computers.find(
        (c) => c.authUserId === authUserId && c.campaignId === campaignId && c.agentId === agentId,
      );
      if (comp) {
        comp.controlMode = controlMode;
      }
      return comp ?? null;
    },
    async updateActiveTaskControlMode(computerId, status, waitingReason) {
      const task = state.activeTasks.find((t) => t.computerId === computerId);
      if (task) {
        task.status = status;
        task.waitingReason = waitingReason ?? null;
      }
    },
    async updateComputerStatus(computerId, status, error, sandboxId) {
      const comp = state.computers.find((c) => c.id === computerId);
      if (comp) {
        comp.status = status;
        if (error !== undefined) comp.error = error;
        if (sandboxId !== undefined) comp.sandboxId = sandboxId;
      }
    },
    async markComputerTaskFailed(computerId, reason) {
      const task = state.activeTasks.find((t) => t.computerId === computerId);
      if (task) {
        task.status = "failed";
        task.activityDescription = reason;
      }
    },
    async findTask(taskId) {
      return state.tasks.find((t) => t.id === taskId) ?? null;
    },
    async routeTaskToRecovery(taskId) {
      state.recoveredTasks.push(taskId);
      const task = state.tasks.find((t) => t.id === taskId);
      if (task) {
        task.status = "queued";
        task.executionLeaseToken = null;
        task.executionLeaseExpiresAt = null;
      }
    },
    async findArtifact(authUserId, campaignId, artifactId) {
      return (
        state.artifacts.find(
          (a) => a.id === artifactId && a.campaignId === campaignId && a.authUserId === authUserId,
        ) ?? null
      );
    },
    async endCampaign(campaignId) {
      state.endCampaignCalls.push(campaignId);
      const camp = state.campaigns.find((c) => c.id === campaignId);
      if (camp) {
        camp.status = "ended";
        camp.endedAt = new Date();
      }
      state.computers
        .filter((c) => c.campaignId === campaignId)
        .forEach((c) => {
          c.status = "terminated";
          c.sandboxId = null;
        });
      return { cancelledTasksCount: 3, terminatedComputersCount: 2 };
    },
    async findIdleComputers(idleThreshold) {
      return state.computers.filter(
        (c) =>
          c.status === "running" &&
          c.controlMode === "agent" &&
          !c.activeTaskId &&
          c.lastActiveAt &&
          new Date(c.lastActiveAt).getTime() <= new Date(idleThreshold).getTime(),
      );
    },
    async pauseComputer(computerId, screenshotBase64, screenshotAt) {
      const comp = state.computers.find(
        (c) =>
          c.id === computerId &&
          (c.status === "running" || c.status === "error") &&
          !c.activeTaskId,
      );
      if (!comp) return false;
      comp.status = "paused";
      comp.pausedAt = screenshotAt ?? new Date();
      if (screenshotBase64 !== undefined) {
        comp.lastScreenshotBase64 = screenshotBase64;
        comp.lastScreenshotAt = screenshotAt ?? new Date();
      }
      return true;
    },
    async findStaleWaitingTasks(staleThreshold) {
      const stale = [];
      for (const t of state.activeTasks) {
        if (
          t.status === "waiting_for_user" &&
          t.waitingSince &&
          new Date(t.waitingSince).getTime() <= new Date(staleThreshold).getTime()
        ) {
          const comp = state.computers.find((c) => c.id === t.computerId);
          stale.push({
            computerTaskId: t.id,
            taskId: t.taskId ?? t.id,
            computerId: t.computerId,
            campaignId: comp?.campaignId ?? 101,
            waitingSince: t.waitingSince,
          });
        }
      }
      return stale;
    },
    async expireWaitingTask(computerTaskId, taskId, computerId, reason) {
      const activeTask = state.activeTasks.find((t) => t.id === computerTaskId);
      if (activeTask) {
        activeTask.status = "failed";
        activeTask.activityDescription = reason;
        activeTask.waitingReason = null;
      }
      const task = state.tasks.find((t) => t.id === taskId);
      if (task) {
        task.status = "failed";
        task.error = reason;
        task.executionLeaseToken = null;
        task.executionLeaseExpiresAt = null;
      }
      const comp = state.computers.find((c) => c.id === computerId);
      if (comp && comp.activeTaskId === taskId) {
        comp.activeTaskId = null;
        comp.controlMode = "agent";
      }
      return true;
    },
  };
}

function createMockStreamSandbox(options = {}) {
  let streamStarted = false;
  return {
    stream: {
      async start(opts) {
        if (options.throwAlreadyRunning) {
          throw new Error("Stream is already running");
        }
        if (options.throwUnrelated) {
          throw new Error("E2B stream network timeout");
        }
        streamStarted = true;
      },
      async checkVNCRunning() {
        return options.processRunning ?? true;
      },
      getAuthKey() {
        if (options.throwMissingAuthKey) {
          throw new Error("Unable to retrieve stream auth key");
        }
        return "mock-auth-token-123456";
      },
      getUrl(opts) {
        if (options.throwOnGetUrl) throw new Error("Stream provider unreachable");
        return `https://mock.e2b.dev/stream?auth=${opts?.authKey}&viewOnly=${opts?.viewOnly}`;
      },
    },
    commands: {
      async run(cmd) {
        if (cmd === "pgrep -x x11vnc") {
          return { stdout: (options.processRunning ?? true) ? "1234\n" : "", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    },
    async kill() {
      if (options.failKill) {
        throw new Error("E2B MicroVM termination timeout");
      }
    },
    files: {
      async read(path, opts) {
        return new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests: Authorization & Status Endpoint
// ---------------------------------------------------------------------------

test("status endpoint: rejects unauthorized/cross-campaign lookups", async () => {
  const db = createMockDb();
  // user-alpha tries to access user-bravo's campaign 102
  await assert.rejects(
    async () => getComputerStatusService("user-alpha", "seat-1", 102, { db }),
    /Campaign not found or access denied/,
  );
});

test("status endpoint: reports ineligible agents without creating computers", async () => {
  const db = createMockDb();
  // Scheduling agent (seat-mvj4q1b7)
  const resultSched = await getComputerStatusService("user-alpha", "seat-mvj4q1b7", 101, { db });
  assert.equal(resultSched.eligible, false);

  // Analytics agent (seat-mvj4q1mo)
  const resultAnalytics = await getComputerStatusService("user-alpha", "seat-mvj4q1mo", 101, { db });
  assert.equal(resultAnalytics.eligible, false);
});

test("status endpoint: returns computer status accurately for eligible agents", async () => {
  const db = createMockDb();
  const result = await getComputerStatusService("user-alpha", "seat-1", 101, { db });
  assert.equal(result.eligible, true);
  assert.equal(result.campaignId, 101);
  assert.equal(result.computer?.status, "running");
  assert.equal(result.computer?.controlMode, "agent");
  assert.equal(result.computer?.hasSandbox, true);
});

// ---------------------------------------------------------------------------
// Tests: Secure Desktop Streaming & Token Protection
// ---------------------------------------------------------------------------

test("stream-url: prevents cross-campaign stream access", async () => {
  const db = createMockDb();
  // user-bravo tries to fetch stream for user-alpha's campaign 101
  await assert.rejects(
    async () => getComputerStreamUrlService("user-bravo", "seat-1", 101, { db }),
    /Campaign not found or access denied/,
  );
});

test("stream-url: rejects stream for non-running computer", async () => {
  const db = createMockDb();
  // seat-mvj4q0fn is stopped
  await assert.rejects(
    async () => getComputerStreamUrlService("user-alpha", "seat-mvj4q0fn", 101, { db }),
    ComputerNotRunningError,
  );
});

test("stream-url: rejects stream for ended campaign", async () => {
  const db = createMockDb();
  // campaign 103 is ended
  await assert.rejects(
    async () => getComputerStreamUrlService("user-alpha", "seat-1", 103, { db }),
    CampaignEndedAbortError,
  );
});

test("stream-url: returns view-only stream when agent is in control", async () => {
  const db = createMockDb();
  const mockSandbox = createMockStreamSandbox();
  const deps = {
    db,
    getActiveSandbox: () => mockSandbox,
  };

  const streamInfo = await getComputerStreamUrlService("user-alpha", "seat-1", 101, deps);
  assert.equal(streamInfo.controlMode, "agent");
  assert.match(streamInfo.streamUrl, /viewOnly=true/);
});

test("stream-url: returns interactive stream when human takeover is active", async () => {
  const db = createMockDb();
  // Switch to human mode
  await db.updateComputerControlMode("user-alpha", 101, "seat-1", "human");

  const mockSandbox = createMockStreamSandbox();
  const deps = {
    db,
    getActiveSandbox: () => mockSandbox,
  };

  const streamInfo = await getComputerStreamUrlService("user-alpha", "seat-1", 101, deps);
  assert.equal(streamInfo.controlMode, "human");
  assert.match(streamInfo.streamUrl, /viewOnly=false/);
});

test("stream-url: safely handles 'Stream is already running' when verified usable", async () => {
  const db = createMockDb();
  const mockSandbox = createMockStreamSandbox({
    throwAlreadyRunning: true,
    processRunning: true,
  });
  const deps = {
    db,
    getActiveSandbox: () => mockSandbox,
  };

  const streamInfo = await getComputerStreamUrlService("user-alpha", "seat-1", 101, deps);
  assert.equal(streamInfo.controlMode, "agent");
  assert.match(streamInfo.streamUrl, /mock-auth-token-123456/);
});

test("stream-url: rejects 'Stream is already running' when process is dead or inactive", async () => {
  const db = createMockDb();
  const mockSandbox = createMockStreamSandbox({
    throwAlreadyRunning: true,
    processRunning: false,
  });
  const deps = {
    db,
    getActiveSandbox: () => mockSandbox,
  };

  await assert.rejects(
    async () => getComputerStreamUrlService("user-alpha", "seat-1", 101, deps),
    (err) => err instanceof ComputerNotRunningError && /VNC server process is not active/i.test(err.message),
  );
});

test("stream-url: rejects 'Stream is already running' when auth key cannot be retrieved", async () => {
  const db = createMockDb();
  const mockSandbox = createMockStreamSandbox({
    throwAlreadyRunning: true,
    processRunning: true,
    throwMissingAuthKey: true,
  });
  const deps = {
    db,
    getActiveSandbox: () => mockSandbox,
  };

  await assert.rejects(
    async () => getComputerStreamUrlService("user-alpha", "seat-1", 101, deps),
    (err) => err instanceof ComputerNotRunningError && /auth credentials cannot be retrieved/i.test(err.message),
  );
});

test("stream-url: propagates unrelated stream start errors", async () => {
  const db = createMockDb();
  const mockSandbox = createMockStreamSandbox({
    throwUnrelated: true,
  });
  const deps = {
    db,
    getActiveSandbox: () => mockSandbox,
  };

  await assert.rejects(
    async () => getComputerStreamUrlService("user-alpha", "seat-1", 101, deps),
    /E2B stream network timeout/,
  );
});

// ---------------------------------------------------------------------------
// Tests: Sandbox Reconnection (Issue 1)
// ---------------------------------------------------------------------------

test("reconnect: successfully reconnects when registry is empty and database identifies running sandbox", async () => {
  const db = createMockDb();
  let connectedId = null;
  let registered = false;
  const mockSandbox = createMockStreamSandbox();

  const deps = {
    db,
    getActiveSandbox: () => undefined, // registry cache miss!
    connectSandbox: async (id) => {
      connectedId = id;
      return mockSandbox;
    },
    registerActiveSandbox: (campId, agentId, sbx) => {
      registered = true;
    },
  };

  const reconnected = await reconnectSandboxService("user-alpha", 101, "seat-1", deps);
  assert.equal(connectedId, "sbx-alpha-research");
  assert.equal(registered, true);
  assert.ok(reconnected.stream);
});

test("reconnect: rejects reconnection if computer is not running in database", async () => {
  const db = createMockDb();
  const deps = {
    db,
    getActiveSandbox: () => undefined,
    connectSandbox: async () => createMockStreamSandbox(),
  };

  // seat-mvj4q0fn is stopped
  await assert.rejects(
    async () => reconnectSandboxService("user-alpha", 101, "seat-mvj4q0fn", deps),
    (err) => err instanceof ComputerNotRunningError && /not in a running state/i.test(err.message),
  );
});

test("reconnect: updates database to error and clears sandboxId if E2B connect fails", async () => {
  const db = createMockDb();
  const deps = {
    db,
    getActiveSandbox: () => undefined,
    connectSandbox: async () => {
      throw new Error("Sandbox not found in E2B cloud");
    },
  };

  await assert.rejects(
    async () => reconnectSandboxService("user-alpha", 101, "seat-1", deps),
    (err) => err instanceof ComputerNotRunningError && /Sandbox not found in E2B cloud/i.test(err.message),
  );

  const comp = await db.findComputer("user-alpha", 101, "seat-1");
  assert.equal(comp?.status, "error");
  assert.equal(comp?.sandboxId, null);
  assert.match(comp?.error ?? "", /Sandbox reconnection failed/);
});

test("reconnect: stream-url endpoint automatically reconnects when in-memory registry misses", async () => {
  const db = createMockDb();
  let connectCalled = false;
  const mockSandbox = createMockStreamSandbox();

  const deps = {
    db,
    getActiveSandbox: () => undefined, // cache miss
    connectSandbox: async (id) => {
      connectCalled = true;
      return mockSandbox;
    },
    registerActiveSandbox: () => {},
  };

  const streamInfo = await getComputerStreamUrlService("user-alpha", "seat-1", 101, deps);
  assert.equal(connectCalled, true);
  assert.equal(streamInfo.controlMode, "agent");
  assert.match(streamInfo.streamUrl, /mock-auth-token-123456/);
});

// ---------------------------------------------------------------------------
// Tests: Human Takeover & Safe Handback (Issue 2)
// ---------------------------------------------------------------------------

test("human takeover: atomically transitions control to human and pauses active task", async () => {
  const db = createMockDb();
  const res = await takeoverComputerService("user-alpha", "seat-1", 101, { db });
  assert.equal(res.success, true);
  assert.equal(res.controlMode, "human");

  // Verify DB state
  const comp = await db.findComputer("user-alpha", 101, "seat-1");
  assert.equal(comp?.controlMode, "human");

  const activeTask = db.state.activeTasks.find((t) => t.computerId === 1);
  assert.equal(activeTask?.status, "waiting_for_user");
  assert.equal(activeTask?.waitingReason, "Human takeover active");

  // Verify server-side agent action blocker triggers immediately
  assert.throws(
    () => assertComputerActionAllowed(comp.controlMode, "active"),
    HumanTakeoverActiveError,
  );
});

test("human takeover: rejects takeover on ended campaign", async () => {
  const db = createMockDb();
  await assert.rejects(
    async () => takeoverComputerService("user-alpha", "seat-1", 103, { db }),
    CampaignEndedAbortError,
  );
});

test("human handback: successfully resumes active task when campaign is active, sandbox is usable, and lease is valid", async () => {
  const db = createMockDb();
  await takeoverComputerService("user-alpha", "seat-1", 101, { db });

  const mockSandbox = createMockStreamSandbox();
  const deps = {
    db,
    getActiveSandbox: () => mockSandbox,
  };

  const res = await handbackComputerService("user-alpha", "seat-1", 101, deps);
  assert.equal(res.success, true);
  assert.equal(res.controlMode, "agent");
  assert.equal(res.taskResumed, true);

  const comp = await db.findComputer("user-alpha", 101, "seat-1");
  assert.equal(comp?.controlMode, "agent");

  const activeTask = db.state.activeTasks.find((t) => t.computerId === 1);
  assert.equal(activeTask?.status, "active");
  assert.equal(activeTask?.waitingReason, null);

  assert.doesNotThrow(() => assertComputerActionAllowed(comp.controlMode, "active"));
});

test("human handback: does not resume task if execution lease is expired, routes task to recovery", async () => {
  const db = createMockDb();
  // Set computer activeTaskId to 502 (which has an expired lease)
  const comp = await db.findComputer("user-alpha", 101, "seat-1");
  comp.activeTaskId = 502;
  await takeoverComputerService("user-alpha", "seat-1", 101, { db });

  const mockSandbox = createMockStreamSandbox();
  const deps = {
    db,
    getActiveSandbox: () => mockSandbox,
    now: () => new Date(), // current time is after lease expiration
  };

  const res = await handbackComputerService("user-alpha", "seat-1", 101, deps);
  assert.equal(res.success, true);
  assert.equal(res.controlMode, "agent");
  assert.equal(res.taskResumed, false);
  assert.equal(res.recoveryNeeded, true);
  assert.equal(res.reason, "lease_expired");

  // Verify task was routed to recovery
  assert.ok(db.state.recoveredTasks.includes(502));
  const recoveredTask = db.state.tasks.find((t) => t.id === 502);
  assert.equal(recoveredTask?.status, "queued");
  assert.equal(recoveredTask?.executionLeaseToken, null);

  // Verify computer task was marked failed
  const computerTask = db.state.activeTasks.find((t) => t.computerId === 1);
  assert.equal(computerTask?.status, "failed");
  assert.match(computerTask?.activityDescription ?? "", /lease expired/i);
});

test("human handback: does not resume task if sandbox is stopped or unreachable", async () => {
  const db = createMockDb();
  // Set computer status to stopped
  const comp = await db.findComputer("user-alpha", 101, "seat-1");
  comp.status = "stopped";
  comp.controlMode = "human";

  const deps = {
    db,
    getActiveSandbox: () => undefined,
  };

  const res = await handbackComputerService("user-alpha", "seat-1", 101, deps);
  assert.equal(res.success, true);
  assert.equal(res.controlMode, "agent");
  assert.equal(res.taskResumed, false);
  assert.equal(res.reason, "sandbox_not_running");

  const computerTask = db.state.activeTasks.find((t) => t.computerId === 1);
  assert.equal(computerTask?.status, "failed");
  assert.match(computerTask?.activityDescription ?? "", /Sandbox is stopped/i);
});

test("human handback: rejects handback on ended campaign", async () => {
  const db = createMockDb();
  await assert.rejects(
    async () => handbackComputerService("user-alpha", "seat-1", 103, { db }),
    CampaignEndedAbortError,
  );
});

test("human handback: repeated calls are safely idempotent", async () => {
  const db = createMockDb();
  // Already in agent mode
  const res = await handbackComputerService("user-alpha", "seat-1", 101, { db });
  assert.equal(res.success, true);
  assert.equal(res.alreadyHandedBack, true);
  assert.equal(res.taskResumed, false);
});

// ---------------------------------------------------------------------------
// Tests: Authorized Artifact Downloads & Path Traversal Prevention
// ---------------------------------------------------------------------------

test("artifact download: authorizes owner and returns verified bytes", async () => {
  const db = createMockDb();
  const mockFileBytes = new Uint8Array([1, 2, 3, 4, 5]);
  const deps = {
    db,
    readArtifactBytes: async () => mockFileBytes,
  };

  const artifact = await downloadArtifactService("user-alpha", 801, 101, deps);
  assert.equal(artifact.filename, "competitor_analysis.md");
  assert.equal(artifact.mimeType, "text/markdown");
  assert.equal(artifact.sizeBytes, 5);
  assert.deepEqual(artifact.bytes, mockFileBytes);
});

test("artifact download: blocks cross-campaign and cross-user downloads", async () => {
  const db = createMockDb();
  // user-alpha tries to download user-bravo's artifact 804
  await assert.rejects(
    async () => downloadArtifactService("user-alpha", 804, 101, { db }),
    ArtifactNotFoundError,
  );
});

test("artifact download: blocks unverified or zero-byte artifacts", async () => {
  const db = createMockDb();
  // artifact 802 is unverified
  await assert.rejects(
    async () => downloadArtifactService("user-alpha", 802, 101, { db }),
    ArtifactUnverifiedError,
  );
});

test("artifact download: blocks directory traversal in artifact path", async () => {
  const db = createMockDb();
  // artifact 803 has path /home/user/../../etc/shadow
  await assert.rejects(
    async () => downloadArtifactService("user-alpha", 803, 101, { db }),
    InvalidPathAccessError,
  );
});

// ---------------------------------------------------------------------------
// Tests: Idempotent Campaign Termination & Safe Partial Failures
// ---------------------------------------------------------------------------

test("campaign end: terminates computers, fences active tasks, and kills microVMs", async () => {
  const db = createMockDb();
  let killed = false;
  const mockSandbox = {
    async kill() {
      killed = true;
    },
  };
  const deps = {
    db,
    getAllActiveSandboxesForCampaign: () => [{ agentId: "seat-1", sandbox: mockSandbox }],
    removeActiveSandbox: () => mockSandbox,
  };

  const res = await endCampaignService("user-alpha", 101, deps);
  assert.equal(res.success, true);
  assert.equal(res.status, "ended");
  assert.equal(res.terminatedComputersCount, 2);
  assert.equal(res.cancelledTasksCount, 3);
  assert.equal(res.killedSandboxesCount, 1);
  assert.equal(killed, true);
});

test("campaign end: repeated calls are safely idempotent", async () => {
  const db = createMockDb();
  // Campaign 103 is already ended
  const res = await endCampaignService("user-alpha", 103, { db });
  assert.equal(res.success, true);
  assert.equal(res.alreadyEnded, true);
  assert.equal(res.status, "ended");
});

test("campaign end: handles partial E2B sandbox kill failure truthfully", async () => {
  const db = createMockDb();
  const mockFailingSandbox = createMockStreamSandbox({ failKill: true });
  const deps = {
    db,
    getAllActiveSandboxesForCampaign: () => [{ agentId: "seat-1", sandbox: mockFailingSandbox }],
    removeActiveSandbox: () => mockFailingSandbox,
  };

  const res = await endCampaignService("user-alpha", 101, deps);
  assert.equal(res.success, true);
  assert.equal(res.status, "ended");
  assert.equal(res.killedSandboxesCount, 0);
  assert.ok(res.sandboxErrors && res.sandboxErrors.length === 1);
  assert.match(res.sandboxErrors[0].error, /E2B MicroVM termination timeout/);
});

// ---------------------------------------------------------------------------
// 3-Minute Idle Sweep Tests
// ---------------------------------------------------------------------------

test("sweep idle: pauses computers genuinely inactive >= 3 minutes and captures screenshot", async () => {
  const baseTime = new Date("2026-10-29T12:00:00Z");
  const idleTime = new Date("2026-10-29T11:55:00Z"); // 5 minutes ago (> 3 min)

  let screenshotTaken = false;
  const mockSandbox = {
    async takeScreenshot() {
      screenshotTaken = true;
      return Buffer.from("fake-png-bytes");
    },
  };

  const db = createMockDb({
    computers: [
      {
        id: 10,
        authUserId: "user-alpha",
        campaignId: 101,
        agentId: "seat-1",
        sandboxId: "sbx-idle-1",
        status: "running",
        controlMode: "agent",
        activeTaskId: null,
        lastActiveAt: idleTime,
      },
    ],
  });

  const res = await sweepIdleComputersService({
    db,
    now: () => baseTime,
    getActiveSandbox: () => mockSandbox,
  });

  assert.equal(res.examinedCount, 1);
  assert.equal(res.pausedCount, 1);
  assert.equal(screenshotTaken, true);

  const comp = db.state.computers.find((c) => c.id === 10);
  assert.equal(comp?.status, "paused");
  assert.equal(comp?.pausedAt?.toISOString(), baseTime.toISOString());
  assert.equal(comp?.lastScreenshotBase64, Buffer.from("fake-png-bytes").toString("base64"));
});

test("sweep idle: does not pause computer if inactive for < 3 minutes", async () => {
  const baseTime = new Date("2026-10-29T12:00:00Z");
  const recentTime = new Date("2026-10-29T11:58:30Z"); // 90 seconds ago (< 3 min)

  const db = createMockDb({
    computers: [
      {
        id: 11,
        authUserId: "user-alpha",
        campaignId: 101,
        agentId: "seat-1",
        sandboxId: "sbx-active-1",
        status: "running",
        controlMode: "agent",
        activeTaskId: null,
        lastActiveAt: recentTime,
      },
    ],
  });

  const res = await sweepIdleComputersService({
    db,
    now: () => baseTime,
  });

  assert.equal(res.examinedCount, 0);
  assert.equal(res.pausedCount, 0);
  const comp = db.state.computers.find((c) => c.id === 11);
  assert.equal(comp?.status, "running");
});

test("sweep idle: does not pause computers with active tasks or under human takeover", async () => {
  const baseTime = new Date("2026-10-29T12:00:00Z");
  const idleTime = new Date("2026-10-29T11:50:00Z"); // 10 minutes ago

  const db = createMockDb({
    computers: [
      {
        id: 12,
        authUserId: "user-alpha",
        campaignId: 101,
        agentId: "seat-1",
        sandboxId: "sbx-task-1",
        status: "running",
        controlMode: "agent",
        activeTaskId: 777, // Active task protected
        lastActiveAt: idleTime,
      },
      {
        id: 13,
        authUserId: "user-alpha",
        campaignId: 101,
        agentId: "seat-mvj4q0fn",
        sandboxId: "sbx-human-1",
        status: "running",
        controlMode: "human", // Human takeover protected
        activeTaskId: null,
        lastActiveAt: idleTime,
      },
    ],
  });

  const res = await sweepIdleComputersService({
    db,
    now: () => baseTime,
  });

  assert.equal(res.examinedCount, 0);
  assert.equal(res.pausedCount, 0);
  assert.equal(db.state.computers.find((c) => c.id === 12)?.status, "running");
  assert.equal(db.state.computers.find((c) => c.id === 13)?.status, "running");
});

test("sweep idle: repeated sweeps are safely idempotent", async () => {
  const baseTime = new Date("2026-10-29T12:00:00Z");
  const idleTime = new Date("2026-10-29T11:50:00Z");

  const db = createMockDb({
    computers: [
      {
        id: 14,
        authUserId: "user-alpha",
        campaignId: 101,
        agentId: "seat-1",
        sandboxId: "sbx-idle-2",
        status: "running",
        controlMode: "agent",
        activeTaskId: null,
        lastActiveAt: idleTime,
      },
    ],
  });

  const res1 = await sweepIdleComputersService({ db, now: () => baseTime });
  assert.equal(res1.pausedCount, 1);

  // Second sweep: already paused, should examine 0 and pause 0
  const res2 = await sweepIdleComputersService({ db, now: () => baseTime });
  assert.equal(res2.examinedCount, 0);
  assert.equal(res2.pausedCount, 0);
});

test("sweep idle: missing or dead sandbox still pauses computer without crashing", async () => {
  const baseTime = new Date("2026-10-29T12:00:00Z");
  const idleTime = new Date("2026-10-29T11:50:00Z");

  const db = createMockDb({
    computers: [
      {
        id: 15,
        authUserId: "user-alpha",
        campaignId: 101,
        agentId: "seat-1",
        sandboxId: "sbx-dead",
        status: "running",
        controlMode: "agent",
        activeTaskId: null,
        lastActiveAt: idleTime,
      },
    ],
  });

  const res = await sweepIdleComputersService({
    db,
    now: () => baseTime,
    getActiveSandbox: () => null,
  });

  assert.equal(res.examinedCount, 1);
  assert.equal(res.pausedCount, 1);
  assert.equal(db.state.computers.find((c) => c.id === 15)?.status, "paused");
});

// ---------------------------------------------------------------------------
// 24-Hour Waiting Task Expiration Tests
// ---------------------------------------------------------------------------

test("sweep waiting tasks: expires tasks waiting > 24 hours and updates state truthfully", async () => {
  const baseTime = new Date("2026-10-29T12:00:00Z");
  const expiredTime = new Date("2026-10-28T11:00:00Z"); // 25 hours ago (> 24h)

  const db = createMockDb({
    computers: [
      {
        id: 20,
        authUserId: "user-alpha",
        campaignId: 101,
        agentId: "seat-1",
        status: "running",
        controlMode: "human",
        activeTaskId: 901,
      },
    ],
    activeTasks: [
      {
        id: 301,
        taskId: 901,
        computerId: 20,
        status: "waiting_for_user",
        waitingSince: expiredTime,
      },
    ],
    tasks: [
      {
        id: 901,
        status: "running",
        executionLeaseToken: "lease-901",
        executionLeaseExpiresAt: new Date(Date.now() + 60_000),
      },
    ],
  });

  const res = await sweepStaleWaitingTasksService({
    db,
    now: () => baseTime,
  });

  assert.equal(res.examinedCount, 1);
  assert.equal(res.expiredCount, 1);

  // Verify active task transitioned to failed
  const activeTask = db.state.activeTasks.find((t) => t.id === 301);
  assert.equal(activeTask?.status, "failed");
  assert.match(activeTask?.activityDescription || "", /24 hours/);

  // Verify primary task failed and lease revoked
  const primaryTask = db.state.tasks.find((t) => t.id === 901);
  assert.equal(primaryTask?.status, "failed");
  assert.equal(primaryTask?.executionLeaseToken, null);

  // Verify computer active task cleared and control mode reset to agent
  const comp = db.state.computers.find((c) => c.id === 20);
  assert.equal(comp?.activeTaskId, null);
  assert.equal(comp?.controlMode, "agent");
});

test("sweep waiting tasks: ignores tasks waiting < 24 hours", async () => {
  const baseTime = new Date("2026-10-29T12:00:00Z");
  const recentTime = new Date("2026-10-29T02:00:00Z"); // 10 hours ago (< 24h)

  const db = createMockDb({
    activeTasks: [
      {
        id: 302,
        taskId: 902,
        computerId: 21,
        status: "waiting_for_user",
        waitingSince: recentTime,
      },
    ],
    tasks: [{ id: 902, status: "running" }],
  });

  const res = await sweepStaleWaitingTasksService({
    db,
    now: () => baseTime,
  });

  assert.equal(res.examinedCount, 0);
  assert.equal(res.expiredCount, 0);
  assert.equal(db.state.activeTasks.find((t) => t.id === 302)?.status, "waiting_for_user");
});

test("sweep waiting tasks: expired task cannot be resumed via handback", async () => {
  const baseTime = new Date("2026-10-29T12:00:00Z");
  const expiredTime = new Date("2026-10-28T10:00:00Z");

  const db = createMockDb({
    computers: [
      {
        id: 22,
        authUserId: "user-alpha",
        campaignId: 101,
        agentId: "seat-1",
        sandboxId: "sbx-exp-handback",
        status: "running",
        controlMode: "human",
        activeTaskId: 903,
      },
    ],
    activeTasks: [
      {
        id: 303,
        taskId: 903,
        computerId: 22,
        status: "waiting_for_user",
        waitingSince: expiredTime,
      },
    ],
    tasks: [{ id: 903, status: "running" }],
  });

  // 1. Run sweep to expire the task
  await sweepStaleWaitingTasksService({ db, now: () => baseTime });

  // 2. User later triggers handback
  const mockSandbox = createMockStreamSandbox();
  const handbackRes = await handbackComputerService("user-alpha", "seat-1", 101, {
    db,
    getActiveSandbox: () => mockSandbox,
    now: () => new Date("2026-10-29T14:00:00Z"),
  });

  assert.equal(handbackRes.success, true);
  assert.equal(handbackRes.taskResumed, false);
  assert.equal(handbackRes.alreadyHandedBack, true);
});

test("sweep waiting tasks: expired task with lingering activeTaskId returns task_failed on handback", async () => {
  const db = createMockDb({
    computers: [
      {
        id: 23,
        authUserId: "user-alpha",
        campaignId: 101,
        agentId: "seat-1",
        sandboxId: "sbx-exp-lingering",
        status: "running",
        controlMode: "human",
        activeTaskId: 904, // activeTaskId still points to task 904
      },
    ],
    tasks: [{ id: 904, status: "failed" }],
  });

  const mockSandbox = createMockStreamSandbox();
  const handbackRes = await handbackComputerService("user-alpha", "seat-1", 101, {
    db,
    getActiveSandbox: () => mockSandbox,
    now: () => new Date("2026-10-29T14:00:00Z"),
  });

  assert.equal(handbackRes.success, true);
  assert.equal(handbackRes.taskResumed, false);
  assert.equal(handbackRes.reason, "task_failed");
});

test("manual start/stop: starting an eligible computer transitions state to running", async () => {
  const db = createMockDb();
  let registeredSandbox = null;

  const res = await startComputerService("user-alpha", "seat-1", 101, {
    db,
    getActiveSandbox: () => registeredSandbox,
    registerActiveSandbox: (_campId, _agentId, sbx) => {
      registeredSandbox = sbx;
    },
    connectSandbox: async (id) => ({
      sandboxId: id,
      stream: {
        async start() {},
        async checkVNCRunning() { return true; },
        getAuthKey() { return "key"; },
        getUrl() { return "https://mock.e2b.dev/stream"; },
      },
      commands: { async run() { return { stdout: "", stderr: "", exitCode: 0 }; } },
      async kill() {},
    }),
  });

  assert.equal(res.ok, true);
  assert.equal(res.agentId, "seat-1");
  assert.equal(res.status, "running");
  assert.ok(res.sandboxId);

  const computer = await db.findComputer("user-alpha", 101, "seat-1");
  assert.equal(computer.status, "running");
});

test("manual start/stop: starting an ineligible specialist throws IneligibleAgentComputerError", async () => {
  const db = createMockDb();

  await assert.rejects(
    async () => {
      await startComputerService("user-alpha", "seat-mvj4q1b7", 101, { db });
    },
    IneligibleAgentComputerError,
  );

  await assert.rejects(
    async () => {
      await startComputerService("user-alpha", "seat-mvj4q1mo", 101, { db });
    },
    IneligibleAgentComputerError,
  );
});

test("manual start/stop: stopping an active computer transitions state to stopped and kills sandbox", async () => {
  const db = createMockDb();
  let killed = false;
  const mockSandbox = {
    sandboxId: "sbx-to-kill",
    async kill() {
      killed = true;
    },
    async screenshot() {
      return new Uint8Array([1, 2, 3]);
    },
  };

  const res = await stopComputerService("user-alpha", "seat-1", 101, {
    db,
    getActiveSandbox: () => mockSandbox,
  });

  assert.equal(res.ok, true);
  assert.equal(killed, true);

  const computer = await db.findComputer("user-alpha", 101, "seat-1");
  assert.equal(computer.status, "stopped");
});

test("manual start/stop: starting computer on ended campaign throws CampaignEndedAbortError", async () => {
  const db = createMockDb();

  await assert.rejects(
    async () => {
      await startComputerService("user-alpha", "seat-1", 103, { db });
    },
    CampaignEndedAbortError,
  );
});


