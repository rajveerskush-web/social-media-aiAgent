ALTER TABLE "agent_tasks" ADD COLUMN "scheduled_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "time_zone" text;
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "repeat_rule" jsonb;
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "next_run_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "dispatch_claimed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "repeat_series_id" integer;
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "occurrence_key" text;
--> statement-breakpoint
ALTER TABLE "agent_tasks" ALTER COLUMN "status" SET DEFAULT 'pending';
--> statement-breakpoint
UPDATE "agent_tasks" SET "status" = 'pending' WHERE "status" = 'queued';
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_repeat_series_id_fk" FOREIGN KEY ("repeat_series_id") REFERENCES "public"."agent_tasks"("id") ON DELETE SET NULL ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "agent_tasks_dispatch_due_idx" ON "agent_tasks" USING btree ("status", "scheduled_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tasks_occurrence_key_uidx" ON "agent_tasks" USING btree ("occurrence_key");
--> statement-breakpoint
CREATE TABLE "agent_task_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_task_outbox" ADD CONSTRAINT "agent_task_outbox_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "agent_task_outbox_pending_idx" ON "agent_task_outbox" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_task_outbox_task_pending_uidx" ON "agent_task_outbox" USING btree ("task_id") WHERE "status" = 'pending';
