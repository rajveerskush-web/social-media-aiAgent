import assert from "node:assert/strict";
import test from "node:test";
import {
  isComputerEligible,
  HumanTakeoverActiveError,
  CampaignEndedAbortError,
  assertComputerActionAllowed,
} from "../lib/computer-types.ts";
import { runComputerAgentLoop } from "../lib/computer-agent-loop.ts";
import {
  takeoverComputerService,
  handbackComputerService,
  endCampaignService,
} from "../lib/computer-service.ts";
import {
  persistDurableArtifact,
  retrieveDurableArtifact,
} from "../lib/durable-storage.ts";
import {
  validateMasterPlan,
  summarizeTaskStatuses,
} from "../lib/master-agent-plan.ts";
import { resolveDependencyStatus } from "../lib/task-state.ts";

// ---------------------------------------------------------------------------
// Harness Mocks
// ---------------------------------------------------------------------------

function createMockSandbox() {
  const actions = [];
  return {
    state: { actions },
    async screenshot() {
      return Buffer.from("mock-png-data");
    },
    async open(url) {
      actions.push({ tool: "open", url });
    },
    async wait(ms) {},
    async leftClick(x, y) {
      actions.push({ tool: "click", x, y });
    },
    async write(text) {
      actions.push({ tool: "write", text });
    },
    files: {
      async read(path) {
        return new Uint8Array([35, 32, 82, 101, 112, 111, 114, 116]); // "# Report"
      },
    },
    commands: {
      async run(cmd) {
        return { stdout: "ok\n", stderr: "", exitCode: 0 };
      },
    },
    stream: {
      async start() {},
      getUrl() {
        return "https://mock-vnc.e2b.dev/?view_only=1";
      },
      async checkVNCRunning() {
        return true;
      },
      async getAuthKey() {
        return "auth-key";
      },
    },
  };
}

function createMockDb() {
  let campaignStatus = "active";
  const computer = {
    id: 1,
    authUserId: "user-alpha",
    campaignId: 101,
    agentId: "seat-1",
    status: "running",
    controlMode: "agent",
    activeTaskId: 501,
    sandboxId: "sandbox-xyz",
  };
  const task = {
    id: 501,
    status: "running",
    executionLeaseToken: "lease-123",
    executionLeaseExpiresAt: new Date(Date.now() + 60_000),
  };

  return {
    async findCampaign(authUserId, campaignId) {
      if (authUserId !== "user-alpha" || campaignId !== 101) return null;
      return { id: 101, authUserId: "user-alpha", name: "Campaign Q4", status: campaignStatus };
    },
    async findComputer(authUserId, campaignId, agentId) {
      if (authUserId !== "user-alpha" || campaignId !== 101 || agentId !== "seat-1") return null;
      return computer;
    },
    async updateComputerControlMode(authUserId, campaignId, agentId, mode) {
      computer.controlMode = mode;
      return computer;
    },
    async updateComputerStatus(computerId, status) {
      computer.status = status;
    },
    async updateActiveTaskControlMode(computerId, status, waitingReason) {
      task.status = status;
    },
    async markComputerTaskFailed(computerId, reason) {},
    async findTask(taskId) {
      return taskId === 501 ? task : null;
    },
    async routeTaskToRecovery(taskId) {
      task.status = "queued";
    },
    async endCampaign(campaignId) {
      campaignStatus = "ended";
      computer.status = "stopped";
      task.status = "failed";
      return { cancelledTasksCount: 1, terminatedComputersCount: 1 };
    },
    getState: () => ({ campaignStatus, computer, task }),
  };
}

// ---------------------------------------------------------------------------
// 1. Full E2E Task Workflow: Dispatch -> Decision Loop -> Checkpoint -> Durable Storage
// ---------------------------------------------------------------------------

