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

## Phase 2: platform admin hardening (ClickUp EP-10)

Database work is in `supabase/migrations/20261020090000_admin_hardening.sql`.
How to add, remove and recover admins is in [`admin.md`](admin.md).

### Admins confirm sign-in with an authenticator (ClickUp "Bootstrap platform admins with MFA")

- **What:** every admin function now requires a second factor (`aal2`).
  `private.require_platform_admin()` refuses a password-only session with
  `mfa_required`. Admin pages send such a session to `/admin/mfa`, which sets
  up an authenticator app the first time (QR code or typed key) and asks for
  the 6-digit code after that.
- **Admin accounts:** `scripts/grant-admin.mts` gained `--revoke` (back to a
  plain owner account) and `--reset-mfa` (lost phone). Both remove the
  authenticator and end every session, through a new service-role-only
  `account_sign_out()`.
- **Config:** TOTP is switched on in `supabase/config.toml`. On a hosted
  project it must also be switched on in the Supabase dashboard (noted in
  `admin.md`).
- **Files:** `src/app/admin/mfa/page.tsx`, `src/features/admin/components/MfaForm.tsx`,
  `src/features/admin/queries.ts` (`requirePlatformAdmin`), `scripts/grant-admin.mts`,
  `docs/admin.md`.
- **Tests:**
  - `tests/rls/admin-security.test.ts` checks that an admin without the second
    factor is refused by every admin function.
  - `tests/support/totp.ts` produces real TOTP codes for tests.
  - `tests/e2e/helpers.ts` (`completeAdminMfa`) sets up the authenticator in
    the browser the way a person would.

### Immutable admin audit log (ClickUp "Record every admin action in an immutable audit log")

- **What:** `admin_audit_log` records each admin action, with names and
  e-mails snapshotted so entries stay readable later:
  - who did it;
  - what, to which hostel or account;
  - why;
  - the details (e.g. plan from → to).
- **How:**
  - Entries are written only inside the admin functions.
  - A trigger refuses every update and delete, even from the service role.
  - The table has no foreign keys, so no cascade can touch it.
- **Reasons required for:** plan changes, suspending and restoring (restoring
  needed none before), opening the support view, signing an account out
  everywhere, and the e-mail support actions.
- **Screens:** `/admin/audit`, filtered by admin and date range, and per
  hostel from each hostel page. The plan and suspend forms now ask for a
  reason.
- **Files:** `src/app/admin/audit/page.tsx`, `src/features/admin/components/AuditTable.tsx`,
  `PlanForm.tsx`, `SuspendForm.tsx`, `src/features/admin/actions.ts`.
- **Tests:**
  - `tests/integration/admin-console.test.ts` ("audit log").
  - `tests/rls/admin-security.test.ts`: tables closed to users; entries
    immutable against the service role.
  - `tests/e2e/admin.spec.ts`.

### Customer directory (ClickUp "Customer directory: owners, hostels and usage")

- **What:** `/admin/owners` lists every owner with:
  - whether their e-mail is confirmed, their last sign-in, and when they
    signed up;
  - their active and half-set-up hostels;
  - who referred them.
- **Search:** matches name, e-mail, phone, or a hostel's name or city.
  Searching and paging both happen in the database (`admin_owners()`), and
  search text is matched literally.
- **Hostel list:** `/admin` can now be filtered by search, plan and status.
- **Files:** `src/app/admin/owners/page.tsx`, `src/app/admin/owners/[id]/page.tsx`,
  `src/app/admin/page.tsx`.
- **Tests:** `tests/integration/admin-console.test.ts` ("owner directory").

### Read-only support view (ClickUp "Read-only support view into a hostel, shown to its owner")

- **What:** from a hostel page, an admin gives a reason and opens
  `/admin/hostels/<id>/support`. It shows the hostel's rooms and beds,
  residents and fees, read-only, for one hour.
- **Privacy:**
  - Phone and ID numbers show only their last four digits.
  - ID proof files cannot be opened.
  - Admins are still members of no hostel: the snapshot comes from an
    admin-only function, and the tenant tables stay closed, for reading and
    writing.
- **Owner notice:** the owner sees each opening, with the admin's name and
  reason, under Settings → Hostel → Support access.
- **Files:** `src/app/admin/hostels/[id]/support/page.tsx`,
  `src/features/admin/components/SupportForms.tsx`, `src/app/(app)/settings/hostel/page.tsx`.
