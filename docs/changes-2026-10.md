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

### Security deposit per sharing type (ClickUp E13-T4, the missing part)

- **What:** Settings → Fees → Security deposit holds the usual deposit for
  each sharing type.
- **At allocation:** the allocate-bed dialog now has an optional "Security
  deposit received now" amount and mode, with the usual amount as a hint, so
  the deposit is asked for when the bed is given. The amount can be changed
  for anyone.
- **How it is recorded:** a deposit entered there goes into the existing
  deposit ledger, against the new stay.
- **Files:** `supabase/migrations/20261023090000_credit_cheques.sql` (`deposit_rates`),
  `src/features/deposits/*`, `src/features/allocations/actions.ts`,
  `components/AllocateDialog.tsx`, `src/app/(app)/residents/[id]/page.tsx`,
  `src/app/(app)/rooms/[id]/page.tsx`.

### Advances and resident credit balance (ClickUp E13-T7)

- **The ledger:** `resident_credit_entries` is append-only. It holds advances
  (money in), credit applied to invoices, and refunds (money out). Held
  credit is derived and never goes negative, and entries for one resident
  are serialised.
- **Recording payments:** payments now go through `record_payment()`. A
  payment above what is due records the balance as a payment and the rest as
  an advance, in one transaction. A cheque cannot overpay, because credit
  must be money in hand.
- **Applying credit:**
  - Credit is applied automatically when an invoice is issued, as a payment
    of mode "Advance credit" with its own receipt number.
  - "Use credit on open invoices" applies credit recorded after the invoices
    were issued.
  - Voiding a credit payment gives the credit back.
  - Credit payments cannot be entered by hand.
- **Permissions:** staff record advances; only owners refund credit or void
  entries. A used advance cannot be voided, and a refund cannot exceed what
  is held.
- **Screens:**
  - The resident page has an "Advance credit" card.
  - The dashboard shows the total held.
  - Erasing waits until credit is refunded or used.
- **Files:** `src/features/fees/components/CreditForms.tsx`, `ResidentCredit.tsx`,
  `src/features/fees/actions.ts` (`recordPayment`, `recordCreditEntry`, `voidCreditEntry`,
  `applyCredit`), `src/features/dashboard/*`.

### Cheque payments with clearance (ClickUp E13-T11)

- **What:** "Cheque" is a payment mode, with cheque number and bank. A cheque
  is recorded as pending: it does not count as paid until it is marked
  cleared.
- **Pending cheques:**
  - They still count against what may be collected, so nobody collects
    twice.
  - The fee list shows "cheque pending", and the record-payment button
    offers only the rest.
  - Fees → Cheques lists them by deposit date.
- **Clearing:** owners and staff mark a cheque cleared, through
  `clear_cheque()`. Payments otherwise stay owner-only to change.
- **Bounced cheques:** "Bounced" voids the cheque with a reason, so the rent
  is due again, and can add a bounce charge that goes on the next invoice.
- **How "paid" is counted:** only cleared payments count, everywhere money is
  totalled: the invoice balance, receipts, the dashboard, the late-fee
  settlement date and the admin figures. Each of those functions was copied
  from its latest version with only that condition changed.
- **Files:** `src/app/(app)/fees/cheques/page.tsx`, `src/features/fees/components/ClearChequeButton.tsx`,
  `VoidDialog.tsx` (cheque variant), `PaymentDialog.tsx`, `receipt.ts`.

### Tests

- `tests/integration/credit-cheques.test.ts` (9 cases), covering:
  - deposit rates;
  - overpayment turning into credit;
  - credit applied on issue, and restored when its payment is voided;
  - no overpaying by cheque;
  - refunds and permissions, no credit payments by hand, and used advances
    that cannot be voided;
  - the erase guard;
  - a pending cheque that is not paid yet but blocks collecting again, then
    counts once cleared (dashboard included);
  - cheque number required, a bounced cheque voided, and cash that cannot be
    "cleared".
- `tests/unit/charges.test.ts`: cheque fields, and a pending cheque left out
  of receipt totals.
