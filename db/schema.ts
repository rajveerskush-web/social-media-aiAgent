import { boolean, customType, foreignKey, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name"),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Stable identity verified by InsForge Auth. This is intentionally not a
  // foreign key: auth.users lives in a different PostgreSQL database.
  authUserId: uuid("auth_user_id").notNull().unique(),
});

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  // Integer FK to the local Neon profile row; serial would create a second
  // sequence and could generate author IDs unrelated to users.id.
  authorId: integer("author_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const campaign = pgTable("campaign", {
  id: serial("id").primaryKey(),
  authUserId: uuid("auth_user_id")
    .notNull()
    .references(() => users.authUserId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  iconKey: text("icon_key"),
  iconImage: bytea("icon_image"),
  iconImageMime: text("icon_image_mime"),
  officeImage: text("office_image").notNull(),
  status: text("status").notNull().default("active"),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [index("campaign_auth_user_id_idx").on(table.authUserId)]);

export const agentConversations = pgTable("agent_conversations", {
  id: serial("id").primaryKey(),
  authUserId: uuid("auth_user_id").notNull().references(() => users.authUserId, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").notNull().references(() => campaign.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_conversations_scope_agent_uidx").on(table.authUserId, table.campaignId, table.agentId),
]);

export const agentMessages = pgTable("agent_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => agentConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  requestKey: text("request_key"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("agent_messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  uniqueIndex("agent_messages_request_role_uidx").on(table.conversationId, table.requestKey, table.role),
]);

