# Hostel/PG ERP

[![CI](https://github.com/saisathvik0219/hostel-erp/actions/workflows/ci.yml/badge.svg)](https://github.com/saisathvik0219/hostel-erp/actions/workflows/ci.yml)

Multi-tenant hostel and PG (paying-guest) management ERP. MVP v0.1 covers
hostel onboarding, room and bed inventory, residents, bed allocation, fees
and a basic dashboard.

## Prerequisites

| Tool           | Version               | Notes                                        |
| -------------- | --------------------- | -------------------------------------------- |
| Node.js        | 24 LTS (see `.nvmrc`) | `nvm use` or `fnm use` picks it up           |
| npm            | 11 or newer           | ships with Node 24                           |
| Docker Desktop | any recent version    | must be running for the local Supabase stack |
| Git            | any recent version    |                                              |

The Supabase CLI is a project dependency (`npx supabase`), so no global install
is needed.

## Getting started

From a fresh clone:

```bash
npm install          # dependencies, plus the git pre-commit hook
npm run db:start     # local Supabase in Docker; applies every migration
npm run env:local    # writes the local Supabase URL and keys into .env.local
npm run dev          # http://localhost:3000
```

The first `db:start` downloads the Supabase images and takes a few minutes.

For realistic data to click through, run `npm run db:seed` (local only; safe
to run again). It prints the demo owner and staff logins.

| Local service             | URL                      |
| ------------------------- | ------------------------ |
| App                       | <http://localhost:3000>  |
| Supabase Studio           | <http://localhost:54323> |
| Mail catcher (auth email) | <http://localhost:54324> |
| Supabase API              | <http://localhost:54321> |

## Environment variables

`.env.example` lists every variable. Names only; values never go in git.

| Variable                        | Exposure      | Purpose                                                        |
| ------------------------------- | ------------- | -------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | browser       | Supabase API URL                                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser       | Publishable (anon) key; every query runs as RLS                |
| `SUPABASE_SERVICE_ROLE_KEY`     | server only   | Secret key; bypasses RLS. Trusted jobs only                    |
| `ID_PROOF_HMAC_KEY`             | server only   | Keys the hash of resident ID numbers; never change it once set |
| `SUPABASE_DB_URL`               | local tests   | Direct Postgres connection for schema tests                    |
| `CLICKUP_API_TOKEN`             | local scripts | Only for `scripts/clickup/sync-plan.ps1`                       |
| `ENABLE_DIAGNOSTICS`            | tests only    | `1` turns on `/diagnostics/error`; never in prod               |

The app refuses to build or start when a required variable is missing.

## Scripts

| Command                          | What it does                                                  |
| -------------------------------- | ------------------------------------------------------------- |
| `npm run dev`                    | Dev server with Turbopack                                     |
| `npm run build`                  | Production build                                              |
| `npm run lint`                   | ESLint                                                        |
| `npm run typecheck`              | `tsc --noEmit`                                                |
| `npm run format`                 | Prettier write (`format:check` to verify only)                |
| `npm test`                       | Every test suite                                              |
| `npm run test:unit`              | Unit tests; no database needed                                |
| `npm run test:db`                | Schema, RLS and integration tests against local Supabase      |
| `npm run test:integrity`         | The bed and money integrity rules on their own (about 2 s)    |
| `npm run test:e2e`               | Browser tests (desktop and mobile) against a production build |
| `npm run db:start` / `stop`      | Start or stop the local Supabase stack                        |
| `npm run db:new -- <name>`       | Create a migration in `supabase/migrations/`                  |
| `npm run db:reset`               | Rebuild the local database from empty with every migration    |
| `npm run db:types`               | Regenerate `src/types/database.ts` from the local schema      |
| `npm run db:seed`                | Add a demo hostel with residents, invoices and payments       |
| `npm run db:lint`                | Lint the database schema                                      |
| `npm run env:local`              | Write local Supabase values into `.env.local`                 |
| `npm run admin:grant -- <email>` | Make an existing account a platform admin (`/admin`)          |
| `npm run staging:auth`           | Apply auth settings and email templates to staging            |
| `npm run test:staging`           | The smoke journey against the deployed staging site           |

## Database

Schema changes are SQL migrations in `supabase/migrations/`, never dashboard
edits. Read [docs/database.md](docs/database.md) before writing one: it covers
tenancy, row-level security, composite tenant keys, functions, views and data
rules. The `tests/integration/schema-guards.test.ts` suite enforces the most
important of those rules on every CI run.

After a schema change:

```bash
npm run db:reset && npm run db:types && npm run test:db
```

## Staging

The app deploys to Vercel and uses its own hosted Supabase project.
[docs/staging.md](docs/staging.md) is the runbook: first-time setup, the
values each service needs, applying migrations with `supabase db push`, and
the smoke test. Free-tier Supabase projects pause after about a week without
activity and must be restored from the dashboard.

## Authentication

Owners sign up with email and password and must confirm their email before
signing in. Locally, every auth email (confirmation, password reset, password
changed) lands in the mail catcher at <http://localhost:54324>.

- Email links go to `/auth/confirm` with a one-time token hash, so they work in
  any browser. The templates live in `supabase/templates/`; for the hosted
  project they must be copied into Authentication → Email Templates, and a
  custom SMTP provider configured, because Supabase's built-in email only
  delivers to project team members.
- `src/middleware.ts` refreshes the session and redirects signed-out visitors
  away from app routes. Pages and server actions check again on their own:
  `requireUser()` for pages and layouts, `requireRole([...])` first thing in
  every server action (`src/lib/auth/session.ts`).

## Errors and logging

- Unhandled errors show a friendly page with a reference code (the error
  digest), never a message or stack: `src/app/(app)/error.tsx` inside the app
  shell, `src/app/error.tsx` elsewhere, `src/app/global-error.tsx` if the root
  layout itself fails.
- Every request gets an `x-request-id` (minted by the middleware, returned to
  the browser). `src/instrumentation.ts` logs each unhandled server error as
  one JSON line with that id, the route and the digest, so a reference a user
  reports can be found. Server actions log failures they cannot explain to
  the user (`unexpectedFailure` in `src/lib/request-context.ts`).
- Logs never carry personal data or secrets (`src/lib/logger.ts`): personal
  and secret keys are redacted, phone numbers, emails, ID numbers, tokens and
  keys are scrubbed from every string (including Next.js's own console
  output), database errors are logged by code and hint only, and query
  strings are dropped from paths.

## Quality gates

- **Pre-commit:** ESLint (zero warnings) and Prettier on staged files.
- **CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)), on every pull
  request and push to `main`:
  - lint, typecheck, format check and unit tests;
  - local Supabase started from empty, schema lint, a check that
    `src/types/database.ts` is up to date, the database test suites, a
    production build, and the Playwright browser tests.

## Stack

| Layer      | Choice                                                    |
| ---------- | --------------------------------------------------------- |
| Framework  | Next.js 15 (App Router, Turbopack)                        |
| Language   | TypeScript, `strict: true`                                |
| Styling    | Tailwind CSS v4 (CSS-first, no `tailwind.config.ts`)      |
| Database   | Supabase (PostgreSQL 17) via `@supabase/ssr`              |
| Validation | Zod (`src/lib/validation/`)                               |
| Tests      | Vitest (unit, integration, RLS), Playwright (`tests/e2e`) |
| Tooling    | ESLint 9, Prettier, Husky + lint-staged, npm              |

## Project tracking

ClickUp is the source of truth for task status and acceptance criteria. The
repository mirror of the plan lives in [`scripts/clickup/`](scripts/clickup/README.md).

Revenue ideas not yet scheduled (billing, online rent collection, a resident
app, a vacancy marketplace and more) are in EP-14, in
[`scripts/clickup/plan-11.ndjson`](scripts/clickup/plan-11.ndjson).
The business weak points and their fixes are in
[`docs/business-analysis.md`](docs/business-analysis.md), tracked as EP-15 in
[`scripts/clickup/plan-12.ndjson`](scripts/clickup/plan-12.ndjson).