- `tests/e2e/credit-cheques.spec.ts`.
- `tests/e2e/fees.spec.ts` changed: it used to check that overpaying was
  refused, and now checks the advance-credit hint.

### Bug caught by a test

- **`apply_credit` broke the schema rule.** It was created as a `SECURITY
DEFINER` function in the exposed `public` schema, which the schema-guard
  test forbids. It now lives in `private` behind an invoker wrapper, like
  every other function.

## Phase 3d: collection reports and CSV exports (ClickUp E13-T12)

- **What:** a Fee reports page at `/fees/reports`, for owners only, with:
  - **Money in** for a date range (this month so far by default, a year at most),
    broken down by payment mode, by who collected it, and by day. Cheques count
    once cleared. Credit applied to an invoice is not counted, because it is not
    new money. Advances kept as credit are counted.
  - **Dues by age**: open balances grouped as not yet due, 1–30, 31–60, 61–90 and
    over 90 days late. Pending cheques still count as owed.
  - **Fee register** for a billing month: each live invoice by room, with billed,
    paid, owed and status.
  - **Discounts** given on the month's invoices.
  - A CSV download for each of the four (`/fees/reports/export?report=collections|dues|register|discounts`).
    Amounts are in rupees. The file starts with a byte-order mark so Excel reads
    ₹ and Indian names correctly. Text a spreadsheet would run as a formula gets
    a leading apostrophe.
- **Why:** owners asked for daily collection by mode and collector, dues ageing,
  and a monthly register they can hand to an accountant.
- **No migration.** Everything reads tables and views owners can already see.
  The page and the CSV share the same summaries, so their numbers agree.
- **Files:** `src/features/fees/reports.ts` (summaries, ageing, CSV writer,
  period parsing), `src/features/fees/report-queries.ts`,
  `src/app/(app)/fees/reports/page.tsx`, `src/app/(app)/fees/reports/export/route.ts`,
  and a Reports link on `/fees` for owners.
- **Tests:** `tests/unit/reports.test.ts` covers totals, age bucket edges, CSV
  quoting and formula defusing, and period defaults, swapping, the one-year cap
  and bad input. `tests/e2e/reports.spec.ts` checks the owner's view and CSV
  contents, and that staff are redirected from the page and get 403 on the
  downloads.

## Phase 3e: move-out settlement statement (ClickUp E13-T8)

- **What:** each closed stay gets "Settle move-out" in the resident's allocation
  history. That opens `/residents/[id]/settlement/[allocationId]`, where the
  owner:
  - **re-bills the final month** for the nights held, if its rent invoice was
    issued for more. The invoice is voided and issued again. This only happens
    when the invoice has no payments or live late fee; otherwise the page says
    why, so the owner can void those first.
  - **enters up to three deductions** from the deposit, each with a reason.
  - **chooses whether the deposit pays what is still due.** Each use is a payment
    of the new mode `deposit` on the invoice plus a matching deposit deduction
    (`deposit_entries.payment_id`). Voiding the payment gives the deposit back.
  - **sees a live summary** and picks how any refund is paid.
- **One transaction:** `settle_move_out` re-bills, applies held credit, takes the
  deductions, uses the deposit for dues, then refunds what is left of the deposit
  and the credit. It saves a statement in `settlements`, one per stay, never
  edited. The net figure is positive when the resident still owes and negative
  for a refund.
- **Statement:** once settled, the page shows a printable statement on the
  invoice letterhead.
- **Rules:**
  - owners only (staff get 42501);
  - the stay must be closed, and a transfer is not a move-out;
  - one settlement per stay;
  - a refund needs a mode;
  - deposit payments cannot be entered by hand (`deposit_payment_manual`).
- **Reports:** deposit payments are not counted as money in, the same as credit.
- **Files:**
  - `supabase/migrations/20261024090000_settlement.sql`, which adds
    `bill_resident_month`, `settlement_preview` and `settle_move_out`;
  - `src/features/settlement/` (`totals.ts`, `queries.ts`, `actions.ts`,
    `SettlementForm`, `SettlementStatement`);
  - the page, the allocation history column, `settlementSchema`, and the
    `deposit` payment mode.
