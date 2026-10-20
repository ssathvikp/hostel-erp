# How the code works

Six flowcharts of Hostel ERP:

1. How a request moves through the app.
2. How a form saves.
3. Where code lives.
4. How a hostel's money flows.
5. Who can reach what.
6. How a change is checked.

The data model is in [database.md](database.md) and the admin console in
[admin.md](admin.md).

The stack is Next.js 15 (App Router, server components and server actions) on
Supabase: Postgres, Auth and Storage. Most of the rules live in the database,
so the app cannot get around them.

## 1. A page request

```mermaid
flowchart TD
  B[Browser] --> M["src/middleware.ts<br/>updateSession: refresh cookies, add request id"]
  M -->|signed out, protected path| L["/login?next=..."]
  M -->|signed in, on /login or /signup| D[/dashboard/]
  M --> R{App Router route group}
  R --> A["(auth)<br/>login, signup, forgot/reset password, welcome"]
  R --> APP["(app)<br/>dashboard, rooms, residents, occupancy,<br/>fees, settings, onboarding"]
  R --> ADM["admin<br/>hostels, owners, metrics, audit,<br/>announcements, mfa"]
  APP --> G["requireActiveHostel / requireRole<br/>src/lib/hostels/active.ts, src/lib/auth/session.ts"]
  G -->|no hostel yet| ON[/onboarding/]
  G -->|hostel suspended| SU[/suspended/]
  ADM --> GA["requireUser + platform_admin role<br/>no TOTP (aal2) → /admin/mfa"]
  G --> Q["src/features/*/queries.ts"]
  GA --> Q
  Q --> SC["Supabase server client<br/>src/lib/supabase/server.ts (user's own session)"]
  SC --> PG[("Postgres<br/>row-level security on every table")]
  PG --> HTML[Server-rendered HTML back to the browser]
```

## 2. A form that saves something

```mermaid
flowchart TD
  F["Client component<br/>useActionState(form)"] --> SA["Server action<br/>src/features/*/actions.ts"]
  SA --> RR["requireRole(['owner','staff'])"]
  RR --> FH["formHostel(formData)<br/>which hostel the form is for"]
  FH --> V["validateFormData(zod schema)<br/>src/lib/validation/schemas.ts"]
  V -->|invalid| FE["formFailure(field errors)"]
  V --> W["insert / update, or supabase.rpc(...)"]
  W --> PUB["public function<br/>SECURITY INVOKER"]
  PUB --> PRIV["private function<br/>SECURITY DEFINER: checks owner, takes advisory locks"]
  W --> T["Triggers and guards<br/>numbering, overpayment, immutability, credit"]
  PRIV --> T
  T -->|"P0001 + hint"| RM["RULE_MESSAGES[hint]<br/>plain-language error"]
  T -->|other error| UF["unexpectedFailure: logged with request id"]
  T -->|ok| OK["formSuccess + revalidatePath"]
  RM --> F
  UF --> F
  OK --> F
  FE --> F
```

## 3. Where code lives

```mermaid
flowchart LR
  subgraph src
    APPR["src/app<br/>routes, pages, CSV/JSON export route handlers"]
    FEAT["src/features/*<br/>actions.ts · queries.ts · components/"]
    LIB["src/lib<br/>auth · supabase · validation · money ·<br/>pagination · csv · logger"]
    UI["src/components<br/>ui kit · app shell"]
    TYPES["src/types<br/>database.ts (generated) · domain.ts"]
  end
  DB["supabase/migrations<br/>tables, RLS, functions, triggers"]
  TESTS["tests<br/>unit · integration · rls · e2e"]
  APPR --> FEAT --> LIB
  APPR --> UI
  FEAT --> UI
  FEAT --> TYPES
  DB -->|npm run db:types| TYPES
  TESTS --> FEAT
  TESTS --> DB
```

The areas under `src/features` are:

- rooms, residents, allocations and occupancy;
- fees, charges, deposits and notifications (reminders);
- staff, dashboard, import, data-rights, referrals and announcements;
- admin, hostels and auth.

## 4. A hostel's money, start to finish

```mermaid
flowchart TD
  S["Owner signs up<br/>trial starts (platform_settings.trial_days)"] --> O["Onboarding: create hostel"]
  O --> RB["Rooms and beds"]
  RB --> RT["Rates per sharing type, fee heads,<br/>deposit rates, late-fee rule"]
  RT --> RS["Register resident<br/>(consent, ID proof)"]
  RS --> AL["Allocate bed<br/>allocate_bed() + optional security deposit"]
  AL --> GI["Generate invoices for a month<br/>generate_invoices(): rent + fee heads + charges<br/>− discounts + electricity → invoice_lines"]
  GI --> NUM["Invoice number per hostel per financial year"]
  NUM --> CR{"Resident has advance credit?"}
  CR -->|yes| AC["Credit applied automatically<br/>(payment with mode 'credit')"]
  CR -->|no| PAY
  AC --> PAY["record_payment()<br/>cash · UPI · bank · card · cheque"]
  PAY -->|more than due| ADV["Extra becomes advance credit"]
  PAY -->|cheque| CHQ["Pending until clear_cheque()<br/>bounced → void (+ bounce charge)"]
  PAY --> RCPT["Receipt number + printable receipt"]
  GI --> LATE["apply_late_fees() after the grace period"]
  GI --> REM["Reminders (WhatsApp link, logged)"]
  PAY --> REP["Dashboard + /fees/reports<br/>money in, dues by age, register, CSV"]
  CHQ --> REP
  AL --> VAC["Vacate / transfer<br/>deposit refund, data-rights export or erase"]
```

## 5. Who can reach what

```mermaid
flowchart LR
  OW["Owner"] --> H1["Own hostels: everything<br/>rates, invoices, voids, refunds, staff, reports"]
  ST["Staff"] --> H2["One hostel: day-to-day<br/>residents, allocations, payments, clearing cheques"]
  PA["Platform admin<br/>TOTP required (aal2)"] --> AD["Admin console<br/>plans, suspend/restore, support view,<br/>announcements: every action audited with a reason"]
  H1 --> RLS[("RLS policies<br/>+ column grants")]
  H2 --> RLS
  AD --> PRIVA["private.require_platform_admin()<br/>→ admin_audit_log (append-only)"]
  RLS --> GUARD["Schema guard test:<br/>no SECURITY DEFINER in public"]
```

## 6. How a change is checked

```mermaid
flowchart LR
  C[git commit] --> LS["lint-staged pre-commit<br/>eslint --max-warnings=0, prettier"]
  LS --> CHK["npm run lint · typecheck · format:check"]
  CHK --> U["Vitest unit<br/>pure logic: money, receipts, reports"]
  CHK --> DBT["Vitest db project<br/>integration + RLS against local Supabase"]
  CHK --> E2E["Playwright e2e<br/>desktop + mobile, real browser"]
  U --> PUSH[push]
  DBT --> PUSH
  E2E --> PUSH
```
