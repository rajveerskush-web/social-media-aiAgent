CREATE TABLE "agent_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"campaign_id" integer NOT NULL,
	"agent_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_auth_user_id_users_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."users"("auth_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversation_id_agent_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_conversations_scope_agent_uidx" ON "agent_conversations" USING btree ("auth_user_id","campaign_id","agent_id");--> statement-breakpoint
CREATE INDEX "agent_messages_conversation_created_idx" ON "agent_messages" USING btree ("conversation_id","created_at");