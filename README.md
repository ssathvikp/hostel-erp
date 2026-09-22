# Hostel/PG ERP

Multi-tenant hostel and PG (paying-guest) management ERP — MVP v0.1.

> **This README is a placeholder.**
> It exists so that the repository has a README at its first commit. The full setup and
> run documentation — prerequisites, every required environment variable (names only,
> never values), local Supabase start/migrate/seed commands, and the dev, lint,
> typecheck and test workflow — is delivered by the EP-01 subtask
> *"Write setup and run documentation in README"*, which runs after the Supabase
> environment and the SQL migration workflow exist.

## Project tracking

ClickUp is the single source of truth for task planning, status and acceptance criteria.
The repository-side mirror of that plan lives in [`scripts/clickup/`](scripts/clickup/README.md).

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, Turbopack) |
| Language | TypeScript, `strict: true` |
| Styling | Tailwind CSS v4 (CSS-first, no `tailwind.config.ts`) |
| Lint | ESLint 9 flat config via `eslint-config-next` |
| Database | Supabase (PostgreSQL) — not wired up yet |
| Package manager | npm |

## Current state

Foundation scaffold only. There are no product features yet.

```bash
npm install      # install dependencies
npm run dev      # start the dev server on http://localhost:3000
npm run lint     # ESLint
npm run typecheck # tsc --noEmit
npm run build    # production build
```
