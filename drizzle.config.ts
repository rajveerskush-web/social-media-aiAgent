import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

// Load the same local environment files as Next.js while preserving variables
// already provided by the process or deployment environment.
loadEnvConfig(process.cwd());

const databaseUrl = process.env.NEON_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('NEON_DATABASE_URL must be set before running Drizzle commands.');
}

const databaseHost = new URL(databaseUrl).hostname;
if (!databaseHost.endsWith('.neon.tech')) {
  throw new Error('NEON_DATABASE_URL must point to a Neon PostgreSQL host.');
}

export default defineConfig({
  schema: './db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  tablesFilter: ['!pg_stat_monitor*', '!pg_stat_statements*'],
});
