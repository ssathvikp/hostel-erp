# Changes, October 2026: ClickUp backlog work

Every change made while building the ClickUp backlog, one section per task:
what changed, why, where, and how it is tested. Bug fixes from the earlier
full review are in [`review-fixes.md`](review-fixes.md).

Task names are as they appear in ClickUp ("Backlog - Post-MVP"). Items marked
"plan" come from the repo's own plan files (`scripts/clickup/plan-11/12.ndjson`)
rather than ClickUp.

## Phase 1: growth features

All database work is in `supabase/migrations/20261019090000_growth.sql`. That
migration was pushed before its screens were built and has not been applied to
any hosted database yet, so it was corrected in place (twice, see "Bugs caught
by the new tests").

### Late fees with grace period and waiver (ClickUp E13-T6)

- **What:** each hostel can charge a late fee on rent paid late: a fixed amount,
  or an amount per day up to a cap, after a number of grace days.
- **How it works:**
  - The rule is stored on `hostels` (`late_fee_mode`, `late_fee_amount`,
    `late_fee_cap`, `late_fee_grace_days`). A trigger stamps `late_fee_since`
    when the rule is switched on, so turning it on never back-charges months
    that were late before the rule existed. Signed-in users cannot set that date.
  - A late fee is its own invoice (`invoices.kind = 'late_fee'`, with
    `late_fee_for` pointing at the rent invoice). The rent invoice never
    changes, and payments, balances, receipts and voids all work on it as they
    do for rent.
  - `apply_late_fees(hostel)` charges every late rent invoice once. A unique
    index allows one late fee per rent invoice, ever, so re-running it (or
    running it concurrently) adds nothing, and a waived fee is never charged
    again.
  - Lateness runs from the end of the grace period to the day the rent was
    paid in full, or to today while it is still owed. A fixed fee is charged as
    soon as rent is late. A per-day fee is charged once it is final: when the
    rent is paid, or when the fee reaches the cap.
  - Waiving is voiding the late-fee invoice with a reason. A rent invoice
    cannot be voided while its late fee still stands (`invoice_has_late_fee`).
  - `generate_invoices` and the "one invoice per resident per month" index now
    cover rent invoices only.
- **Screens:**
  - Settings → Fees has a "Late fees" section (owners edit, staff read).
  - /fees has "Add late fees now" for owners while the rule is on.
  - Fee lists, the resident page, payment dialogs and printouts label late
    fees as "June 2026 late fee".
  - The invoice page explains how the fee was reached, links rent and late fee
    both ways, and offers "Waive late fee".
- **Not done:** running it on a schedule. It is a button for now; a nightly job
  needs pg_cron or a hosted cron and can call the same function.
- **Files:**
  - `src/features/fees/actions.ts` (`saveLateFeeRule`, `applyLateFees`, waive message)
  - `src/features/fees/late-fees.ts`, `queries.ts`, `options.ts` (`invoiceLabel`)
  - `src/features/fees/components/LateFeeRuleForm.tsx`, `ApplyLateFeesForm.tsx`,
    `VoidDialog.tsx`, `InvoiceDocument.tsx`, `ResidentFees.tsx`
  - `src/app/(app)/fees/page.tsx`, `fees/[id]/page.tsx`, `settings/fees/page.tsx`,
    `residents/[id]/page.tsx`
  - `src/lib/validation/schemas.ts` (`lateFeeRuleSchema`), `src/types/domain.ts`
- **Tests:**
  - `tests/integration/late-fees.test.ts` (14 cases): the rule, idempotency
    under concurrency, grace days, paid-late, since-date, per-day waiting and
    cap, waiver, access, and no direct writes.
  - `tests/unit/late-fees.test.ts`.
  - `tests/e2e/late-fees.spec.ts`.

### Money-lost card on the dashboard (plan E15-T4)

- **What:** a "Money you are missing" panel at the top of the dashboard: what
  the empty beds would bring in each month at today's rates, and the overdue
  rent. It is shown only when either is above zero.
- **Why:** owners compare the fee with a free notebook; a rupee figure for what
  they lose makes the case.
- **How:** `vacancy_cost(hostel)` prices vacant beds at today's rate for their
  sharing type. Beds whose type has no rate are counted separately, never as
  zero.
- **Not done:** the monthly email to the owner. It needs an email provider.
- **Files:** `src/features/dashboard/queries.ts` (`getVacancyCost`),
  `src/features/dashboard/components/Sections.tsx`.
- **Tests:** `tests/integration/growth.test.ts` ("empty-bed cost"), `tests/e2e/growth.spec.ts`.

### Free trial length and set-up checklist (ClickUp "Free trial at sign-up", plan E15-T2)

- **What:**
  - The trial length is a platform setting (`platform_settings.trial_days`,
    default 30, was a hard-coded 90). Platform admins change it on
    /admin/metrics; trials already running keep their end date.
  - Owners see a "Get your hostel running" checklist on the dashboard until
    every step is done, with the days left in their trial.
  - The steps are: rooms, rates, residents in beds, a billed month, a payment.
- **Not done (needs an email provider):** trial reminder emails. Read-only mode
  when a trial ends is phase 4.
- **Files:** `src/lib/hostels/activation.ts`, `src/features/hostels/setup.ts`,
  `src/features/hostels/components/SetupChecklist.tsx`,
  `src/app/(app)/dashboard/page.tsx`, `src/features/admin/actions.ts`
  (`setTrialDays`), `src/features/admin/components/TrialDaysForm.tsx`.
- **Tests:**
  - `tests/integration/growth.test.ts` ("trial length").
  - `tests/rls/platform-admin.test.ts`, updated from 90 to 30 days.
  - `tests/unit/signals.test.ts` ("activation"), `tests/e2e/growth.spec.ts`.

### Platform metrics dashboard (ClickUp E10 "Platform metrics dashboard")

- **What:** /admin/metrics shows:
  - owner sign-ups per week (last 8 weeks), and how many finished set-up;
  - hostels active in the last 30 days;
  - beds, occupied beds and residents across the platform;
  - invoices and payments per month (last 6 months, counts and totals);
  - hostels on each plan, trial conversion, and paying hostels lost in the
    last 30 days.
- **How:** `admin_metrics()` is admin-only and returns aggregates with no
  hostel, owner or resident names. Plan changes are now logged in `plan_events`
  (written by trigger), which is what conversion and churn are computed from.
- **Not done:** MRR and subscriptions. They need billing (EP-14).
- **Files:** `src/app/admin/metrics/page.tsx`, `src/features/admin/queries.ts`
  (`getAdminMetrics`), `src/app/admin/layout.tsx` (Hostels / Metrics links).
- **Tests:** `tests/integration/growth.test.ts` ("admin metrics", including a
  check that no owner email appears), `tests/e2e/growth.spec.ts`.

### Needs-attention signals in /admin (plan E14-T13)

- **What:** the hostel list now starts with "Needs attention":
  - set-up unfinished 7 days after sign-up ("call the owner" after 21);
  - trial ending within 7 days, or ended without a plan;
  - nothing recorded for 14 days;
  - candidates for a bigger plan: owners with several hostels, or 100+ beds,
    not yet paying.
- **How:** `admin_hostels()` gained set-up, owner-hostel-count and referral
  columns. The rules live in one pure function, so they are unit-tested.
- **Files:** `src/features/admin/signals.ts`, `src/app/admin/page.tsx`,
  `src/app/admin/hostels/[id]/page.tsx` (set-up checklist and referral details).
- **Tests:** `tests/unit/signals.test.ts`, `tests/integration/growth.test.ts`.

### Owner referral codes (plan E14-T12)

- **What:**
  - Settings → Refer shows the owner's signup link with copy and WhatsApp share
    buttons, and counts of referred owners: signed up, set up, paying.
  - /signup?ref=CODE records who referred the new owner.
  - /admin lists referrers, and each hostel page shows who referred it.
- **How:**
  - A code is created the first time it is asked for: 8 characters, with no I,
    O, 0 or 1.
  - The signup trigger looks the code up and only ever uses it to find an
    existing owner. Metadata is client-controlled, so it is trusted for nothing
    else; a bad code is ignored.
  - Owners see counts only, never who signed up.
- **Not done:** crediting the free month automatically. It needs billing; the
  admin extends the plan by hand for now.
- **Files:** `src/features/referrals/*`, `src/app/(app)/settings/referrals/page.tsx`,
  `src/app/(app)/settings/SettingsTabs.tsx`, `src/features/auth/actions.ts`,
  `src/features/auth/components/SignupForm.tsx`, `src/app/(auth)/signup/page.tsx`.
- **Tests:** `tests/integration/growth.test.ts` ("referrals"), `tests/e2e/growth.spec.ts`.

### Bugs caught by the new tests

1. **Rule checks passed on NULL.** A per-day rule with no cap, or a rule with no
   amount, passed the CHECK constraints, because a check that evaluates to NULL
   counts as passing. The constraints now test `is not null` explicitly.
2. **Saving the trial length failed.** Supabase refuses an UPDATE without a WHERE
   clause (`21000`). The one-row update now says `where id`.
3. **New hostels failed for the service role.** The trial-length lookup was only
   granted to signed-in users, so hostels created by scripts and fixtures
   failed. The lookup returns a number of days, which is not sensitive, so it
   is now callable by every role.