- **Tests:**
  - `tests/integration/settlement.test.ts` (6 cases): refund after deductions;
    the deposit paying dues and coming back when that payment is voided; credit
    used first and the leftover refunded; final-month re-billing; the rules.
  - `tests/unit/settlement.test.ts`: the form's arithmetic.
  - `tests/e2e/settlement.spec.ts`: desktop and mobile.

## Phase 5: complaints and maintenance (ClickUp EP-15)

Migration: `supabase/migrations/20261025090000_complaints.sql`. Code:
`src/features/complaints/`, plus the pages under `src/app/(app)/complaints/`,
`src/app/(app)/settings/workers`, `src/app/(app)/settings/complaints` and
`src/app/job/[token]`.

- **T1: records and lifecycle.**
  - **Categories:** `complaint_categories` holds categories per hostel, seeded
    with the 9 defaults (electrical, plumbing, carpentry and the rest), each
    mapped to a trade.
  - **Complaints:** `complaints` gives each complaint a number per hostel and
    records the room, bed, common area, resident, priority and worker.
  - **Statuses:** open, assigned, in progress, on hold, resolved, closed and
    reopened. The database refuses any other move, and on hold and reopen
    need a reason.
  - **History:** every change is written to the append-only `complaint_events`
    by the complaint functions. Members cannot update a complaint directly.
  - **Bed status:** a complaint about a bed can mark that bed under maintenance.
- **T2: raise and manage.**
  - **Pages:** `/complaints` (filters, paging in the database, a late filter)
    and `/complaints/new`, for a room, bed or common area, optionally on behalf
    of a resident.
  - **Complaint page:** `/complaints/[id]` shows the history, comments, status
    and assignment.
  - **Elsewhere:** open complaints appear on the room and resident pages, and
    there is a nav item and a dashboard card (open, late, urgent, needs a
    worker).
- **T5: photos and video.**
  - **Storage:** a private `complaint-media` bucket under
    `<hostel>/<complaint>/`, holding up to 5 photos and 1 video per stage
    (problem or fix).
  - **Checks:** the real type is read from the bytes. Photos are shrunk in the
    browser to 1600 px, videos are limited to 20 MB, and files are served
    through 2-minute signed URLs.
  - **Upload path:** uploads use route handlers, because videos are larger
    than the server-action body limit.
- **T6: workers.**
  - **Kinds:** on-site staff of one hostel, or vendors shared across the
    owner's hostels.
  - **Details:** trades, call-out charge, a preferred flag, and time off
    (`worker_unavailability`), all on `/settings/workers`. Only owners add
    workers.
- **T7: routing.** `private.route_complaint` runs as a complaint is saved.
  - **Order:** an available on-site worker with the trade, then a preferred
    vendor, then any vendor. The fewest open jobs wins a tie.
  - **Exclusions:** workers on leave, or who declined this job, are skipped.
  - **Safety:** routing takes a lock per hostel, so two complaints never pick
    from stale counts.
  - **No match:** the complaint is flagged "needs a worker".
  - **Overrides:** auto-routing can be switched off per category, and a worker
    can be assigned or reassigned by hand at any time. Every assignment is
    logged.
- **T8: job links.**
  - **Sending:** "Send job link" makes a 64-hex-character token, stored only as
    SHA-256. It is sent by WhatsApp (`wa.me`, the reminders pattern) or copied.
  - **Worker page:** `/job/[token]` needs no account. It shows this one job and
    lets the worker accept or decline, mark "on the way" and "started", then
    "done" with a note, their charge and photos of the fix.
  - **Expiry:** the link dies when the job is done, reassigned or a new link is
    made.
  - **Declines:** a decline routes the job to the next worker.
  - **Privacy:** the resident's phone is hidden unless the owner allows it.
  - **Rate limit:** 20 updates an hour per link.
  - **Access:** the two functions the link calls live in their own
    `job_link` schema, so the anonymous role never gets `private`.
- **T9: costs.**
  - **Recording:** labour, material and vendor charge, with who pays. A cost the
    resident pays becomes a `resident_charges` row of category `repair`, billed
    on their next invoice.
  - **Voiding:** only owners can void a cost, which also voids its charge.
    After the charge is invoiced, the invoice has to be voided first.
  - **Payouts:** vendor payouts are a log only.
