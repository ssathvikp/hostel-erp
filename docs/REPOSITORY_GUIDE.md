# Hostel ERP: repository guide

A complete tour of this repository: what the product does, how the code is
organised, how the database protects tenants and money, how it is tested
and deployed, what still needs accounts or decisions, and, at the end, a
dated log of the work done in each working session.

For day-to-day commands start with the [README](../README.md). The topic
documents linked below go deeper than this guide.

---

## 1. What the product is

Hostel ERP is a multi-tenant web application for running hostels and PG
(paying-guest) accommodation in India. One owner account can run several
hostels; each hostel's data is isolated from every other hostel at the
database level.

| Area                     | What it does                                                                                                | Epic(s)          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------- |
| Accounts                 | Owner sign-up with email confirmation, login, password reset, staff accounts, role checks                   | EP-02            |
| Hostels                  | Two-step onboarding, settings, a switcher for owners with several hostels, suspension                       | EP-03, E10-T6    |
| Rooms and beds           | Rooms with capacity, beds generated automatically, bulk room ranges, bed status (blocked, maintenance)      | EP-04            |
| Residents                | Records with KYC (ID number never stored in full), duplicate detection, lifecycle, ID proof files           | EP-05            |
| Allocation and occupancy | Allocate, transfer and vacate with no double booking, occupancy views and trend                             | EP-06            |
| Fees                     | Rates, monthly invoices, fee heads, charges, discounts, late fees, credit, deposits, cheques, electricity   | EP-07, EP-13     |
| Online rent              | Payment links and QR codes on the hostel's own Razorpay account, webhook-recorded, reconciliation           | E13-T10          |
| Dashboard and reports    | KPIs, occupancy trend, work queue, collections, dues ageing, CSV exports                                    | EP-08, E13-T12   |
| Complaints               | Complaints by room or area, routing to staff or vendors, job links for outside workers, targets, costs      | EP-15            |
| Resident self-service    | Report a problem from a QR code in the room, SMS code, status link, confirm or reopen the fix               | E15-T3, T4       |
| Platform admin           | MFA-only admin area: customers, read-only support view, suspension, audit log, announcements, data requests | EP-10            |
| Subscription billing     | Plans, trial, limits, Razorpay subscriptions, GST invoices, dunning, read-only mode, coupons, revenue       | EP-14, E10-T7    |
| Data protection (DPDP)   | Data export, resident erasure, account closure, legal pages                                                 | E10-T10, E14-T11 |

## 2. Technology

