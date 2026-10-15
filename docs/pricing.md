# Pricing (E14-T1)

**Status: PROPOSAL awaiting the owner's decision.** These are the plans the
migration created so that billing can be built and tested. Prices are a
business decision; change them at `/admin/billing` (no code change) and
update this page when decided.

All prices exclude GST (18%), which is added at checkout and shown
separately everywhere a price appears.

| Plan    | Priced                                                    | Annual                 | Beds      | Hostels   | Staff     |
| ------- | --------------------------------------------------------- | ---------------------- | --------- | --------- | --------- |
| Starter | ₹999 a month                                              | ₹9,990 (2 months free) | 50        | 1         | 2         |
| Growth  | ₹25 per bed a month, minimum 20 beds                      | ₹250 per bed           | 300       | 3         | 10        |
| Pro     | ₹9,999 a month up to 500 beds; ₹17,999 a month above that | ₹99,990 / ₹1,79,990    | Unlimited | Unlimited | Unlimited |
| Founder | Free, hidden; for owners who joined before billing        | —                      | Unlimited | Unlimited | Unlimited |

- **Trial:** 14 days of Pro, no card needed.
- **Grace after a failed payment:** 7 days, then read-only.
- **Feature flags** (`complaints`, `reports`, `online_payments`) are stored
  per plan and shown on the billing page. They are not enforced yet:
  decide whether Starter should lose any feature before turning
  enforcement on.

## How the proposal was reached

Indian hostel and PG software is usually priced per bed or per property
per month, typically ₹10 to ₹40 per bed. The proposal covers a small PG
(Starter, flat and simple), a growing operator (Growth, scales with beds),
and chains (Pro, predictable tiers). Annual billing gives two months free
to improve cash flow.

## Decisions needed

1. Prices and limits for each plan.
2. Whether any feature is held back from Starter.
3. Trial length (14 days) and grace period (7 days).
4. Launch coupon, if any (create it in Razorpay, then at `/admin/billing`).