- **T10: targets.**
  - **Setup:** response and fix targets per priority (defaults 2/24 h urgent
    through 48/168 h low), editable in `/settings/complaints`.
  - **Clock:** time on hold is not counted.
  - **Display:** "Due soon" and "Late" badges show in the list and on the
    dashboard. No messages are sent, since there is no SMS or email provider
    yet.
- **T11: reports.** `public.complaint_report` (invoker) covers:
  - counts and average response and fix times by category;
  - counts by room and floor, and rooms with repeat problems;
  - worker jobs, completions and declines;
  - repair spend.
    The `/complaints/reports` page has a CSV download of every complaint in the
    dates chosen.
- **T12: preventive maintenance.**
  - **Schedules:** `maintenance_schedules` sets each task to repeat every N
    days, weeks or months.
  - **Creation:** `create_due_maintenance` runs when the complaints page opens.
    It is idempotent per due date, creates 'scheduled' complaints that are
    routed like any other, and moves each schedule to its next date.
- **T13:** `docs/worker-network.md` compares partnering, building a vetted
  network, and keeping each hostel's own vendors. It recommends the last for now
  and is left for the owner to decide. Nothing is built.
- **T14: security tests.** `tests/rls/complaints.test.ts` (18 cases) covers:
  - routing order, load sharing, leave and no-match;
  - every lifecycle rule;
  - append-only history and no direct updates;
  - the job-link view hiding the phone, the full update flow, the link dying
    on done and on reassignment, guessed and malformed tokens, declines going
    to the next worker, and the rate limit;
  - resident-paid costs becoming charges, and the void rules;
  - preventive maintenance once per due date;
  - reports and cross-hostel refusal;
  - cross-tenant isolation of complaints, history, costs, files and workers;
  - other owners' workers refused, and staff unable to add workers;
  - attachment limits and storage paths.
    Also: `tests/unit/complaints.test.ts`, and `tests/e2e/complaints.spec.ts`
    (owner, plumber and job link end to end, plus staff and the dashboard, on
    desktop and mobile). The accessibility scan covers the new pages.
- **Not built (needs an SMS provider with DLT templates):**
  - T3 (residents raising complaints by QR code with an SMS one-time code);
  - T4 (SMS status links and resident confirmation);
  - the reminder and escalation messages in T10.
- **Bugs caught by tests:**
  - **`worker_serves` returned NULL for shared vendors.** Its "not serves"
    check then let another owner's vendor be assigned. Fixed with `coalesce`.
  - **The workers select policy used a subquery that cannot see a row being
    inserted.** Inserts that returned the new row were refused. The policy is
    now written against the row's own columns.
  - **Staff could add vendors as their own.** Adding workers is now refused for
    anyone who is not an owner.
- **Fix: the payment dialog kept its last mode.** Since cheques were added
  (3c), "Mode" is a controlled field, and closing the dialog left it set
  (for example to cheque). It is now cleared each time the dialog opens.
  `tests/e2e/dialogs.spec.ts` caught it. That test now causes its failed attempt
  with a cheque for more than is due, because overpaying in cash became advance
  credit in 3c.

## Phase 4: subscription billing groundwork, no gateway (ClickUp EP-14)

Migration: `supabase/migrations/20261026090000_subscriptions.sql`. Code:
`src/features/billing/`, `/settings/billing`, `/admin/plans`, the subscription
section on `/admin/owners/[id]`, revenue on `/admin/metrics`, and `/legal/*`.

- **T1: plans.**
  - **Table:** `plans` holds prices in paise, pricing basis, limits on beds,
    hostels and staff, feature flags, a GST-inclusive flag, offered and active.
  - **Seeded:** Free (grandfathered), Starter, Growth and Pro, all at
    **placeholder prices**. `docs/pricing.md` lists the decisions the owner
    still has to make.
  - **Admin:** `/admin/plans` uses `admin_save_plan`, which needs a reason and
    is audited.