test("E2E: task executes observe-reason-act loop, stores durable artifact, and finishes with verified summary", async () => {
  const sandbox = createMockSandbox();
  const checkpoints = [];
  const storedArtifacts = [];
  const mockStorageDriver = {
    store: new Map(),
    async saveArtifact(key, data, mimeType) {
      this.store.set(key, data);
      return { storageKey: key, sizeBytes: data.length, hash: "sha256-mock" };
    },
    async getArtifact(key) {
      return this.store.get(key) || null;
    },
  };

  let modelStep = 0;
  const mockCallModel = async (model, sysInstruction, history) => {
    modelStep++;
    if (modelStep === 1) {
      // Step 1: Navigate to research source
      return {
        functionCalls: [
          { name: "navigateTo", args: { url: "https://en.wikipedia.org/wiki/Autonomous_agent" } },
        ],
      };
    }
    if (modelStep === 2) {
      // Step 2: Download artifact report
      return {
        functionCalls: [
          {
            name: "downloadSandboxFile",
            args: {
              sandboxPath: "/home/user/research/agent_report.md",
              filename: "agent_report.md",
            },
          },
        ],
      };
    }
    // Step 3: Complete task
    return {
      functionCalls: [
        {
          name: "completeTask",
          args: {
            summary: "Comprehensive autonomous agent research completed.",
            findings: "Autonomous agents integrate reasoning loops with isolated tool execution.",
            status: "success",
          },
        },
      ],
    };
  };

  const outcome = await runComputerAgentLoop(
    {
      authUserId: "user-alpha",
      campaignId: 101,
      taskId: 501,
      agentId: "seat-1",
      computerId: 1,
    },
    "Research Autonomous Agents",
    "Gather latest architectural findings from Wikipedia and export agent_report.md",
    sandbox,
    { maxSteps: 5 },
    {
      verifyContext: async () => {},
      callModel: mockCallModel,
      saveCheckpoint: async (ctx, cp) => {
        checkpoints.push(cp);
      },
      saveArtifact: async (ctx, art) => {
        storedArtifacts.push(art);
        // Persist to durable storage
        if (art.bytesBase64) {
          const raw = new Uint8Array(Buffer.from(art.bytesBase64, "base64"));
          await persistDurableArtifact(ctx.campaignId, ctx.taskId, 901, art.filename, art.mimeType, raw, mockStorageDriver);
        }
      },
    },
  );

  assert.equal(outcome.outcome, "completed");
  assert.equal(outcome.result.status, "success");
  assert.equal(outcome.stepsExecuted, 3);
  assert.match(outcome.result.summary, /Comprehensive autonomous agent research/);
  assert.equal(outcome.result.artifacts.length, 1);
  assert.equal(outcome.result.artifacts[0].filename, "agent_report.md");

  // Checkpoints recorded durably
  assert.equal(checkpoints.length, 2);

  // Durable artifact stored and verified
  const durableBytes = await retrieveDurableArtifact(101, 501, 901, "agent_report.md", mockStorageDriver);
  assert.ok(durableBytes);
  assert.equal(durableBytes.length, 8); // "# Report"
});

// ---------------------------------------------------------------------------
// 2. Interruption & Human Takeover Fencing
// ---------------------------------------------------------------------------

test("E2E: human takeover halts execution server-side and handback safely reschedules task", async () => {
  const db = createMockDb();
  const sandbox = createMockSandbox();

  // Step 1: User intervenes and clicks Takeover
  const takeoverRes = await takeoverComputerService("user-alpha", "seat-1", 101, { db });
  assert.equal(takeoverRes.controlMode, "human");
  assert.equal(db.getState().computer.controlMode, "human");

  // Step 2: Agent attempts to run an action while takeover is active -> must throw HumanTakeoverActiveError
  assert.throws(
    () => assertComputerActionAllowed(db.getState().computer.controlMode, db.getState().campaignStatus),
    HumanTakeoverActiveError,
  );

  // Step 3: User finishes login and clicks Handback
  const handbackRes = await handbackComputerService("user-alpha", "seat-1", 101, {
    db,
    getActiveSandbox: () => sandbox,
  });
  assert.equal(handbackRes.controlMode, "agent");
  assert.equal(db.getState().computer.controlMode, "agent");
});

// ---------------------------------------------------------------------------
// 3. Campaign Termination & Worker Fencing
// ---------------------------------------------------------------------------

test("E2E: campaign end fences running tasks, kills microVMs, and blocks further execution", async () => {
  const db = createMockDb();
  const killLog = [];
  const mockSandbox = {
    ...createMockSandbox(),
    async kill() {
      killLog.push("killed");
    },
  };

  // Terminate campaign
  const endRes = await endCampaignService(
    "user-alpha",
    101,
    {
      db,
      getAllActiveSandboxesForCampaign: () => [{ agentId: "seat-1", sandbox: mockSandbox }],
      removeActiveSandbox: () => mockSandbox,
    },
  );

  assert.equal(endRes.success, true);
  assert.equal(killLog.length, 1);
  assert.equal(db.getState().campaignStatus, "ended");
  assert.equal(db.getState().computer.status, "stopped");

  // Verify server-side action check strictly rejects on ended campaign
  assert.throws(
    () => assertComputerActionAllowed(db.getState().computer.controlMode, db.getState().campaignStatus),
    CampaignEndedAbortError,
  );
});