- **Tests:** `tests/integration/admin-console.test.ts` ("support view"), `tests/e2e/admin.spec.ts`.

### Account support actions without passwords (ClickUp "Account support actions without seeing passwords")

- **What:** on an owner's page, an admin can do any of these, each with a
  reason and an audit entry:
  - send a password reset link;
  - resend the sign-up confirmation;
  - sign them out of every device (their sessions are deleted, so no refresh
    works).
- **Never possible:** admins cannot set or see a password, and other admins
  cannot be targeted.
- **Not done:** changing an owner's e-mail address. The owner changes it from
  their own account.
- **Files:** `src/features/admin/actions.ts` (`runSupportAction`), `src/app/admin/owners/[id]/page.tsx`.
- **Tests:** `tests/integration/admin-console.test.ts` ("support actions"), `tests/e2e/admin.spec.ts`.

### Platform announcements (ClickUp "Platform announcements to owners")

- **What:** admins publish a message, optionally with a "show until" date,
  from `/admin/announcements`. Every signed-in owner and staff member sees it
  as a banner until it ends or they dismiss it. Dismissals are stored per
  user, so they hold across devices.
- **Files:** `src/features/announcements/*`, `src/app/(app)/layout.tsx`,
  `src/app/admin/announcements/page.tsx`, `src/features/admin/components/AnnouncementForms.tsx`.
- **Tests:** `tests/integration/admin-console.test.ts` ("announcements"), `tests/e2e/admin.spec.ts`.

### Download all hostel data (part of ClickUp "Handle data export and erasure requests")

- **What:** Settings → Hostel → "Download data" gives the owner one JSON file
  covering the hostel's rooms, beds, residents, stays, rates, invoices,
  payments and deposit entries, read past the 1000-row cap.
- **Not done (needs a lawyer):** closing an account with scheduled deletion
  after a retention period. That needs the retention periods confirmed first.
- **Files:** `src/app/(app)/settings/hostel/export/route.ts`.

### Admin security tests (ClickUp "Prove that tenants can never reach admin functions")

- **What:** `tests/rls/admin-security.test.ts` calls all 15 admin functions as
  an owner, a staff member, a signed-out visitor, and an admin without the
  second factor. Every call is refused, and the test then checks that
  nothing changed.

### Bug caught by the new tests

- **An announcement stayed live after it was ended.** Ending set the end time
  to one second after the start, so an announcement ended within a second of
  being published stayed visible for that second. It now ends at the current
  time.

## Phase 3: resident fees (ClickUp EP-13)

### Sequential invoice and receipt numbers (ClickUp E13-T9)

- **What:** invoices and receipts are numbered in a series per hostel per
  Indian financial year, e.g. `INV/26-27/00001` and `RCT/26-27/00001`, at
  most 16 characters. Before this, the number shown was the first 8
  characters of the record id.
- **How:**
  - A trigger gives each new invoice and payment the next number from a
    per-hostel counter row (`document_counters`). The row stays locked until
    the transaction ends, so concurrent inserts never share or skip a number,
    and a rolled-back insert rolls its counter back.
  - The number triggers run after the guards, so a refused payment (e.g.
    overpayment) uses up no number.
  - Users cannot write a number; anything sent is replaced.
  - A void invoice keeps its number, and generating the month again takes a
    new one.
  - Existing invoices and payments were numbered in the order they were
    created.
- **Not done (needs a CA):** GST tax lines (rate and SAC code). They wait for
  a chartered accountant to confirm how hostel rent is taxed.
- **Screens:**
  - Printed invoices and receipts, and the invoice page, show the numbers.
  - The fee list shows each invoice's number.
  - Payments on an invoice show their receipt numbers.
- **Files:** `supabase/migrations/20261021090000_document_numbers.sql`,
  `src/features/fees/queries.ts`, `components/InvoiceDocument.tsx`,
  `src/app/(app)/fees/page.tsx`, `fees/[id]/page.tsx`.
- **Tests:** `tests/integration/document-numbers.test.ts`:
  - series per hostel;
  - 12 concurrent inserts get 00001 to 00012 exactly;
  - a void invoice keeps its number, and a sent number is ignored;
  - `generate_invoices` invoices are numbered;
  - a refused payment takes no number.

### Fee heads and itemised invoices (ClickUp E13-T1)

- **What:** owners add charge types besides rent in Settings → Fees → Other
  charges:
  - monthly ones (mess, maintenance), billed on every monthly invoice for the
    nights held;
  - one-time ones (admission, a key).