- **T2: subscriptions.**
  - **Table:** one `subscriptions` row per owner: plan, status (trialing,
    active, past_due, read_only, cancelled), trial end, period, the price at
    the time the plan was given, and empty gateway ids.
  - **History:** every change goes to `subscription_events`, with the reason.
  - **Changes:** made through `admin_set_subscription` (reason and audit).
  - **Legacy columns:** `hostels.plan` and `trial_ends_at` stay, mirrored from
    the subscription by a trigger, so existing screens, metrics and plan
    history keep working.
  - **Per-hostel plan form:** `admin_set_plan` now sets the owner's
    subscription.
  - **Migration of existing owners:** paid → Pro (it had no limits), free →
    Free, trial → trial.
- **T3: trial.**
  - **Start:** an owner's first hostel starts a Pro trial of the length set in
    Admin → Metrics. Later hostels follow the same subscription.
  - **Banners:** the trial banner links to Billing. When the trial ends, the
    account is read-only, worked out on the fly (no scheduled job needed), and
    a read-only banner shows instead.
  - **Not built:** trial reminder emails need an email provider.
- **T4: plan limits.**
  - **Triggers:** these refuse a new bed (or an un-archived one), hostel or
    staff invitation past the limit, naming it ("Your Starter plan allows 50
    beds").
  - **Staff invitations:** these are written with the service role, so the
    invite action first calls `check_account_can_add` as the owner.
  - **Downgrades:** a downgrade below current usage is refused, listing what to
    remove first.
  - **Existing data:** nothing over a limit is hidden or deleted.
  - **Usage display:** usage shows on Billing, warning at 80%.
- **T9: read-only mode.**
  - **Guard:** one trigger, `aa_account_writable`, sits on every tenant table
    (27). It refuses users' writes, including writes made inside the app's
    functions, when the owner's account cannot write.
  - **Who is limited:** owner and staff alike. Platform admins, the service
    role and job links are not.
  - **Still allowed:** reads, printing, exports and erasing a resident's data.
  - **Messages:** `unexpectedFailure` turns `account_read_only` and
    `plan_limit` into plain messages in every form.
  - **Lifting it:** an admin sets an active plan.
- **T11: legal pages.**
  - **Pages:** `/legal/terms`, `/legal/privacy`, `/legal/refunds` and
    `/legal/contact`, linked from the sign-in and sign-up footer. Each is marked
    **"Draft for review: not yet reviewed by a lawyer"**.
  - **Sign-up:** the terms must be accepted at sign-up, and
    `profiles.terms_version` and `terms_accepted_at` are recorded.
- **Billing page (part of T7, owner only):**
  - **Shown:** plan, status, trial or paid-until date, usage against limits,
    and the plans on offer.
  - **Changing plan:** done by contacting support for now.
  - **Not built:** payment method, invoices and proration need the gateway.
- **Revenue figures (T12 groundwork):** `admin_revenue` covers:
  - MRR and ARR from active subscriptions' prices;
  - counts by status and plan;
  - trial-to-paid conversion and churn this month, from `subscription_events`;
  - past-due accounts.
    Failed payments wait for the gateway.
- **Tests:**
  - `tests/integration/subscriptions.test.ts` (10 cases): the trial at the
    first hostel; admin-only changes with a reason, mirrored to hostels; the
    price kept on a plan price change; the per-hostel form; read-only for owner
    and staff with reads and erasure still allowed and the admin lifting it;
    cancelled accounts and writes inside functions; the bed, hostel and staff
    limits; downgrades refused without removing anything; admin-only revenue;
    and the terms version.
  - `tests/e2e/billing.spec.ts`: an owner's Billing page and read-only after a
    lapsed trial; an admin lifting it, the Plans page and revenue; the terms
    required at sign-up and the public terms page.
  - The sign-up e2e steps tick the terms box. The trial-length test now creates
    a new owner, because a trial belongs to the account.
- **Not built (needs a gateway, email, a lawyer or a CA):**
  - recurring payments, failed payments and dunning;
  - coupons and annual billing;
  - payment method and invoices on the Billing page;
  - GST invoices;
  - trial reminder emails;
  - the final legal texts.
