import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import {
  dispatchScheduledAgentTasks,
  executeAgentTask,
  sweepAgentComputersAndTasks,
} from '@/lib/inngest/functions';

// Maximum execution time for long-running specialist tasks
export const maxDuration = 300;

// Create an API route that serves Inngest functions
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    dispatchScheduledAgentTasks,
    executeAgentTask,
    sweepAgentComputersAndTasks,
  ],
});
