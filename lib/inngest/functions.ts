import { NonRetriableError } from "inngest";
import { dispatchScheduledTasks, dispatchTaskIds, TASK_EXECUTION_EVENT } from "@/lib/task-scheduling";
import { TaskExecutionError, TaskLeaseLostError, generateTaskResponse, loadAndClaimTask, persistTaskFailure, persistTaskSuccess, persistTaskWaitingForUser, renewTaskExecutionLease } from "@/lib/task-execution";
import { HumanTakeoverActiveError } from "@/lib/computer-types";
import { sweepIdleComputersService, sweepStaleWaitingTasksService } from "@/lib/computer-service";
import { inngest } from "./client";
import { TASK_CONCURRENCY } from "./task-concurrency";

export const dispatchScheduledAgentTasks = inngest.createFunction(
  { id: "soto-dispatch-agent-tasks", name: "Dispatch scheduled SOTO agent tasks" },
  { cron: "*/15 * * * *" },
  async ({ step }) => step.run("dispatch-due-tasks", dispatchScheduledTasks),
);

type ExecutionEvent = { taskId?: unknown; authUserId?: unknown; assignedAgentId?: unknown };

function providerFailure(error: unknown) {
  if (error instanceof TaskExecutionError) return error;
  const { classifyError } = require("@/lib/recovery/error-classifier");
  const classified = classifyError(error);
  return new TaskExecutionError(classified.category, classified.httpStatus, { cause: error });
}

export const executeAgentTask = inngest.createFunction(
  {
    id: "soto-execute-agent-task",
    name: "Execute a SOTO specialist task",
    retries: 3,
    concurrency: TASK_CONCURRENCY,
  },
  { event: TASK_EXECUTION_EVENT },
  async ({ event, step, attempt }) => {
    const data = event.data as ExecutionEvent;
    let claimed: Awaited<ReturnType<typeof loadAndClaimTask>>;
    try {
      claimed = await step.run("validate-and-claim-task", () => loadAndClaimTask(data.taskId, data));
    } catch (error) {
      if (error instanceof TaskExecutionError) {
        if (error.category === "prerequisites_incomplete") return { skipped: "prerequisites_incomplete" };
        throw new NonRetriableError("Task validation failed", { cause: error });
      }
      throw error;
    }
    if (!claimed.claimed) return { skipped: claimed.reason };

    // Use an attempt-specific step so Inngest retries revalidate the fencing token.
    const leaseValid = await step.run(`renew-execution-lease-${attempt}`, () => renewTaskExecutionLease(claimed.taskId, claimed.leaseToken));
    if (!leaseValid) return { skipped: "execution_lease_lost" };

    let response: string;
    try {
      response = await step.run("generate-specialist-response", () => generateTaskResponse(claimed.taskId, claimed.leaseToken));
    } catch (error) {
      if (error instanceof TaskLeaseLostError) return { skipped: "execution_lease_lost" };
      if (error instanceof HumanTakeoverActiveError) {
        await step.run(`persist-waiting-for-user-${attempt}`, () => persistTaskWaitingForUser(claimed.taskId, claimed.leaseToken));
        return { taskId: claimed.taskId, status: "waiting_for_user" };
      }
      const failure = providerFailure(error);
      if (failure.transient && attempt < 3) throw error;
      const persisted = await step.run(`persist-terminal-task-failure-${attempt}`, () => persistTaskFailure(claimed.taskId, claimed.leaseToken, failure));
      if (!persisted) return { skipped: "execution_lease_lost" };
      await step.run(`check-master-synthesis-failure-${attempt}`, async () => {
        const { checkAndTriggerMasterSynthesis } = await import("@/lib/master-agent-synthesis");
        return checkAndTriggerMasterSynthesis(claimed.taskId);
      });
      return { taskId: claimed.taskId, status: "failed", category: failure.category };
    }
    const released = await step.run("persist-specialist-result", () => persistTaskSuccess(claimed.taskId, claimed.leaseToken, response));
    if (!released) return { skipped: "execution_lease_lost" };
    await step.run("dispatch-newly-unblocked-tasks", () => dispatchTaskIds(released));
    await step.run("check-master-synthesis", async () => {
      const { checkAndTriggerMasterSynthesis } = await import("@/lib/master-agent-synthesis");
      return checkAndTriggerMasterSynthesis(claimed.taskId);
    });
    return { taskId: claimed.taskId, status: "completed" };
  },
);

export const sweepAgentComputersAndTasks = inngest.createFunction(
  {
    id: "soto-sweep-computers-and-tasks",
    name: "Sweep idle agent computers and stale waiting tasks",
  },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    const idleResult = await step.run("sweep-idle-computers", () =>
      sweepIdleComputersService(),
    );
    const staleResult = await step.run("sweep-stale-waiting-tasks", () =>
      sweepStaleWaitingTasksService(),
    );
    return { idleResult, staleResult };
  },
);
