# Subscription billing (EP-14)

How hostel owners pay for Hostel ERP: plans, the free trial, limits,
Razorpay subscriptions, GST invoices, failed payments and read-only mode.
Admin corrections are E10-T7. Resident rent collection is a separate
feature (E13-T10, `docs/online-payments.md`).

## Status: what works without accounts, and what waits for them

Everything is built and tested against the local database. These pieces
need accounts or decisions before going live:

| Waiting on                  | Until then                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Razorpay account (KYC done) | Owners see "online payment is not set up"; admins apply plans by hand (E10-T7)         |
| Prices (owner decision)     | The proposals in `docs/pricing.md` are live in the database; edit at `/admin/billing`  |
| GST registration            | Invoices are issued without the seller's GSTIN and say so; fill it at `/admin/billing` |
| Chartered accountant review | GST rate 18%, SAC 998314 and place-of-supply rules are defaults                        |
| Lawyer review               | The legal pages are marked as drafts                                                   |
| Email provider              | Billing emails queue in `email_outbox`; nothing sends them yet                         |

## The model

- **One subscription per owner account**, covering all their hostels. It is
  created when the owner creates their first hostel, as a trial of the
  trial plan (`billing_settings.trial_plan_code`, Pro by default) for
  `trial_days` (14). Staff and admin accounts never get one. Owners who
  existed before billing were moved to the hidden **Founder** plan, free
  with no end.
- **Statuses:** `trialing`, `active`, `past_due`, `read_only`, `cancelled`.
  They change only through database functions (webhooks, admins, the
  billing job), and every change is written to `subscription_events` with
  its source and reason by trigger.
- **Whether an account may write is derived**, not stored:
  `private.account_can_write(owner)` reads the status and its dates, so a
  trial that ended a minute ago is read-only now. The hourly job
  (`private.billing_run`, pg_cron `billing-run`) only records transitions
  and queues emails.
- **Prices** are integer paise excluding GST, per period, priced flat, per
  bed (with a minimum) or in bed tiers. A running subscription keeps the
  amount it was charged; a price or bed-count change reaches it at the next
  renewal, when the app moves the Razorpay subscription to the right plan
  for the next cycle (`syncRenewalPrice`).

## Read-only mode (E14-T9)

When an account cannot write, a trigger on every tenant table refuses
inserts, updates and deletes by signed-in users with hint
`account_read_only`. Every server action turns it into a plain message
(`src/lib/billing/messages.ts`, applied in `unexpectedFailure`), and the app
shell shows a banner explaining why and linking owners to billing.

Still allowed, on purpose:

- Reading, printing and the data export.
- Erasing a resident and requesting account closure (DPDP rights).
- Updating billing details, and paying.
- The service role (gateway webhooks, worker job links, resident
  complaints) and scheduled jobs: money a resident pays online is always
  recorded.

A schema guard (`tests/integration/schema-guards.test.ts`) fails CI if a
new table with `hostel_id` is not put behind the trigger.

## Plan limits (E14-T4)

Beds, hostels and staff accounts are checked by triggers for every writer,
the service role included, with hints `plan_limit_beds`, `plan_limit_hostels`
and `plan_limit_staff`. Beds are checked once per statement, so a bulk room
range is refused whole. Existing data above a limit is never removed or
hidden. Checkout and plan changes to a plan the account does not fit are
refused with what to remove (`plan_too_small`).

## Gateway: Razorpay Subscriptions (E14-T5)

**Why Razorpay:** it supports recurring card and UPI AutoPay mandates under
RBI's e-mandate rules (it sends the pre-debit notifications and asks for
authentication above the e-mandate limit), offers coupons as "offers",
hosts the checkout page so no card or UPI data reaches us, and is the
gateway most Indian SaaS customers already trust. Cashfree is a reasonable
alternative; only `src/lib/billing/razorpay*.ts` and
`src/features/billing/gateway.ts` would change.

Flow:

1. The owner picks a plan on `/settings/billing`. `billing_prepare_checkout`
   checks the plan, limits and coupon, and records the checkout.
2. The app finds or creates the Razorpay plan for that exact amount
   including GST (`gateway_plans`), creates a subscription, records it
   (`billing_attach_checkout`) and redirects to Razorpay's hosted page.
