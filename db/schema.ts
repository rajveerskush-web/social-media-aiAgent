import { customType, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
  status: text("status").notNull().default("queued"),
  response: text("response"),
  error: text("error"),
  requestKey: text("request_key"),
  taskIndex: integer("task_index"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("agent_tasks_scope_created_idx").on(table.authUserId, table.campaignId, table.createdAt),
  uniqueIndex("agent_tasks_request_index_uidx").on(table.masterConversationId, table.requestKey, table.taskIndex),
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