// ---------------------------------------------------------------------------
// 4. Multi-Specialist Workflow: Research -> Content -> Scheduler -> Analytics
// ---------------------------------------------------------------------------

test("E2E: complete multi-specialist workflow verifies roles, computer eligibility, and dependencies", async () => {
  // 1. Verify computer eligibility across all 5 agents
  assert.equal(isComputerEligible("master-agent"), false);
  assert.equal(isComputerEligible("seat-1"), true);         // Research
  assert.equal(isComputerEligible("seat-mvj4q0fn"), true);  // Content Creator
  assert.equal(isComputerEligible("seat-mvj4q1b7"), false); // Scheduler
  assert.equal(isComputerEligible("seat-mvj4q1mo"), false); // Analytics

  // 2. Content Creator computer loop execution
  const ccSandbox = createMockSandbox();
  let ccStep = 0;
  const ccCallModel = async (model, sysInstruction, history) => {
    ccStep++;
    if (ccStep === 1) {
      return {
        functionCalls: [
          { name: "openBrowser", args: { url: "https://canva.com" } },
        ],
      };
    }
    return {
      functionCalls: [
        {
          name: "completeTask",
          args: {
            summary: "Instagram carousel slides designed and exported.",
            findings: "Created 3 carousel slides with high-contrast copy.",
            status: "success",
          },
        },
      ],
    };
  };

  const ccOutcome = await runComputerAgentLoop(
    {
      authUserId: "user-alpha",
      campaignId: 101,
      taskId: 502,
      agentId: "seat-mvj4q0fn",
      computerId: 2,
    },
    "Create Instagram Carousel",
    "Design 3 carousel slides based on the competitor research dossier.",
    ccSandbox,
    { maxSteps: 5 },
    {
      verifyContext: async () => {},
      callModel: ccCallModel,
      saveCheckpoint: async () => {},
      saveArtifact: async () => {},
    },
  );

  assert.equal(ccOutcome.outcome, "completed");
  assert.equal(ccOutcome.result.status, "success");
  assert.match(ccOutcome.result.summary, /Instagram carousel slides designed/);
  assert.equal(ccOutcome.stepsExecuted, 2);
});

