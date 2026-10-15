# Online rent collection (E13-T10)

Residents pay rent by UPI, card or netbanking from a link, straight into
the hostel's **own** Razorpay account. Hostel ERP never holds resident
money; it creates the link, and the gateway's signed webhook records the
payment.

## For an owner

1. Create a Razorpay account in the business's name and complete KYC.
   Start with **test mode** keys.
2. In Hostel ERP: Settings → Online payments. Paste the key id and key
   secret, and choose a long random webhook secret.
3. In the Razorpay dashboard: Account & Settings → Webhooks → Add new
   webhook. Use the URL shown on the settings page
   (`https://<site>/api/webhooks/payments/<token>`), the same webhook
   secret, and the events `payment_link.paid`, `payment.failed`,
   `refund.processed` and `settlement.processed`.
4. On any invoice with something due, **Make a payment link**. Copy it,
   send it on WhatsApp, or let the resident scan the QR code. When they
   pay, the payment appears on the invoice with a receipt number, as
   **Online (gateway)**.
5. Fees → Online shows what was collected, Razorpay's fees, refunds and
   what was settled to the bank, for any date range.

Switch to live keys with **Replace keys** once a test payment has gone
through end to end.

## How it works

- **Keys:** encrypted in the app with AES-256-GCM
  (`src/lib/crypto/secret-box.ts`) using `PAYMENT_KEYS_ENCRYPTION_KEY`
  before they are stored; the encrypted columns are not selectable by any
  signed-in user. Only the server reads them, with the service role, to
  create a link or verify a webhook. Losing the encryption key means owners
  must reconnect; never change it casually.
- **Links:** one live link per invoice for its open balance (less cheques
  still clearing), valid 15 days. If the balance changes, a new link
  replaces the old one, which is cancelled at the gateway.
- **Webhook** (`src/app/api/webhooks/payments/[token]/route.ts`): the token
  only names the hostel. The body must be signed with that hostel's webhook
  secret (HMAC-SHA256 over the raw body) and carry an event id.
  `collect_gateway_event` stores each event id, and each gateway payment
  id, once: replays change nothing.
- **Recording:** the payment is recorded against the invoice as far as it
  is still due; anything beyond (it was paid in cash meanwhile) becomes the
  resident's credit and is applied to their other open invoices. Nobody
  signed in can record an `online` payment by hand.
- **Refunds** made in Razorpay void the payment; after a partial refund the
  part kept is recorded again as a new receipt. A refund of money that went
  to credit comes out of credit. Whatever cannot be taken back (the credit
  was already used) is shown on the reconciliation page, never dropped.
- **Suspended hostels and read-only accounts:** money a resident pays is
  always kept on the gateway record. A suspended hostel cannot take new
  payments, so such a payment shows as "needs attention" for the owner to
  settle by hand. Read-only mode (EP-14) does not stop the webhook.

## Testing

- `tests/integration/online-payments.test.ts`: secrets unreadable, links,
  idempotent recording, extra as credit, refunds, settlements,
  reconciliation, suspended hostels.
- `tests/unit/razorpay-webhook.test.ts` and `tests/unit/secret-box.test.ts`.
- `tests/e2e/online-payments.spec.ts`: replays signed webhooks against the
  running app (a forged one is refused, a replay is a duplicate) and checks
  the invoice and reconciliation pages.

A real Razorpay test-mode journey (create a link, pay with a test UPI id,
refund from the dashboard) should be run once keys exist; it cannot run in
CI.
