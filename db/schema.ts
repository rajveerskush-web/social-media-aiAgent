import { customType, index, integer, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";

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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Campaign = typeof campaign.$inferSelect;
export type NewCampaign = typeof campaign.$inferInsert;
