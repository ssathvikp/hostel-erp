# Platform worker network: options (ClickUp EP-15 T13)

**Status: for the owner to decide. Nothing here is built.** Until a decision,
each hostel's own workers (Settings → Workers) are the only source of repair
workers, as T13 requires.

## The question

Owners without a trusted plumber or electrician ask "can the app find me one?"
That could make Hostel ERP stickier and earn a commission. It also makes us
answerable for strangers entering residents' rooms.

## Option A: partner with a home-services company

Examples are Urban Company or a regional aggregator, if one offers a partner
API. When no hostel worker has the trade, the job is sent to the partner.

- **Verification:** the partner does ID and police checks. We rely on their
  process and their contract.
- **Liability:** mostly theirs, under their terms. Our terms must say we only
  pass the request on.
- **Pricing and commission:** their price list, plus a referral fee to us if
  they offer one. Many do not, or only at volume.
- **Payment flow:** the resident or hostel pays the partner directly. Nothing
  passes through us, and there is no gateway work.
- **GST:** the partner invoices. We invoice only our referral fee, if any.
- **Effort:** small if an API exists: one integration and status webhooks.
  The risk is that no suitable API is open to a company our size.

## Option B: build a vetted network, city by city

We recruit workers, check them, and list them for hostels nearby.

- **Verification:** we must do it: Aadhaar-based ID, police verification
  (state-specific and slow), references and trial jobs. This is ongoing work.
- **Liability:** ours in practice, whatever the terms say. We would need
  insurance and a complaints and refunds process.
- **Pricing and commission:** we set rates and take 10 to 20%. It only pays
  at density: many hostels in one area.
- **Payment flow:** to take a commission we must collect the payment, which
  needs a gateway with split or escrow payouts (EP-14 work), plus KYC for
  every worker.
- **GST:** we become a marketplace. Tax collected at source and invoicing
  rules apply. This needs a CA.
- **Effort:** a business of its own, not a feature.

## Option C: keep each hostel's own vendors (today)

- **Verification and liability:** the owner's, as today.
- **Pricing and payment:** whatever the owner agrees. Payouts are logged
  in the app (T9), and no money moves through it.
- **Cost:** none. It is already built.
- **Possible step up:** let owners mark vendors as "share with nearby owners".
  That is referrals between owners, without us vetting anyone.

## Recommendation

**Stay on C for now.** Revisit A once there are enough hostels in one city to
make a partner conversation worthwhile. Treat B as a separate company decision,
not a feature. Whichever is chosen beyond C becomes its own epic, as the task
says.

## Decision

- [ ] A: partner
- [ ] B: own network
- [x] C: own vendors (default until decided)

Decided by: _owner_ · Date: _ _