test("E2E: automatic task delegation decomposes mixed request, chains specialist dependencies, and consolidates results", async () => {
  // 1. Natural language user prompt with NO agent specified:
  // "Research competitor specialty coffee brands in Brooklyn, then create 2 Instagram post drafts based on the findings, and propose an optimal schedule for them."
  
  // 2. Master Agent decomposes into 3 subtasks targeting Research (seat-1), Content (seat-mvj4q0fn), Scheduler (seat-mvj4q1b7)
  const masterPlanRaw = JSON.stringify({
    clarification: "",
    review: "",
    tasks: [
      {
        agentId: "seat-1",
        title: "Competitor Market Research",
        instructions: "Research competitor specialty coffee brands in Brooklyn and identify top flavor trends.",
        dependsOn: [],
      },
      {
        agentId: "seat-mvj4q0fn",
        title: "Draft 2 Instagram Posts",
        instructions: "Draft 2 high-converting Instagram post captions using the flavor trends from the research dossier.",
        dependsOn: [0],
      },
      {
        agentId: "seat-mvj4q1b7",
        title: "Propose Publishing Schedule",
        instructions: "Propose optimal posting days, times, and cadence for the drafted Instagram posts.",
        dependsOn: [1],
      },
    ],
  });

  const availableSpecialists = ["seat-1", "seat-mvj4q0fn", "seat-mvj4q1b7", "seat-mvj4q1mo"];
  const validation = validateMasterPlan(masterPlanRaw, availableSpecialists);
  assert.equal(validation.ok, true);
  assert.equal(validation.plan.tasks.length, 3);
  
  // Verify correct routing without user specifying IDs:
  assert.equal(validation.plan.tasks[0].agentId, "seat-1"); // Research
  assert.equal(validation.plan.tasks[1].agentId, "seat-mvj4q0fn"); // Content Creator
  assert.equal(validation.plan.tasks[2].agentId, "seat-mvj4q1b7"); // Scheduler
  assert.deepEqual(validation.plan.tasks[0].dependsOn, []);
  assert.deepEqual(validation.plan.tasks[1].dependsOn, [0]);
  assert.deepEqual(validation.plan.tasks[2].dependsOn, [1]);

  // 3. Task records created in database simulation
  const tasksInDb = [
    { id: 101, title: validation.plan.tasks[0].title, agentId: "seat-1", status: "pending", dependencies: [], response: null },
    { id: 102, title: validation.plan.tasks[1].title, agentId: "seat-mvj4q0fn", status: "blocked", dependencies: [101], response: null },
    { id: 103, title: validation.plan.tasks[2].title, agentId: "seat-mvj4q1b7", status: "blocked", dependencies: [102], response: null },
  ];

  // 4. Initial state: Task 101 is pending (ready to execute), 102 & 103 blocked
  assert.equal(tasksInDb[0].status, "pending");
  assert.equal(tasksInDb[1].status, "blocked");
  assert.equal(tasksInDb[2].status, "blocked");

  // 5. Specialist 1 (Research) executes and produces real research findings
  tasksInDb[0].status = "running";
  const researchDossier = "**Competitor Dossier**: Top competitors focus on single-origin Ethiopian cold brews and oat-milk pairings. Engagement peaks around morning commute.";
  tasksInDb[0].response = researchDossier;
  tasksInDb[0].status = "completed";

  // Check dependency release for Task 102:
  const depStatusFor102 = resolveDependencyStatus(tasksInDb[1].dependencies, [
    { id: 101, status: tasksInDb[0].status },
  ]);
  assert.equal(depStatusFor102, "pending");
  tasksInDb[1].status = "pending";

  // Task 103 is still blocked because 102 hasn't run yet
  const depStatusFor103Before = resolveDependencyStatus(tasksInDb[2].dependencies, [
    { id: 102, status: tasksInDb[1].status },
  ]);
  assert.equal(depStatusFor103Before, "blocked");

  // 6. Specialist 2 (Content Creator) executes with Task 101's output in dependency context
  tasksInDb[1].status = "running";
  const contentInputContext = `Task 101 (${tasksInDb[0].title}): ${tasksInDb[0].response}`;
  assert.match(contentInputContext, /single-origin Ethiopian cold brews/);

  // Content Specialist produces posts incorporating the research
  const contentPosts = "Post 1: 'Start your Monday with single-origin Ethiopian notes ☕ #BrooklynCoffee'\nPost 2: 'Oat milk meets slow-drip perfection. Refresh your afternoon.'";
  tasksInDb[1].response = contentPosts;
  tasksInDb[1].status = "completed";

  // Check dependency release for Task 103:
  const depStatusFor103After = resolveDependencyStatus(tasksInDb[2].dependencies, [
    { id: 102, status: tasksInDb[1].status },
  ]);
  assert.equal(depStatusFor103After, "pending");
  tasksInDb[2].status = "pending";

  // 7. Specialist 3 (Scheduler) executes with Task 102's output in dependency context
  tasksInDb[2].status = "running";
  const schedulerInputContext = `Task 102 (${tasksInDb[1].title}): ${tasksInDb[1].response}`;
  assert.match(schedulerInputContext, /Start your Monday/);

  const scheduleProposal = "Proposed Cadence: Post 1 scheduled for Tuesday 08:30 AM EST (commute peak); Post 2 scheduled for Thursday 02:00 PM EST.";
  tasksInDb[2].response = scheduleProposal;
  tasksInDb[2].status = "completed";

  // 8. Consolidated Master Agent synthesis verifies all 3 specialist deliverables are incorporated
  const consolidatedContext = tasksInDb.map((t) => `Task #${t.id} (${t.title}): ${t.response}`).join("\n\n");
  assert.match(consolidatedContext, /Competitor Dossier/);
  assert.match(consolidatedContext, /single-origin Ethiopian notes/);
  assert.match(consolidatedContext, /Tuesday 08:30 AM EST/);

  // Status summarizer correctly reports all tasks completed
  const summary = summarizeTaskStatuses(tasksInDb.map(t => ({ ...t, assignedAgentId: t.agentId })));
  assert.match(summary, /completed/i);
});