3. Razorpay calls `POST /api/webhooks/billing`. The body is verified with
   `RAZORPAY_WEBHOOK_SECRET` (HMAC-SHA256 of the raw body), normalised
   (`src/lib/billing/razorpay-webhook.ts`) and applied by
   `billing_apply_gateway_event`, which stores each event id once.
4. `subscription.activated` / `charged` → active (the checked-out plan
   applies), a tax invoice per payment; `pending` / `halted` → past due;
   `cancelled` / `completed` → cancelled; `refund.processed` → credit note.

Upgrades take effect now (Razorpay `schedule_change_at: now`); downgrades
and monthly/annual switches at the next cycle. **Verify in the Razorpay
sandbox** how an immediate plan change is charged before going live; the
billing page shows the owner a prorated estimate computed the same way as
`billing_quote_change`.

### Setting up Razorpay

1. Create the Razorpay account and finish KYC. Live payments need the legal
   pages (E14-T11), which are already published at `/legal/*`.
2. Dashboard → Account & Settings → API Keys: generate test keys first.
   Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in Vercel (Sensitive).
3. Dashboard → Webhooks → Add: URL `https://<site>/api/webhooks/billing`,
   a strong secret (set it as `RAZORPAY_WEBHOOK_SECRET`), and the events
   `subscription.authenticated`, `subscription.activated`,
   `subscription.charged`, `subscription.pending`, `subscription.halted`,
   `subscription.cancelled`, `subscription.completed` and
   `refund.processed`.
4. Run the sandbox journey: subscribe with a test card, trigger a renewal
   from the dashboard, fail one with a failing test card, cancel. Check
   the billing page, the invoices and `subscription_events` after each.
5. Switch to live keys only after the checks above and the reviews listed
   at the top.

## GST invoices (E14-T6)

Every successful charge issues an immutable tax invoice
(`platform_invoices`), numbered `HE/26-27/00001` per financial year (credit
notes `HC/…`), at most 16 characters as GST requires. The amount charged
includes GST; the invoice splits it into taxable value and CGST + SGST when
the place of supply (the owner's billing state, else the seller's) is the
seller's state, otherwise IGST. Seller and buyer details are snapshots.
Owners download invoices from `/settings/billing` (print to PDF); an email
is queued for each.

Fill in the seller details at `/admin/billing` once the business is
registered. Until then invoices carry a warning.

## Failed payments (E14-T7)

A failed charge makes the subscription past due and queues an email. Access
continues for `grace_days` (7); two days before the end another email goes
out; then the account becomes read-only. Razorpay retries on its own
schedule; a successful charge at any point restores full access
immediately. A long-unpaid account can additionally be suspended by an
admin (E10-T6).

## Coupons (E14-T10)

Admins create coupons at `/admin/billing`. A coupon is redeemable online
only once it has the id of a matching **Razorpay offer** (created in the
Razorpay dashboard), so the gateway's charge and our invoice always agree.
Each owner can use a coupon once; redemptions are recorded.

## Admin corrections (E10-T7)

From an owner's page in `/admin/customers`: extend a trial (reopens a
read-only trial), apply a complimentary plan (free until a date, or with no
end), or correct the recorded plan. Each needs a reason and is written to
the audit log and the subscription history. None of them touches the
gateway: change a gateway subscription in the Razorpay dashboard.

## Revenue (E14-T12)

The admin overview shows MRR and ARR (excluding GST; annual plans count as
a twelfth), subscriptions by status, trial-to-paid conversion over 90 days,
monthly churn and failed payments awaiting recovery.

## Testing

- `tests/integration/billing.test.ts`: trial, read-only mode, limits,
  prices, webhooks (idempotency, invoices, credit notes), plan changes, the
  billing job, coupons, admin adjustments and revenue.
- `tests/rls/billing.test.ts`: billing data is per account.
- `tests/unit/razorpay-webhook.test.ts`: signatures (forged, replayed,
  altered bodies) and event normalisation.
- `tests/e2e/billing.spec.ts`: the billing page, the read-only banner and
  the admin screens.
