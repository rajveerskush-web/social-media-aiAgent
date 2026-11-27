import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

let database: ReturnType<typeof createDatabase> | undefined;

function createDatabase() {
  const connectionString = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("NEON_DATABASE_URL or DATABASE_URL must be configured for server-side database access.");
  }

  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    throw new Error("Database connection string must be a valid PostgreSQL connection URL.");
  }
  if (!host.endsWith(".neon.tech")) {
    throw new Error("Database connection URL must point to a Neon PostgreSQL host.");
  }

  const neonClient = postgres(connectionString, { prepare: false });
  return drizzle({ client: neonClient, schema });
}

export function getDb() {
  database ??= createDatabase();
  return database;
}

export * from "./schema.ts";