- **Prices:** per sharing type, or one price for all, from a date. As with
  rent, setting a new price closes the old one, and price ranges never
  overlap.
- **Opting out:** a stay can be excluded from a monthly charge (e.g. a
  resident who skips the mess), from the resident page.
- **Itemised invoices:**
  - Monthly invoices are now itemised in `invoice_lines`: a rent line,
    monthly charges, discounts (negative) and pending charges.
  - A commit-time constraint trigger refuses an invoice whose lines do not
    add up to its amount, and lines can never be changed.
  - Rent itself is computed exactly as before, so all existing billing tests
    pass unchanged.
- **How:** `generate_invoices` is now an owner-checked `SECURITY DEFINER`
  function, because it writes lines and marks charges billed. Staff still get
  `42501` and strangers `hostel_not_found`, as before.
- **Screens:** printed invoices show each line, with the stays under the rent
  line, and the invoice page shows "What it is for".
- **Files:** `supabase/migrations/20261022090000_fee_heads.sql`, `src/features/charges/*`,
  `src/app/(app)/settings/fees/page.tsx`, `src/features/fees/components/InvoiceDocument.tsx`,
  `src/app/(app)/fees/[id]/page.tsx`, `src/features/fees/queries.ts`.

### One-time and ad-hoc charges (ClickUp E13-T2)

- **What:** owners and staff add a charge to a resident (description, amount,
  date, optional type).
- **Pending charges:**
  - The next monthly invoice picks them up.
  - The owner can "Bill pending charges now" as an invoice of their own, due
    today.
  - Before they are billed, the owner can void them with a reason.
  - Voiding an invoice frees its charges for the next one.
- **Admission fee:** a one-time type marked "charge on first bed" is added
  automatically when a resident first gets a bed.
- **Erasing:** a resident with pending charges cannot be erased (`erase_pending_charges`).
- **Files:** `src/features/charges/components/ResidentCharges.tsx`,
  `ResidentChargeForms.tsx`, `ReasonDialog.tsx`, `src/app/(app)/residents/[id]/page.tsx`,
  `src/features/data-rights/actions.ts`.

### Metered electricity per room (ClickUp E13-T3)

- **What:**
  - The owner sets a price per unit in Settings → Fees.
  - Owners or staff record each room's meter reading at month end, on
    Fees → Electricity.
  - "Add electricity charges" turns each room's units × price into charges.
    They are split among the room's residents by nights held, with the last
    share taking the rounding, and go on their next invoice.
- **Rules:**
  - A reading lower than the previous one, or higher than the next, is
    refused.
  - A room's first reading is a starting point and bills nothing.
  - An occupied room without a reading is listed, never billed as zero.
  - Each room is billed once per month, and a billed reading cannot change.
- **Files:** `src/app/(app)/fees/electricity/page.tsx`,
  `src/features/charges/components/ElectricityForms.tsx`.

### Discounts and concessions (ClickUp E13-T5)

- **What:** owners give a resident a percentage or fixed discount on rent or
  on one monthly charge, for a range of months, with a reason. Staff can see
  discounts but not create them.
- **Rules:** on each monthly invoice, discounts apply oldest first and never
  take a line below zero. Ending a discount is a void with a reason.
- **Not done:** the monthly report of discounts given. It comes with the
  collection reports.

### Tests

- `tests/integration/fee-heads.test.ts` (13 cases), covering:
  - head prices per type and for all types;
  - proration and opt-outs;
  - lines adding up at commit, and lines being immutable;
  - pending charges, billing them, and releasing them when an invoice is
    voided;
  - "bill now", and the admission fee on the first stay only;
  - discount caps and owner-only discounts;
  - electricity shares, idempotency, billed-reading lock, lower readings,
    missing readings, and no unit price set;
  - the erase guard.
- `tests/unit/charges.test.ts`.
- `tests/e2e/charges.spec.ts`.

### Fix: the occupancy trend re-read stays once per day

`occupancy_trend` counted occupied beds per day with a subquery over the
stays. Depending on the table statistics of the moment, Postgres re-read
the allocations, and re-checked row-level security, once for every day in
the range. The new insert trigger on allocations changed when the
statistics were refreshed after a bulk insert. That was enough for the
"500 beds, 2000 stays" timing test to pass alone before the change and then
take about 1.6 s every time after it, against a 1.5 s limit.

The beds and stays are now `MATERIALIZED`, so each is read once. The test
passes again.
