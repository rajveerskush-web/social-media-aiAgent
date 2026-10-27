CREATE TABLE "agent_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"campaign_id" integer NOT NULL,
	"master_conversation_id" integer NOT NULL,
	"assigned_agent_id" text NOT NULL,
	"title" text NOT NULL,
	"instructions" text NOT NULL,
	"dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"response" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_auth_user_id_users_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."users"("auth_user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_master_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("master_conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "agent_tasks_scope_created_idx" ON "agent_tasks" USING btree ("auth_user_id","campaign_id","created_at");
