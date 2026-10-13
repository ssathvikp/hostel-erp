# Platform worker network: options (E15-T13)

**Status:** discovery. Nothing here is built, and nothing should be until the
owner picks an option. Until then each hostel's own vendor list (E15-T6) is
the only source of outside workers.

## The question

Some hostels have no electrician or plumber of their own to call. Hostel ERP
could supply workers itself. That is a different business from software:
it takes on worker vetting, liability for what workers do on site, a payment
flow and a commission, and GST on that commission. This note sets out the
three realistic options so the decision can be made with the costs in view.

## Option A: stay with each hostel's own vendors (today)

The hostel adds the people it already calls. Routing, job links, costs and
reports work the same for them as for staff.

| Topic            | Position                                                                   |
| ---------------- | -------------------------------------------------------------------------- |
| Verification     | The hostel's own judgement. The app stores only name, phone and trades.    |
| Liability        | Between the hostel and its vendor. The platform is a record-keeping tool.  |
| Pricing          | The vendor's own rate, entered by the worker or the owner (E15-T9).        |
| Payments and GST | Outside the app; payouts are a log only. No GST exposure for the platform. |
| Effort           | None beyond what is already built.                                         |
| Main gap         | A new hostel in a new city with no contacts has nobody to route to.        |

## Option B: partner with an existing home-services provider

Send jobs that no hostel worker can take to a provider that already vets and
insures its workers (national or city-level home-services companies), through
their partner API where one exists, or a booking link where it does not.

| Topic            | Position                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification     | The provider's: ID and background checks are their process, written into the partner agreement.                                              |
| Liability        | The provider's, by contract; the agreement must say so, including damage and misconduct.                                                     |
| Pricing          | The provider's rate card. A referral fee or margin is the platform's income, if the provider pays one.                                       |
| Payments and GST | The hostel pays the provider directly, or through the platform if a margin is taken (then GST applies on that margin).                       |
| Effort           | Partner agreement, one API integration (create job, status webhooks), a mapping of trades to their services.                                 |
| Risks            | API access is usually reserved for large partners; availability varies by city; the job leaves our status flow unless webhooks are reliable. |

## Option C: build a vetted local network, city by city

Recruit electricians, plumbers and carpenters directly, verify them, and offer
them to every hostel in the city.

| Topic            | Position                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification     | Ours: Aadhaar-based ID check through a licensed verification provider, police verification, trade references. Recurring cost per worker.                                  |
| Liability        | Ours, unless workers are independent contractors under clear terms; insurance cover for damage and theft is needed before the first job.                                  |
| Pricing          | A published rate card per job type, with a platform commission.                                                                                                           |
| Payments and GST | Collect from the hostel, pay out to the worker: a payment-aggregator account with payouts, GST registration and invoices on the commission, and TDS questions on payouts. |
| Effort           | An operations team per city (recruiting, disputes, quality), worker onboarding app or flow, ratings, payouts. This is its own epic and its own business line.             |
| Risks            | Highest cost and slowest; quality problems land on the platform's name; worker supply is hard to keep in small cities.                                                    |

## What each option needs from the product

| Capability                   | A    | B                   | C                                 |
| ---------------------------- | ---- | ------------------- | --------------------------------- |
| Worker directory and routing | Done | Done, plus fallback | Done, plus a shared city pool     |
| Job link for outside workers | Done | Replaced by partner | Done, plus a worker account       |
| Money through the platform   | No   | Optional            | Yes (aggregator, payouts, GST)    |
| New legal agreements         | None | Partner agreement   | Worker terms, insurance, policies |

## Recommendation for the decision meeting

Start with **A**, which is live, and measure the gap: how often does a
complaint wait with "Needs a worker" (the dashboard and E15-T11 report
already count it)? If a meaningful share of hostels hit that regularly,
pursue **B** in the cities where those hostels are, because it adds supply
without the platform carrying worker liability. Consider **C** only once
there is clear demand in one city and a budget for an operations team; it
would be planned as its own epic.

## Decision

_To be recorded with the owner: option chosen, date, and who decided._
