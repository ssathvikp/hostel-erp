# Pricing (ClickUp EP-14 T1)

**Every price below is a placeholder. The owner must set the real prices**
in the admin console (Admin → Plans) before any money is taken. Each change
is audited, and it reaches existing subscriptions only at their next renewal.

| Plan                 | Code      | Per month              | Per year                | Beds     | Hostels  | Staff    | Offered            |
| -------------------- | --------- | ---------------------- | ----------------------- | -------- | -------- | -------- | ------------------ |
| Free (grandfathered) | `free`    | ₹0                     | ₹0                      | no limit | no limit | no limit | No, admins give it |
| Starter              | `starter` | ₹499 _(placeholder)_   | ₹4,990 _(placeholder)_  | 50       | 1        | 2        | Yes                |
| Growth               | `growth`  | ₹999 _(placeholder)_   | ₹9,990 _(placeholder)_  | 200      | 3        | 10       | Yes                |
| Pro                  | `pro`     | ₹1,999 _(placeholder)_ | ₹19,990 _(placeholder)_ | no limit | no limit | no limit | Yes                |

- **GST:** every price is shown as excluding GST (`gst_inclusive = false`). Keep
  that consistent, or switch all plans together. A CA should confirm how GST is
  charged before invoicing (see EP-14 "GST invoices").
- **Trials:** a trial is the Pro plan for the length set in Admin → Metrics
  (30 days by default), with no card needed. When it ends the account becomes
  read-only; nothing is deleted. An admin then sets the plan, which lifts it.
- **Existing hostels at migration:**
  - "paid" became Pro, since it had no limits, so nobody was cut off;
  - "free" became Free;
  - "trial" stayed a trial with the same end date.
- **Pricing basis:** each plan records flat, per bed or tiered pricing, but the
  app charges nothing yet. That needs the payment gateway (EP-14 T5 onwards).

## Decisions the owner still has to make

- [ ] Real monthly and yearly prices for each plan.
- [ ] Whether to price per bed instead of flat. Hostels range from 10 to 500
      beds, so a flat price undercharges large hostels.
- [ ] Limits per plan (beds, hostels, staff).
- [ ] Whether GST is included in displayed prices.
- [ ] Payment gateway (Razorpay, Cashfree…), which unlocks automatic billing.
