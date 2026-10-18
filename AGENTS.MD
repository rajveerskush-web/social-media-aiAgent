# Project Instructions

## General Rules
- Understand the existing code before making changes.
- Follow the project's current structure, coding style, and conventions.
- Make only changes relevant to the user's request.
- Do not refactor or modify unrelated files.
- Prefer simple, maintainable solutions over unnecessary complexity.

## Task Handling
- For simple tasks such as searching files, reading logs, and listing code locations, use the quick-helper agent when available.
- For small code changes, inspect the relevant files and make focused edits.
- For complex debugging, architectural decisions, or changes spanning multiple components, investigate carefully before editing.
- Do not guess when important information is missing.
- Never claim that a model or reasoning mode was switched unless it actually happened.

## Project Safety
- Do not expose secrets from `.env` files.
- Do not overwrite existing work unnecessarily.
- Ask before performing destructive operations or major architectural changes.
- Preserve existing dependencies unless a change is necessary.

## Verification
- Run relevant tests or checks after making code changes when practical.
- Report any checks that could not be performed.
- Do not claim that tests passed unless they actually ran successfully.

## Final Response
- Summarize what was changed.
- Mention the relevant file paths.
- Report verification results and any remaining issues.
- Keep the response concise.

<!-- INSFORGE:START -->
## InsForge backend

This project uses [InsForge](https://insforge.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime, an AI model gateway, and payments through one platform.

- **Project:** **SOTO AI** (API base `https://qa2a4wi7.us-east.insforge.app`)
- **Skills:** these InsForge skills are installed for supported coding agents. Reach for them before implementing any InsForge feature instead of guessing the API:
  - `insforge`: app code with the `@insforge/sdk` client (database CRUD, auth, storage, edge functions, realtime, AI, email, and Stripe payments).
  - `insforge-cli`: backend and infrastructure via the `insforge` CLI (projects, SQL, migrations, RLS policies, storage buckets, functions, secrets, payment setup, schedules, deploys).
  - `insforge-debug`: diagnosing failures (SDK/HTTP errors, RLS denials, auth and OAuth issues) and running security or performance audits.
  - `insforge-integrations`: wiring external auth providers (Clerk, Auth0, WorkOS, Better Auth, etc.) for JWT-based RLS, or the OKX x402 payment facilitator.
  - `find-skills`: discovering additional skills on demand.
- **Credentials:** app code reads keys from `.env.local`; the CLI reads `.insforge/project.json`. Never hardcode or commit keys.

Key patterns:

- Database inserts take an array: `insert([{ ... }])`.
- Reference users with `auth.users(id)`; use `auth.uid()` in RLS policies.
- For storage uploads, persist both the returned `url` and `key`.
<!-- INSFORGE:END -->