export const agentTasks = pgTable("agent_tasks", {
  id: serial("id").primaryKey(),
  authUserId: uuid("auth_user_id").notNull().references(() => users.authUserId, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").notNull().references(() => campaign.id, { onDelete: "cascade" }),
  masterConversationId: integer("master_conversation_id").notNull().references(() => agentConversations.id, { onDelete: "cascade" }),
  assignedAgentId: text("assigned_agent_id").notNull(),
  title: text("title").notNull(),
  instructions: text("instructions").notNull(),
  dependencies: jsonb("dependencies").$type<number[]>().notNull().default([]),
  status: text("status").notNull().default("pending"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull().defaultNow(),
  timeZone: text("time_zone"),
  repeatRule: jsonb("repeat_rule").$type<{ frequency: "daily" | "weekly" | "monthly"; interval: number; timeZone: string; occurrences?: number } | null>(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  dispatchClaimedAt: timestamp("dispatch_claimed_at", { withTimezone: true }),
  executionLeaseToken: uuid("execution_lease_token"),
  executionLeaseExpiresAt: timestamp("execution_lease_expires_at", { withTimezone: true }),
  repeatSeriesId: integer("repeat_series_id"),
  occurrenceKey: text("occurrence_key"),
  response: text("response"),
  error: text("error"),
  requestKey: text("request_key"),
  taskIndex: integer("task_index"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("agent_tasks_scope_created_idx").on(table.authUserId, table.campaignId, table.createdAt),
  index("agent_tasks_dispatch_due_idx").on(table.status, table.scheduledAt),
  index("agent_tasks_execution_lease_idx").on(table.status, table.executionLeaseExpiresAt),
  uniqueIndex("agent_tasks_occurrence_key_uidx").on(table.occurrenceKey),
  uniqueIndex("agent_tasks_request_index_uidx").on(table.masterConversationId, table.requestKey, table.taskIndex),
  foreignKey({ name: "agent_tasks_repeat_series_id_fk", columns: [table.repeatSeriesId], foreignColumns: [table.id] }).onDelete("set null"),
]);

export const agentTaskOutbox = pgTable("agent_task_outbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: integer("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
  dispatchClaimToken: uuid("dispatch_claim_token"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("agent_task_outbox_dispatch_idx").on(table.status, table.nextAttemptAt),
  index("agent_task_outbox_stale_dispatch_idx").on(table.updatedAt).where(sql`${table.status} = 'dispatching'`),
  uniqueIndex("agent_task_outbox_task_active_uidx").on(table.taskId).where(sql`${table.status} IN ('pending', 'dispatching')`),
]);

export const agentComputers = pgTable("agent_computers", {
  id: serial("id").primaryKey(),
  authUserId: uuid("auth_user_id").notNull().references(() => users.authUserId, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").notNull().references(() => campaign.id, { onDelete: "cascade" }),
  agentId: text("agent_id").notNull(),
  sandboxId: text("sandbox_id"),
  status: text("status").notNull().default("stopped"),
  controlMode: text("control_mode").notNull().default("agent"),
  streamAuthKey: text("stream_auth_key"),
  activeTaskId: integer("active_task_id").references(() => agentTasks.id, { onDelete: "set null" }),
  lastScreenshotAt: timestamp("last_screenshot_at", { withTimezone: true }),
  lastScreenshotBase64: text("last_screenshot_base64"),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_computers_campaign_agent_uidx").on(table.campaignId, table.agentId),
  index("agent_computers_scope_idx").on(table.authUserId, table.campaignId),
  index("agent_computers_status_idx").on(table.status),
]);

export const agentComputerTasks = pgTable("agent_computer_tasks", {
  id: serial("id").primaryKey(),
  computerId: integer("computer_id").notNull().references(() => agentComputers.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
  authUserId: uuid("auth_user_id").notNull().references(() => users.authUserId, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").notNull().references(() => campaign.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  currentStepIndex: integer("current_step_index").notNull().default(0),
  activityDescription: text("activity_description"),
  waitingReason: text("waiting_reason"),
  waitingSince: timestamp("waiting_since", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("agent_computer_tasks_lookup_idx").on(table.taskId, table.computerId),
  uniqueIndex("agent_computer_tasks_active_uidx").on(table.computerId).where(sql`${table.status} IN ('active', 'waiting_for_user')`),
]);

export const agentComputerCheckpoints = pgTable("agent_computer_checkpoints", {
  id: serial("id").primaryKey(),
  computerTaskId: integer("computer_task_id").notNull().references(() => agentComputerTasks.id, { onDelete: "cascade" }),
  stepIndex: integer("step_index").notNull(),
  messages: jsonb("messages").$type<Array<{ role: string; content: unknown }>>().notNull(),
  actionsLog: jsonb("actions_log").$type<Array<{
    tool: string;
    params: Record<string, unknown>;
    attempted: boolean;
    verified: boolean;
    resultSummary: string;
    timestamp: string;
  }>>().notNull().default([]),
  screenshotBase64: text("screenshot_base64"),
  currentUrl: text("current_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("agent_computer_checkpoints_step_uidx").on(table.computerTaskId, table.stepIndex),
]);

export const agentTaskArtifacts = pgTable("agent_task_artifacts", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => agentTasks.id, { onDelete: "cascade" }),
  computerId: integer("computer_id").references(() => agentComputers.id, { onDelete: "set null" }),
  authUserId: uuid("auth_user_id").notNull().references(() => users.authUserId, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").notNull().references(() => campaign.id, { onDelete: "cascade" }),
  artifactType: text("artifact_type").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes"),
  sandboxPath: text("sandbox_path"),
  fileHash: text("file_hash"),
  imagekitUrl: text("imagekit_url"),
  imagekitFileId: text("imagekit_file_id"),
  isVerified: boolean("is_verified").notNull().default(false),
  isApprovedForSharing: boolean("is_approved_for_sharing").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("agent_task_artifacts_task_idx").on(table.taskId),
  index("agent_task_artifacts_campaign_idx").on(table.campaignId, table.authUserId),
]);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Campaign = typeof campaign.$inferSelect;
export type NewCampaign = typeof campaign.$inferInsert;
export type AgentConversation = typeof agentConversations.$inferSelect;
export type AgentMessage = typeof agentMessages.$inferSelect;
export type AgentTask = typeof agentTasks.$inferSelect;
export type AgentComputer = typeof agentComputers.$inferSelect;
export type NewAgentComputer = typeof agentComputers.$inferInsert;
export type AgentComputerTask = typeof agentComputerTasks.$inferSelect;
export type NewAgentComputerTask = typeof agentComputerTasks.$inferInsert;
export type AgentComputerCheckpoint = typeof agentComputerCheckpoints.$inferSelect;
export type NewAgentComputerCheckpoint = typeof agentComputerCheckpoints.$inferInsert;
export type AgentTaskArtifact = typeof agentTaskArtifacts.$inferSelect;
export type NewAgentTaskArtifact = typeof agentTaskArtifacts.$inferInsert;
