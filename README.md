# Hostel/PG ERP

Multi-tenant hostel and PG (paying-guest) management ERP — MVP v0.1.

> **This README is a placeholder.**
> It exists so that the repository has a README at its first commit. The full setup and
> run documentation — prerequisites, every required environment variable (names only,
> never values), local Supabase start/migrate/seed commands, and the dev, lint,
> typecheck and test workflow — is delivered by the EP-01 subtask
> _"Write setup and run documentation in README"_, which runs after the Supabase
> environment and the SQL migration workflow exist.

## Project tracking

ClickUp is the single source of truth for task planning, status and acceptance criteria.
The repository-side mirror of that plan lives in [`scripts/clickup/`](scripts/clickup/README.md).

## Stack

| Layer           | Choice                                               |
| --------------- | ---------------------------------------------------- |
| Framework       | Next.js 15 (App Router, Turbopack)                   |
| Language        | TypeScript, `strict: true`                           |
| Styling         | Tailwind CSS v4 (CSS-first, no `tailwind.config.ts`) |
| Lint            | ESLint 9 flat config via `eslint-config-next`        |
| Format          | Prettier, enforced by a Husky + lint-staged hook     |
| Validation      | Zod (`src/lib/validation/`)                          |
| Tests           | Vitest (`tests/`)                                    |
| Database        | Supabase (PostgreSQL) via `@supabase/ssr`            |
| Package manager | npm                                                  |

## Current state

Foundation only: app shell, UI primitives, domain types, validation layer and
Supabase clients. There are no product features yet.

```bash
cp .env.example .env.local  # then fill in the Supabase values
npm install       # install dependencies (also installs the git hooks)
npm run dev       # start the dev server on http://localhost:3000
npm run lint      # ESLint
npm run typecheck # tsc --noEmit
npm test          # unit tests
npm run format    # Prettier (format:check to verify only)
npm run build     # production build
```

The app refuses to build or start if a required variable in `.env.example`
is missing.
