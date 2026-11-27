-- Requires 0006_task_scheduling.sql. Abort before DDL if active outbox rows
-- already violate the uniqueness rule this migration adds.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "agent_task_outbox"
		WHERE "status" IN ('pending', 'dispatching')
		GROUP BY "task_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot apply 0007_task_recovery: duplicate active agent_task_outbox rows exist; resolve duplicates first.';
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "execution_lease_token" uuid;
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "execution_lease_expires_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "agent_tasks_execution_lease_idx" ON "agent_tasks" USING btree ("status", "execution_lease_expires_at");
--> statement-breakpoint
ALTER TABLE "agent_task_outbox" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_task_outbox" ADD COLUMN "dispatch_claim_token" uuid;
--> statement-breakpoint
ALTER TABLE "agent_task_outbox" ADD COLUMN "last_error" text;
--> statement-breakpoint
CREATE INDEX "agent_task_outbox_dispatch_idx" ON "agent_task_outbox" USING btree ("status", "next_attempt_at");
--> statement-breakpoint
CREATE INDEX "agent_task_outbox_stale_dispatch_idx" ON "agent_task_outbox" USING btree ("updated_at") WHERE "status" = 'dispatching';
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_task_outbox_task_active_uidx" ON "agent_task_outbox" USING btree ("task_id") WHERE "status" IN ('pending', 'dispatching');
--> statement-breakpoint
DROP INDEX "agent_task_outbox_task_pending_uidx";
--> statement-breakpoint
DROP INDEX "agent_task_outbox_pending_idx";