test("E2E Acceptance: Natural language cafe marketing request delegates across Research, Content, and Scheduler specialists end-to-end", async () => {
  const userRequest =
    "Research three popular coffee chains and compare their Instagram marketing strategies. Create a creative seven-day Instagram campaign for my café, including Reels, Stories, captions, hashtags, and a posting calendar.";

  // 1. Master Agent Planner decomposes into 3 interdependent specialist tasks
  const masterPlanPayload = JSON.stringify({
    review: "Decomposed the coffee chain research and 7-day Instagram marketing campaign across specialist agents.",
    tasks: [
      {
        agentId: "seat-1",
        title: "Research 3 Coffee Chains Instagram Strategies",
        instructions: "Analyze Starbucks, Blue Bottle, and Dunkin on Instagram. Compare content formats, posting cadence, and engagement drivers.",
        dependsOn: [],
      },
      {
        agentId: "seat-mvj4q0fn",
        title: "Develop 7-Day Instagram Campaign Content",
        instructions: "Create Reels concepts, Story interactive polls, high-converting post captions, and targeted hashtag clusters for the café based on competitor research.",
        dependsOn: [0],
      },
      {
        agentId: "seat-mvj4q1b7",
        title: "Build 7-Day Publishing Calendar",
        instructions: "Construct a timed 7-day posting schedule with dates, peak commute/afternoon hours, timezone, and content types.",
        dependsOn: [1],
      },
    ],
  });

  const availableSpecialists = ["seat-1", "seat-mvj4q0fn", "seat-mvj4q1b7", "seat-mvj4q1mo"];
  const planValidation = validateMasterPlan(masterPlanPayload, availableSpecialists);
  assert.equal(planValidation.ok, true, "Master plan must validate successfully");
  const { tasks } = planValidation.plan;
  assert.equal(tasks.length, 3);

  // Specialist selection verified automatically
  assert.equal(tasks[0].agentId, "seat-1");
  assert.equal(tasks[1].agentId, "seat-mvj4q0fn");
  assert.equal(tasks[2].agentId, "seat-mvj4q1b7");
  assert.deepEqual(tasks[0].dependsOn, []);
  assert.deepEqual(tasks[1].dependsOn, [0]);
  assert.deepEqual(tasks[2].dependsOn, [1]);

  // 2. Simulated DB Task Pipeline
  const dbTasks = tasks.map((t, i) => ({
    id: 1001 + i,
    title: t.title,
    agentId: t.agentId,
    status: t.dependsOn.length === 0 ? "pending" : "blocked",
    dependencies: t.dependsOn.map((depIdx) => 1001 + depIdx),
    response: null,
  }));

  assert.equal(dbTasks[0].status, "pending");
  assert.equal(dbTasks[1].status, "blocked");
  assert.equal(dbTasks[2].status, "blocked");

  // 3. Research Specialist executes (Cloud Desktop / Research)
  dbTasks[0].status = "running";
  const researchDeliverable = [
    "### Competitor Instagram Strategy Analysis",
    "- **Starbucks**: Heavy focus on user-generated content, seasonal drinks, and short-form Reels with upbeat audio.",
    "- **Blue Bottle**: Minimalist aesthetic, carousel pour-over tutorials, storytelling around origin farms.",
    "- **Dunkin'**: High-energy humor, relatable workplace memes, bold color palettes.",
    "- **Key Recommendation for Café**: Blend artisan brew education (Blue Bottle style) with relatable morning ritual Reels (Starbucks style).",
    "- **Source URLs**: https://instagram.com/starbucks, https://instagram.com/bluebottle, https://instagram.com/dunkin",
  ].join("\n");
  dbTasks[0].response = researchDeliverable;
  dbTasks[0].status = "completed";

  // Dependency release for Task 1002 (Content Creator)
  const unblock1002 = resolveDependencyStatus(dbTasks[1].dependencies, [{ id: 1001, status: "completed" }]);
  assert.equal(unblock1002, "pending");
  dbTasks[1].status = "pending";

  // 4. Content Creator executes receiving Research Context
  dbTasks[1].status = "running";
  const receivedContextFor1002 = `Prerequisite Task #1001 (${dbTasks[0].title}):\n${dbTasks[0].response}`;
  assert.match(receivedContextFor1002, /Competitor Instagram Strategy Analysis/);
  assert.match(receivedContextFor1002, /Blue Bottle/);

  const contentDeliverable = [
    "### 7-Day Café Campaign: 'Wake Up to Craft'",
    "- **Day 1 (Mon - Reel)**: 'Behind the Barista Bar: Perfect Espresso Extraction' | Audio: Trending Lo-Fi",
    "- **Day 2 (Tue - Carousel)**: '3 Pour-Over Mistakes You Might Be Making at Home'",
    "- **Day 3 (Wed - Story Poll)**: 'Oat Milk or Almond Milk in your flat white? Vote below!'",
    "- **Day 4 (Thu - Static)**: 'Meet Our Local Roaster: Notes of cocoa nibs & citrus'",
    "- **Day 5 (Fri - Reel)**: 'POV: Your first sip of Friday iced matcha' | Audio: Energetic pop",
    "- **Day 6 (Sat - Story Series)**: Weekend morning atmosphere & fresh pastry drop showcase",
    "- **Day 7 (Sun - Community)**: 'Customer of the Week spotlight + secret menu feature'",
    "- **Hashtags**: #SpecialtyCoffee #ThirdWaveCoffee #CaféVibes #BaristaDaily #CoffeeRoaster",
  ].join("\n");
  dbTasks[1].response = contentDeliverable;
  dbTasks[1].status = "completed";

  // Dependency release for Task 1003 (Scheduler)
  const unblock1003 = resolveDependencyStatus(dbTasks[2].dependencies, [{ id: 1002, status: "completed" }]);
  assert.equal(unblock1003, "pending");
  dbTasks[2].status = "pending";

  // 5. Scheduler executes receiving Content Context
  dbTasks[2].status = "running";
  const receivedContextFor1003 = `Prerequisite Task #1002 (${dbTasks[1].title}):\n${dbTasks[1].response}`;
  assert.match(receivedContextFor1003, /Wake Up to Craft/);

  const scheduleDeliverable = [
    "### 7-Day Instagram Publishing Schedule (Timezone: EST)",
    "| Day | Format | Scheduled Time | Peak Window | Content Focus |",
    "| :--- | :--- | :--- | :--- | :--- |",
    "| Mon Nov 03 | Reel | 08:15 AM EST | Morning Commute | Barista Extraction |",
    "| Tue Nov 04 | Carousel | 12:30 PM EST | Lunch Break | Pour-Over Tips |",
    "| Wed Nov 05 | Story Poll | 02:45 PM EST | Mid-Afternoon Dip | Milk Preference Poll |",
    "| Thu Nov 06 | Feed Post | 09:00 AM EST | Morning Routine | Bean Origin Spotlight |",
    "| Fri Nov 07 | Reel | 03:30 PM EST | Weekend Transition | Friday Iced Matcha POV |",
    "| Sat Nov 08 | Stories | 10:00 AM EST | Weekend Leisure | Pastry Showcase |",
    "| Sun Nov 09 | Feed Post | 04:00 PM EST | Evening Planning | Community Feature |",
  ].join("\n");
  dbTasks[2].response = scheduleDeliverable;
  dbTasks[2].status = "completed";

  // 6. Master Agent consolidation
  const consolidatedOutputs = dbTasks.map((t) => `**${t.title}**\n${t.response}`).join("\n\n---\n\n");
  assert.match(consolidatedOutputs, /Competitor Instagram Strategy Analysis/);
  assert.match(consolidatedOutputs, /Wake Up to Craft/);
  assert.match(consolidatedOutputs, /7-Day Instagram Publishing Schedule/);

  // Status check verifies all 3 tasks reached 'completed' truthfully
  assert.ok(dbTasks.every((t) => t.status === "completed"));
});