| Layer      | Choice                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------- |
| Framework  | Next.js 15 App Router with React 19, server components and server actions; Turbopack builds |
| Language   | TypeScript, `strict`                                                                        |
| Styling    | Tailwind CSS v4, a small in-house component set in `src/components/ui`                      |
| Database   | Supabase: PostgreSQL 17, Auth (with TOTP MFA), Storage, pg_cron, pgcrypto                   |
| Validation | Zod schemas in `src/lib/validation`                                                         |
| Payments   | Razorpay (subscriptions for the platform; payment links on each hostel's own account)       |
| Messaging  | SMS through MSG91 (DLT templates), email through Resend; both optional                      |
| Tests      | Vitest (unit, RLS, integration), Playwright (desktop and mobile, axe accessibility scans)   |
| Hosting    | Vercel (region `bom1`, Mumbai) and a hosted Supabase project                                |
| Tooling    | ESLint 9, Prettier, Husky + lint-staged pre-commit, GitHub Actions CI                       |

## 3. Directory map

```
.
├── docs/                    Topic documents (see section 10)
├── scripts/
│   ├── admin/grant-admin.mts    Grant or revoke the platform-admin role (service role)
│   ├── clickup/                 Mirror of the ClickUp plan: plan-NN.ndjson, sync script
│   ├── staging/                 Applies auth settings and email templates to staging
│   ├── env-local.mjs            Writes .env.local from the running local Supabase
│   └── seed.mts                 Demo hostel with residents, invoices, complaints, admin
├── src/
│   ├── app/                 Routes (App Router)
│   │   ├── (auth)/              login, signup, forgot/reset password
│   │   ├── (app)/               the hostel app: dashboard, rooms, residents, occupancy,
│   │   │                        fees, complaints, reports, settings (incl. billing, payments)
│   │   ├── (admin)/admin/       platform admin area (MFA required)
│   │   ├── api/webhooks/        billing (platform Razorpay) and payments/[token] (hostel Razorpay)
│   │   ├── api/cron/outbox      sends queued SMS and emails
│   │   ├── job/[token]          outside worker's job page (no account)
│   │   ├── r/[token]            resident reports from the room QR code (no account)
│   │   ├── c/[token]            resident's complaint status link (no account)
│   │   ├── legal/               terms, privacy, refunds, contact
│   │   └── pay/thanks           where a resident lands after paying a rent link
│   ├── components/          Shell (app, admin, banners, footer) and UI primitives
│   ├── features/<area>/     Per-area code: actions.ts (server actions), queries.ts
│   │                        (typed reads), components/, options.ts (labels)
│   ├── lib/                 Cross-cutting: auth guards, Supabase clients, validation,
│   │                        logger, money, billing (Razorpay client, webhooks, pricing),
│   │                        crypto (secret box), sms, email, outbox, qr, images, legal
│   ├── middleware.ts        Session refresh, request ids, protected-route redirects
│   ├── instrumentation.ts   One JSON log line per unhandled server error
│   └── types/               database.ts (generated) and domain.ts (hand-written model)
├── supabase/
│   ├── migrations/          The only source of schema truth (29 files)
│   ├── templates/           Auth email templates
│   └── config.toml          Local stack configuration
└── tests/
    ├── unit/                Pure logic, no database
    ├── rls/                 Cross-tenant and role access rules, through real user sessions
    ├── integration/         Database behaviour, money and bed integrity, billing, schema guards
    ├── e2e/                 Browser journeys on desktop and mobile, accessibility scans
    └── support/             Fixtures: user factory, fee builders, TOTP, mail catcher
```

## 4. How a request flows

1. **Middleware** (`src/middleware.ts`) refreshes the Supabase session,
   mints an `x-request-id`, and sends signed-out visitors away from app
   routes.
2. **Layouts and pages** check again (`requireUser`, `requireActiveHostel`,
   `requirePlatformAdmin`) and read data with the user's own Supabase
   client, so row-level security decides what comes back.
3. **Server actions** validate input with Zod, call `requireRole` first,
   then call the database, usually a function (`rpc`) because anything that
   touches several rows must be one transaction.
4. **The database** enforces the real rules: tenancy, roles, integrity,
   money, read-only mode and plan limits. Business-rule errors raise
   `P0001` with a `hint`; actions map hints to plain messages, and
   `unexpectedFailure` explains read-only and plan-limit errors everywhere.
5. **Errors** the user cannot fix show a generic message with a reference;
   the server logs one scrubbed JSON line (no personal data or secrets).

Pages for people without accounts (worker job links, resident reporting,
status links) never let the browser reach the database: the server calls
service-role-only functions that check the token themselves.

## 5. Database design

Read [database.md](database.md) before writing a migration. The essentials:

- **Tenancy.** Every business table has `hostel_id` and row-level security
  using `private.user_hostel_ids()` / `private.user_owned_hostel_ids()`.
  Children reference parents with composite keys `(hostel_id, id)`, so a
  row can never point into another hostel.
- **Functions for multi-row writes**, `security invoker` by default;
  `security definer` functions live in the `private` schema with a pinned
  `search_path`. Views are `security_invoker`.
- **Money is integer paise.** Dates follow Asia/Kolkata. Derived state
  (occupancy, invoice status, whether an account may write) is computed at
  read time, never stored.
- **History is never deleted**: rooms are archived, allocations closed,
  invoices and payments voided with a reason; audit and subscription
  histories are immutable.
- **Schema guards** (`tests/integration/schema-guards.test.ts`) fail CI if a
  table lacks RLS, a view lacks `security_invoker`, a definer function sits
  in `public`, a function lacks a pinned `search_path`, `anon` gains a
  privilege, or a tenant table misses the read-only trigger.

Migration groups, in order:

| Migrations (2026-10-…)                   | Content                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| 07: foundation, profiles, hostels        | Helpers, roles, tenancy root, onboarding                                    |
| 08: rooms/beds, residents, allocations   | Inventory, KYC, stays, ID proof storage                                     |
| 10–12: allocation flows, fees, dashboard | Allocate/transfer/vacate, invoices and payments, read models, audit fixes   |
| 13: document numbers … reports           | EP-13 fee structure: heads, charges, credit, deposits, cheques, electricity |
| 14: complaints, jobs, maintenance        | EP-15 complaints, routing, job links, schedules, reports                    |
| 15: platform admin, data protection      | EP-10 admin functions and audit log, DPDP export/erasure/closure            |
| 16: plans/subscriptions, billing gateway | EP-14 billing and E10-T7                                                    |
| 16: online rent collection               | E13-T10                                                                     |
| 16: resident complaints                  | E15-T3, T4                                                                  |

Scheduled jobs (pg_cron): late fees (daily), complaint escalation (15 min),
billing transitions and reminders (hourly), closing unconfirmed resident
complaints (hourly), purging expired resident codes (daily).

## 6. Security model in one page

- **Authentication:** Supabase Auth; owners confirm their email; platform
  admins must use TOTP MFA (`aal2`), checked in the database on every admin
  call.
- **Authorization:** roles `owner`, `staff`, `platform_admin` are never
  writable by users. Pages, actions and database functions each check.
- **Isolation:** RLS plus composite foreign keys; an RLS suite proves
  cross-hostel reads and writes fail for every table.
- **Secrets:** server-only env vars; owners' Razorpay keys are encrypted
  with AES-256-GCM before storage and are not selectable by signed-in
  users; full ID numbers are never stored (last 4 + keyed hash).
- **Capability links** (job, room, status) are long random tokens; codes
  and session tokens are stored only as hashes; rate limits live in the
  database.
- **Webhooks** are accepted only with a valid HMAC signature over the raw
  body and an event id, and each event applies once.
- **Logging** scrubs phone numbers, emails, ID numbers, tokens and keys.
- **Headers:** security headers are set in `next.config.ts`.

## 7. Billing and access (EP-14)

Owners start a 14-day trial with their first hostel, then pay for a plan
through Razorpay; prices exclude GST and are configurable at
`/admin/billing`. An unpaid account becomes **read-only**, never deleted:
reads, printing, export and DPDP rights keep working. Plan limits (beds,
hostels, staff) are enforced by triggers. Details:
[billing.md](billing.md), proposal: [pricing.md](pricing.md).

## 8. Testing and quality gates

| Command                | What runs                                                      |
| ---------------------- | -------------------------------------------------------------- |
| `npm run lint`         | ESLint, zero warnings in the pre-commit hook                   |
| `npm run typecheck`    | `tsc --noEmit`                                                 |
| `npm run format:check` | Prettier                                                       |
| `npm run test:unit`    | 170 unit tests                                                 |
| `npm run test:db`      | 400 RLS and integration tests against local Supabase           |
| `npm run test:e2e`     | Browser tests on desktop and mobile against a production build |
| `npm run db:lint`      | Supabase schema lint (warnings fail CI)                        |

CI (`.github/workflows/ci.yml`) runs all of these on every pull request,
from an empty database, and checks that `src/types/database.ts` is current.

## 9. Environments and what still needs accounts

The app runs fully on a laptop with only Docker: `npm install`,
`npm run db:start`, `npm run env:local`, `npm run dev`, optionally
`npm run db:seed`. Everything below is optional locally and is a
**placeholder until you provide it**:

| Needed for                           | Values                                                                                                           | Where it is explained                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Staging/production database and auth | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, SMTP                   | [staging.md](staging.md)                                  |
| Hostel ERP's own billing             | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; seller GSTIN at `/admin/billing`            | [billing.md](billing.md)                                  |
| Hostels' online rent                 | `PAYMENT_KEYS_ENCRYPTION_KEY` (generate once), `NEXT_PUBLIC_SITE_URL`; each owner's own Razorpay keys in the app | [online-payments.md](online-payments.md)                  |
| Resident SMS                         | `SMS_PROVIDER=msg91`, `MSG91_AUTH_KEY`, two DLT template ids                                                     | [resident-complaints.md](resident-complaints.md)          |
| Platform emails                      | `RESEND_API_KEY`, `EMAIL_FROM`                                                                                   | [resident-complaints.md](resident-complaints.md)          |
| Scheduled delivery                   | `CRON_SECRET`                                                                                                    | [resident-complaints.md](resident-complaints.md)          |
| Legal pages                          | `LEGAL_*` business details                                                                                       | [billing.md](billing.md)                                  |
| ClickUp sync                         | `CLICKUP_API_TOKEN` (rotate the one shared in chat)                                                              | [scripts/clickup/README.md](../scripts/clickup/README.md) |

Decisions waiting on you: final prices and limits ([pricing.md](pricing.md)),
whether to enforce feature flags per plan, a chartered accountant's check
of GST rate, SAC code and place of supply, a lawyer's review of the legal
pages and retention periods, and the worker-network option
([worker-network.md](worker-network.md)).

## 10. Topic documents

| Document                                            | Covers                                                     |
| --------------------------------------------------- | ---------------------------------------------------------- |
| [database.md](database.md)                          | Conventions every migration follows, per-area data rules   |
| [staging.md](staging.md)                            | Standing up and releasing to Vercel and hosted Supabase    |
| [admin.md](admin.md)                                | Platform admins, MFA, audit log, support view, suspension  |
| [data-protection.md](data-protection.md)            | DPDP Act: export, erasure, closure, retention              |
| [billing.md](billing.md) / [pricing.md](pricing.md) | Subscription billing and the pricing proposal              |
| [online-payments.md](online-payments.md)            | Rent collection on each hostel's own Razorpay account      |
| [resident-complaints.md](resident-complaints.md)    | Room QR codes, SMS codes, status links, SMS setup          |
| [worker-network.md](worker-network.md)              | Options for a platform-supplied worker network (discovery) |

## 11. Project tracking and branches

**ClickUp is the source of truth for task status.** The plan is mirrored in
`scripts/clickup/plan-NN.ndjson` (one JSON object per task: key, epic,
estimate, dependencies, acceptance criteria). `sync-plan.ps1` creates
missing tasks; it cannot change statuses, so completed tasks are marked by
hand in ClickUp.

| Epic                                      | Status in this repository                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| EP-01 … EP-09 (MVP)                       | Done and merged to `main` (pull requests 1 to 12)                                                                              |
| EP-10 Platform super admin                | Done: E10-T1 … T6, T8 … T12 on `feat/ep-10-admin`; E10-T7 on `claude/brave-curie-vjarkk`                                       |
| EP-11 Notifications                       | Not detailed in the plan yet; SMS and email delivery groundwork exists                                                         |
| EP-12 Advanced ERP                        | Not detailed in the plan yet                                                                                                   |
| EP-13 Fee structure and online collection | Done: T1 … T9, T11, T12 (pull request 16); T10 on `claude/brave-curie-vjarkk`                                                  |
| EP-14 SaaS subscription billing           | Done: T1 … T12 on `claude/brave-curie-vjarkk` (waiting on accounts, see section 9)                                             |
| EP-15 Complaints                          | Done: T1, T2, T5 (private storage), T6 … T14 (pull request 17); T3, T4 and T5's photo shrinking on `claude/brave-curie-vjarkk` |

Open work sits in a **stack of branches**, each built on the one before:

```
main
 └─ fix/audit-round-2        (PR 13)
     └─ fix/row-cap           (PR 15)
         └─ feat/ep-13-fees    (PR 16)
             └─ feat/ep-15-complaints (PR 17)
                 └─ feat/ep-10-admin  (no PR yet)
                     └─ claude/brave-curie-vjarkk  (+ docs/backlog-epics, PR 14, merged in)
```

Merging them in that order (or merging `claude/brave-curie-vjarkk`, which
contains all of them) brings `main` up to date.

---

## 12. Session log

Each working session appends what it did, with the date.

### 2026-10-15: backlog completion session (branch `claude/brave-curie-vjarkk`)

**Starting point.** ClickUp could not be reached from this environment (no
ClickUp connector, and `api.clickup.com` is blocked by the network policy),
so the plan was read from its repository mirror in `scripts/clickup/`,
including the newer plan files on `docs/backlog-epics` (pull request 14).
Comparing the plan with the code and the open pull requests showed:

- MVP (EP-01 to EP-09): complete on `main`.
- Open stack: PR 13 (audit fixes), PR 15 (1000-row cap fix), PR 16
  (EP-13), PR 17 (EP-15) and `feat/ep-10-admin` (EP-10, no PR).
- Not yet built: all of EP-14 (12 tasks), E10-T7 (needs EP-14), E13-T10
  (online rent collection), E15-T3 and E15-T4 (resident reporting and
  tracking), and image resizing from E15-T5. EP-11 and EP-12 have no
  detailed tasks in the plan, so nothing was invented for them.

**Environment set-up.** Installed Node 24 (the version `.nvmrc` pins),
started Docker and the local Supabase stack (images from Docker Hub because
the default registry's CDN is blocked here), and ran the existing suites to
get a baseline: lint, typecheck, format, 139 unit tests and 328 database
tests passed; the browser suite passed except three desktop timeouts that
passed on re-run (machine load, not code).

**Branch.** `claude/brave-curie-vjarkk` was reset onto the top of the stack
(`feat/ep-10-admin`) and `docs/backlog-epics` was merged in, so the branch
contains every open piece of work plus this session's.

**Work done, in commit order:**

1. `feat(billing): plans, subscriptions, limits, read-only mode and gateway
events` (EP-14 database, E10-T7 functions): plans priced flat, per bed
   or in tiers; one subscription per owner with an immutable history; a
   trial starting with the first hostel; plan limits as triggers;
   read-only mode on every tenant table; Razorpay events applied once; GST
   invoices and credit notes numbered per financial year; dunning and trial
   reminders by an hourly job; coupons; admin plan, coupon, settings and
   account adjustments; revenue metrics; terms acceptance. 36 integration
   and 7 RLS tests, and a new schema guard.
2. `feat(billing): billing page, Razorpay checkout and webhooks, admin
billing, legal pages` (EP-14 app, E10-T7 UI): `/settings/billing`, tax
   invoice pages, the trial and read-only banner, `/api/webhooks/billing`,
   `/admin/billing`, revenue on the admin overview, plan and billing on
   owner pages, legal pages and the sign-up terms checkbox,
   `docs/billing.md` and `docs/pricing.md`. Unit and browser tests.
3. `feat(fees): online rent collection through the hostel's own Razorpay
account` (E13-T10): encrypted owner keys, payment links with QR codes
   and WhatsApp sharing, a per-hostel signed webhook recording payments
   once (extra money to credit, refunds mirrored), Fees → Online
   reconciliation, `docs/online-payments.md`. 14 integration tests, unit
   tests and a browser test replaying signed webhooks.
4. `feat(complaints): residents report from a room QR code, follow it by
SMS and confirm the fix` (E15-T3, T4, T5): room QR codes and a print
   card, SMS one-time codes with neutral answers and rate limits, short
   resident sessions, status links, confirm with a rating or reopen,
   automatic closing, SMS updates at each step, in-browser photo
   shrinking, an SMS/email outbox delivered after staff actions and by a
   cron endpoint, `docs/resident-complaints.md`. 12 integration tests,
   unit tests and a browser journey.
5. `docs: repository guide and session log` (this document) and the
   ClickUp mirror's status notes.

**Results at the end of the session.** Lint, typecheck, format and schema
lint clean; 170 unit tests and 400 database tests pass; the browser tests
for every new feature pass on desktop and mobile, as do the existing fee,
complaint, room, auth, admin and accessibility suites.

**Placeholders left for you** (nothing secret is committed; see section 9):
Razorpay keys for Hostel ERP's own billing; the encryption key and site URL
for hostels' rent collection; MSG91 key and DLT template ids for resident
SMS; Resend key for emails; `CRON_SECRET`; `LEGAL_*` business details;
seller GSTIN and address at `/admin/billing`; the staging Supabase and
SMTP values from `docs/staging.md`.

**Things to know.**

- Prices in `docs/pricing.md` are proposals; the code reads them from the
  database, so changing them needs no deploy.
- Two gateway behaviours must be checked in the Razorpay sandbox before
  live payments: how an immediate subscription upgrade is charged, and the
  exact webhook payloads (the code follows Razorpay's documented shapes).
- The MSG91 Flow API payload in `src/lib/sms/provider.ts` should be checked
  against MSG91's current documentation when the account is opened.
- Vercel's Hobby plan allows cron jobs once a day, so `/api/cron/outbox`
  runs daily; SMS are also sent immediately after each staff action.
- `npm audit` reports a high-severity advisory in `braces`, pulled in only
  by `eslint-config-next` (a development dependency). It does not ship to
  users; it clears when Next's ESLint config updates its dependency.
- ClickUp statuses were not changed (no access). Mark these done in
  ClickUp: E10-T7, E13-T10, E14-T1 to E14-T12, E15-T3, E15-T4, E15-T5.
- No pull request was opened for this branch; open one when you want it
  reviewed (it contains the whole stack).
