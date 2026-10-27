ALTER TABLE "agent_messages" ADD COLUMN "request_key" text;
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "request_key" text;
--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "task_index" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_messages_request_role_uidx" ON "agent_messages" USING btree ("conversation_id", "request_key", "role");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tasks_request_index_uidx" ON "agent_tasks" USING btree ("master_conversation_id", "request_key", "task_index");