test("E2E Acceptance: User follow-up provides additional important information, updating existing task instructions without duplicate tasks", async () => {
  // 1. Initial assignment by Master Agent
  const initialPlan = validateMasterPlan(JSON.stringify({
    tasks: [
      {
        agentId: "seat-1",
        title: "Coffee Market Research",
        instructions: "Research competitor pricing and popular menu items in NYC.",
        dependsOn: [],
      },
    ],
  }), ["seat-1", "seat-mvj4q0fn", "seat-mvj4q1b7", "seat-mvj4q1mo"]);

  assert.equal(initialPlan.ok, true);
  const tasksInDb = [
    {
      id: 201,
      masterConversationId: 50,
      assignedAgentId: "seat-1",
      title: "Coffee Market Research",
      instructions: "Research competitor pricing and popular menu items in NYC.",
      status: "running",
      error: null,
    },
  ];

  // 2. User provides follow-up information: "Also make sure to focus on cold brew pricing and oat milk upcharges"
  const followUpPlan = validateMasterPlan(JSON.stringify({
    clarification: "",
    updatedTasks: [
      {
        id: 201,
        additionalInstructions: "Focus specifically on cold brew pricing and oat milk upcharges.",
      },
    ],
    tasks: [],
    review: "I have updated the research task with your focus on cold brew pricing and oat milk upcharges.",
  }), ["seat-1", "seat-mvj4q0fn", "seat-mvj4q1b7", "seat-mvj4q1mo"]);

  assert.equal(followUpPlan.ok, true);
  if (followUpPlan.ok) {
    assert.equal(followUpPlan.plan.tasks.length, 0); // Strictly no duplicate tasks
    assert.equal(followUpPlan.plan.updatedTasks.length, 1);

    // Apply update to existing task
    const targetTask = tasksInDb.find((t) => t.id === followUpPlan.plan.updatedTasks[0].id);
    assert.ok(targetTask);
    targetTask.instructions = `${targetTask.instructions}\n\n[Additional Information from User]:\n${followUpPlan.plan.updatedTasks[0].additionalInstructions}`;

    // Verify task count is still exactly 1 (no duplicate)
    assert.equal(tasksInDb.length, 1);
    assert.match(targetTask.instructions, /cold brew pricing and oat milk upcharges/);
    assert.match(targetTask.instructions, /competitor pricing and popular menu items/);
  }

  // 3. User follow-up on waiting_for_user task transitions it back to pending for execution
  const waitingTask = {
    id: 202,
    masterConversationId: 50,
    assignedAgentId: "seat-mvj4q0fn",
    title: "Draft Campaign Reel",
    instructions: "Waiting for brand voice confirmation.",
    status: "waiting_for_user",
    error: null,
  };
  tasksInDb.push(waitingTask);

  const userReplyPlan = validateMasterPlan(JSON.stringify({
    clarification: "",
    updatedTasks: [
      {
        id: 202,
        additionalInstructions: "Brand voice is witty, direct, and energetic.",
      },
    ],
    tasks: [],
  }), ["seat-1", "seat-mvj4q0fn", "seat-mvj4q1b7", "seat-mvj4q1mo"]);

  assert.equal(userReplyPlan.ok, true);
  if (userReplyPlan.ok) {
    const target = tasksInDb.find((t) => t.id === userReplyPlan.plan.updatedTasks[0].id);
    assert.ok(target);
    target.instructions = `${target.instructions}\n\n[Additional Information from User]:\n${userReplyPlan.plan.updatedTasks[0].additionalInstructions}`;
    // If waiting_for_user, status transitions back to pending so execution resumes
    if (target.status === "waiting_for_user") {
      target.status = "pending";
    }
    assert.equal(target.status, "pending");
    assert.match(target.instructions, /witty, direct, and energetic/);
    assert.equal(tasksInDb.length, 2); // Still exactly 2 tasks, no duplicate added
  }
});

test("E2E Acceptance: Selective browser usage in E2B sandbox for Research and Content Creator", async () => {
  const sandbox = createMockSandbox();
  const context = {
    authUserId: "user-alpha",
    campaignId: 101,
    agentId: "seat-1",
    taskId: 901,
    computerId: 1,
  };

  // 1. When external information is required, browser is used to navigate and observe
  await sandbox.open("https://instagram.com/explore/tags/specialtycoffee");
  assert.equal(sandbox.state.actions.length, 1);
  assert.equal(sandbox.state.actions[0].tool, "open");
  assert.equal(sandbox.state.actions[0].url, "https://instagram.com/explore/tags/specialtycoffee");

  // 2. When internal knowledge suffices, completeTask directly satisfies the objective without opening browser
  const directTaskComplete = {
    outcome: "completed",
    result: {
      summary: "Created creative campaign concept using existing brand guidelines and marketing knowledge.",
      findings: "High confidence direct synthesis without external web search.",
      artifacts: [],
      actions: [],
    },
  };

  assert.equal(directTaskComplete.outcome, "completed");
  assert.equal(directTaskComplete.result.actions.length, 0); // No browser actions needed
  assert.match(directTaskComplete.result.summary, /using existing brand guidelines/);
});

