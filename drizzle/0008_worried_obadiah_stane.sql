CREATE TABLE "agent_computer_checkpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"computer_task_id" integer NOT NULL,
	"step_index" integer NOT NULL,
	"messages" jsonb NOT NULL,
	"actions_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"screenshot_base64" text,
	"current_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_computer_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"computer_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"campaign_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"activity_description" text,
	"waiting_reason" text,
	"waiting_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_computers" (
	"id" serial PRIMARY KEY NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"campaign_id" integer NOT NULL,
	"agent_id" text NOT NULL,
	"sandbox_id" text,
	"status" text DEFAULT 'stopped' NOT NULL,
	"control_mode" text DEFAULT 'agent' NOT NULL,
	"stream_auth_key" text,
	"active_task_id" integer,
	"last_screenshot_at" timestamp with time zone,
	"last_screenshot_base64" text,
	"last_active_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_task_artifacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"computer_id" integer,
	"auth_user_id" uuid NOT NULL,
	"campaign_id" integer NOT NULL,
	"artifact_type" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer,
	"sandbox_path" text,
	"file_hash" text,
	"imagekit_url" text,
	"imagekit_file_id" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_approved_for_sharing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "agent_task_outbox_stale_dispatch_idx";--> statement-breakpoint
DROP INDEX "agent_task_outbox_task_active_uidx";--> statement-breakpoint
ALTER TABLE "agent_task_outbox" ALTER COLUMN "attempts" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_computer_checkpoints" ADD CONSTRAINT "agent_computer_checkpoints_computer_task_id_agent_computer_tasks_id_fk" FOREIGN KEY ("computer_task_id") REFERENCES "public"."agent_computer_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_computer_tasks" ADD CONSTRAINT "agent_computer_tasks_computer_id_agent_computers_id_fk" FOREIGN KEY ("computer_id") REFERENCES "public"."agent_computers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_computer_tasks" ADD CONSTRAINT "agent_computer_tasks_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_computer_tasks" ADD CONSTRAINT "agent_computer_tasks_auth_user_id_users_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."users"("auth_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_computer_tasks" ADD CONSTRAINT "agent_computer_tasks_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_computers" ADD CONSTRAINT "agent_computers_auth_user_id_users_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."users"("auth_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_computers" ADD CONSTRAINT "agent_computers_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_computers" ADD CONSTRAINT "agent_computers_active_task_id_agent_tasks_id_fk" FOREIGN KEY ("active_task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_artifacts" ADD CONSTRAINT "agent_task_artifacts_task_id_agent_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_artifacts" ADD CONSTRAINT "agent_task_artifacts_computer_id_agent_computers_id_fk" FOREIGN KEY ("computer_id") REFERENCES "public"."agent_computers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_artifacts" ADD CONSTRAINT "agent_task_artifacts_auth_user_id_users_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."users"("auth_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task_artifacts" ADD CONSTRAINT "agent_task_artifacts_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_computer_checkpoints_step_uidx" ON "agent_computer_checkpoints" USING btree ("computer_task_id","step_index");--> statement-breakpoint
CREATE INDEX "agent_computer_tasks_lookup_idx" ON "agent_computer_tasks" USING btree ("task_id","computer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_computer_tasks_active_uidx" ON "agent_computer_tasks" USING btree ("computer_id") WHERE "agent_computer_tasks"."status" IN ('active', 'waiting_for_user');--> statement-breakpoint
CREATE UNIQUE INDEX "agent_computers_campaign_agent_uidx" ON "agent_computers" USING btree ("campaign_id","agent_id");--> statement-breakpoint
CREATE INDEX "agent_computers_scope_idx" ON "agent_computers" USING btree ("auth_user_id","campaign_id");--> statement-breakpoint
CREATE INDEX "agent_computers_status_idx" ON "agent_computers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_task_artifacts_task_idx" ON "agent_task_artifacts" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "agent_task_artifacts_campaign_idx" ON "agent_task_artifacts" USING btree ("campaign_id","auth_user_id");--> statement-breakpoint
CREATE INDEX "agent_task_outbox_stale_dispatch_idx" ON "agent_task_outbox" USING btree ("updated_at") WHERE "agent_task_outbox"."status" = 'dispatching';--> statement-breakpoint
CREATE UNIQUE INDEX "agent_task_outbox_task_active_uidx" ON "agent_task_outbox" USING btree ("task_id") WHERE "agent_task_outbox"."status" IN ('pending', 'dispatching');