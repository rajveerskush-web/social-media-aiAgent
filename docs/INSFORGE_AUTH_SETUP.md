# InsForge Auth and Neon database setup

SOTO uses InsForge exclusively for authentication and Neon PostgreSQL for application data. Google/email sign-in, OAuth callbacks, session verification, and sign-out remain on InsForge. The server verifies the InsForge session with `auth.getCurrentUser()` before writing a profile to Neon.

## Environment

- `NEXT_PUBLIC_INSFORGE_URL` and `NEXT_PUBLIC_INSFORGE_ANON_KEY` configure the InsForge Auth SDK. The anon key is public by design.
- `NEXT_PUBLIC_APP_URL` must match the local or deployed app origin.
- `NEON_DATABASE_URL` is the Neon connection string and must stay server-only. Do not prefix it with `NEXT_PUBLIC_` or reuse the former InsForge `DATABASE_URL` value.

Set `NEON_DATABASE_URL` in `.env.local` without replacing the existing InsForge Auth values. Obtain the Neon connection string from the Neon project console and keep it out of source control and client code. Drizzle loads the same Next.js environment files. The database module and Drizzle config reject hosts that are not under `.neon.tech` to prevent accidental database commands against InsForge.

## Google provider

1. In Google Cloud Console, configure an OAuth client with the InsForge-provided authorization callback URI as an authorized redirect URI. Add the SOTO site origin (`http://localhost:3000` locally and the production origin) as an authorized JavaScript origin when the InsForge setup flow requests it.
2. In the InsForge project dashboard, enable Google under Authentication providers and enter the Google client ID and client secret. Keep the secret in InsForge; do not put it in `.env` or browser code.
3. Add these application callback URLs to InsForge's allowed redirect URLs:
   - Local: `http://localhost:3000/api/auth/callback`
   - Production: `https://<your-production-domain>/api/auth/callback`
4. Set `NEXT_PUBLIC_APP_URL` to the matching origin in each environment. The application appends `/api/auth/callback` for the OAuth return URL.

## Profile storage and identity

The Neon `users` profile table keeps the serial `id`, `name`, `email`, and `created_at` columns and adds a unique, non-null `auth_user_id` UUID. There is intentionally no foreign key to `auth.users`: InsForge Auth and Neon are separate PostgreSQL databases, so PostgreSQL cannot enforce a cross-database reference. The ID is taken only from the verified InsForge server session, never from client input.

After email/password signup or verification, Google OAuth callback, and later sign-ins, the server upserts the profile by `auth_user_id`. Repeated sign-ins therefore update the same profile row. The Neon connection string is used only by the server-side Drizzle module. InsForge's database API is not used for application profiles or other application data.

## Neon schema migration

Drizzle migrations are stored in `drizzle/`; the old `migrations/` directory is the InsForge migration workflow and is not used for Neon. The existing InsForge migration remains in the repository and is not applied as part of this cutover.

1. Configure `NEON_DATABASE_URL` privately in `.env.local` and verify it is a Neon connection string. Do not change the existing InsForge Auth variables or the legacy `DATABASE_URL` value.
2. Inspect the target Neon database before applying the initial migration. If it already contains application tables or data, stop and reconcile the schema/history first; do not use `drizzle-kit push` or reset the database.
3. Generate and review SQL with `npm run db:generate`.
4. Apply the reviewed migration with `npm run db:migrate`. Both commands load `drizzle.config.ts`, which requires `NEON_DATABASE_URL` and rejects non-Neon hosts.
5. Verify the migration journal and confirm `users` has the stable UUID unique constraint and `posts.author_id` references `users.id`.

No application data is copied automatically by a schema migration. The old InsForge PostgreSQL database and its tables/data are left in place. If InsForge contains posts or other application rows that must also appear in Neon, export/import that data as a separate reviewed migration before cutover.
