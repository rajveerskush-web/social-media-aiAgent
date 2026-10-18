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
