# Business analysis: Hostel/PG ERP

Written 2026-10-17. Covers the idea itself, where the business is weak, and
what to do about each weak point. The fixes that need building or doing are
tracked as **EP-15 Business Hardening** in
[`scripts/clickup/plan-12.ndjson`](../scripts/clickup/plan-12.ndjson). Revenue
ideas are in **EP-14 Revenue Engine**
([`plan-11.ndjson`](../scripts/clickup/plan-11.ndjson)), and this document
refers to those tasks rather than repeating them.

All figures below are working assumptions for planning, not market research.
Replace them with real numbers from the first 10 to 20 hostels.

## 1. The idea in one paragraph

A web app that runs a hostel or PG (paying-guest) business: rooms and beds,
residents, who sleeps where, monthly rent and receipts, deposits, staff, and a
dashboard. It is sold to the owner as a monthly subscription. Today it is a
good management tool, but it has no way to take money yet. The real
business is the rent that flows through these hostels every month. Software
that touches that money can earn from payments, verification, financing and
services, not only from a subscription.

## 2. What is already strong

| Strength                                                                                      | Why it matters commercially                                                                             |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Built for the Indian PG model: beds, sharing types, deposits, IST dates, paise-accurate money | Generic hotel and property software fits PGs badly, so this one feels made for them                     |
| Secure multi-tenancy (row-level security, tested per role)                                    | Lets you sign hundreds of hostels on one deployment cheaply, and is a real answer to "is my data safe?" |
| DPDP data rights (consent, export, erasure) already built                                     | Most small competitors and spreadsheets ignore this; you can sell it to careful owners and chains       |
| CSV import from existing spreadsheets                                                         | Removes the biggest switching cost, retyping everything                                                 |
| Platform admin with plans, trials and suspension                                              | The groundwork for billing is done; only charging is missing (E14-T1)                                   |
| Low running cost (Supabase + Vercel)                                                          | A gross margin above 80% is realistic at small scale                                                    |

## 3. Weak points and fixes

Ordered by how much each one could stop the business, most serious first.

### W1. Nothing charges money yet

**Problem.** Plans and trials exist in `/admin`, but no hostel can pay. Until
they can, every hostel is a cost, and you cannot learn what owners will
really pay.

**Fix.** Build E14-T1 (plan billing through a payment gateway) before
onboarding hostels beyond the first pilots. Collect annual prepayment where
possible: it brings cash forward and cuts churn. Until billing is built, take
payments by UPI by hand and record them in `/admin`.

### W2. Small owners are price-sensitive, and the default is free

**Problem.** The real competitor is a notebook, Excel and WhatsApp, which
cost nothing. A 40-bed PG at ₹20 per bed is ₹800 a month, and many owners
will not see why they should pay that when "the notebook works".

**Fix.** Sell results in rupees, not features:

- Show the money lost to empty beds and late rent each month, on the
  dashboard and in a monthly email (E15-T4). If the product shows ₹18,000 of
  overdue rent, the ₹800 fee looks small.
- Price per bed in use with a low minimum (E14-T1), so small hostels pay
  little and the fee grows with occupancy.
- Offer a free tier capped at a small number of beds, so tiny PGs still
  join and refer others.

### W3. Owners may resist a digital record of income

**Problem.** Many PG businesses are informal and cash-heavy. A system that
records every rupee, sends receipts and links to payment gateways can feel
like a tax trail. This quietly blocks adoption, and owners will rarely say
it out loud.

**Fix.**

- Position the product as the owner's private ledger. Nothing is shared
  with anyone; the owner can export and delete their data; and online
  payments are optional, not required.
- Make cash first-class (it already is: cash payments and receipts work
  without a gateway).
- Never promise or imply help with avoiding tax. Offer GST-ready reports
  as an option for owners who want to formalise (growing chains will).
- Put this in the sales script and the FAQ (E15-T6, E15-T7).

### W4. Distribution is expensive compared with what each hostel pays

**Problem.** Owners are fragmented, often offline, and many prefer a local
language. A field sales visit might cost ₹500 to ₹1,500 per demo once travel
and time are counted. At ₹800 to ₹1,500 a month per hostel, cold door-to-door
sales take months to pay back. With churn, they may never pay back.

**Fix.**

- **Cluster.** Pick one or two dense PG areas (for example coaching hubs or
  IT corridors) and win them street by street. Owners talk to each other,
  and one rep can visit many hostels in a day.
- **Channels** (E15-T8). Pay commission to people who already know owners:
  PG brokers, accountants who file for owners, owner associations, and
  furniture or mattress suppliers.
- **Referrals** (E14-T12): a free month for every referred hostel that
  starts paying.
- **Self-serve signup** (E15-T7), so channel and referral leads can start
  without a visit.
- **Track cost per paying hostel** from day one (E15-T1), so you know which
  channel to put money into.

### W5. The trial is long and free, and setup is done for the owner

**Problem.** A 90-day free trial with full setup means three months of your
time and no cash for each hostel. The owner never makes a decision, so many
will drift away once the trial ends. Also, a long trial tells you nothing
early about willingness to pay.

**Fix** (E15-T2).

- Cut the default trial to 30 days. Keep 90 days only for hand-picked
  launch partners who agree to give feedback and a testimonial.
- Charge a one-time setup fee for done-for-you onboarding (E15-T3), and
  waive it for annual prepayment. People who pay something early convert
  far better.
- Define activation: for example, all beds imported, residents allocated,
  and one month of invoices issued. Check it on day 7 and day 21. A trial
  that has not activated by day 21 needs a call, not a reminder.

### W6. Only the owner uses it, so nothing spreads on its own

**Problem.** Residents and staff get nothing from the product, so it never
spreads beyond the owner. Every new hostel has to be won by sales.

**Fix.**

- Resident app (E14-T5): residents see dues, pay and get receipts. Each
  resident is also a future owner, or knows one.
- Receipts and public vacancy pages (E14-T6) carry a "Managed with ..."
  footer that links to signup.

### W7. The moat is thin

**Problem.** Rooms, residents and invoices are standard CRUD, which a funded
competitor or a freelancer could copy in a few months. Price wars follow.

**Fix.** Build the moat from what is hard to copy:

- **Money flow** (E14-T2): once rent is collected through the product,
  switching means re-mandating every resident, so owners stay.
- **Data network** (E14-T6, E14-T7): live vacancies across many hostels and
  verification history are worth more the more hostels join.
- **Trust and compliance:** DPDP readiness, security and audit trails,
  which chains and corporate-leased hostels need.
- **Local depth:** languages, local payment habits and owner-association
  relationships.

### W8. No product metrics

**Problem.** There is no product analytics. You cannot see activation,
weekly active hostels, churn, or which features earn their keep, so pricing
and roadmap calls are guesses.

**Fix** (E15-T1). Track a short list of events with privacy-safe product
analytics: no resident personal data, only counts and hostel IDs. Pick one
headline metric: **rent recorded through the product each month** (later,
rent collected through it). Add a metrics view to `/admin` next to the
churn signals in E14-T13.

### W9. English-only and desktop-first

**Problem.** Many owners and wardens are more comfortable in Hindi or a
regional language, and work only on a phone. The app is responsive web and
English-only.

**Fix.**

- Translate the UI into Hindi first, then the language of your first
  cluster (E15-T5).
- Make the owner app installable from the browser and quick for the three
  daily jobs: record a payment, allocate a bed, check who is overdue
  (E15-T9).

### W10. Reliability and operations rest on one person

**Problem.** Backups, disaster recovery and monitoring were deferred from
the MVP. One lost database or one week of downtime at month-end, when rent
is due, ends trust for good. Support also depends on you personally.

**Fix.**

- Scheduled backups with a tested restore, uptime alerts, and a public
  status page (E15-T10).
- Self-serve help (short videos in local languages, an FAQ) and a WhatsApp
  support number with response-time targets (E15-T11).

### W11. Legal and compliance gaps

**Problem.** The product stores identity documents (KYC) and may later
handle payments. Without terms of service, a privacy policy, a
data-processing agreement and clear roles under the DPDP Act, one complaint
or data incident can become a serious liability. Payments add more rules:
use a licensed payment aggregator, never hold money yourself.

**Fix** (E15-T6).

- A lawyer-reviewed legal pack: terms of service, privacy policy, a
  data-processing agreement with the owner as data fiduciary and you as
  processor, and a breach-response plan.
- GST registration before billing.
- For payments, lending and insurance, always work through licensed
  partners (as EP-14 already says).

### W12. Focus risk: schools and other verticals

**Problem.** School ERP and other verticals are tempting, because the code
could be reused. Splitting attention before hostels work means two
half-finished products, each with a different buyer, sales cycle and
feature set.

**Fix.** Write down an explicit gate: no second vertical until hostels
reach a set level, for example 150 paying hostels with monthly logo churn
under 3% and payback under 6 months. Treat schools as an exit or expansion
story, not a current project.

### W13. No proof yet

**Problem.** Owners trust other owners, not software claims. With no case
studies, a new name that holds tenant data and money is a hard sell.

**Fix** (E15-T12). Collect two or three case studies from the launch
partners with real numbers ("overdue rent down from ₹40,000 to ₹9,000 in two
months"), short video testimonials in the local language, and the owner's
permission to use their name. Use them on the website, in WhatsApp sales
messages and in channel partner kits.

## 4. Unit economics sketch

Working assumptions, to be replaced with real data:

| Input                                                                                             | Assumption                                         |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Average hostel                                                                                    | 40 beds, 85% occupied                              |
| Subscription                                                                                      | ₹20 per occupied bed per month, about ₹680 a month |
| Add-ons (reminders, verification), from year 2                                                    | about ₹300 a month on average                      |
| Payments margin (E14-T2), if 30% of hostels collect ₹2.5 lakh a month online at a 0.3% net margin | about ₹225 a month averaged over all hostels       |
| Revenue per hostel per month                                                                      | about ₹1,200                                       |
| Hosting and support cost per hostel                                                               | about ₹150 a month                                 |
| Cost to win a paying hostel (clustered field sales plus channels)                                 | ₹4,000 to ₹6,000                                   |
| Monthly churn                                                                                     | 2.5%                                               |

On these numbers each hostel contributes about ₹1,050 a month. Payback is 4
to 6 months, and lifetime value is roughly ₹40,000 (₹1,050 ÷ 2.5%), about 7
to 10 times the cost to win a hostel. The model works **only if** acquisition
stays clustered and channel-driven, and churn stays near or below 2.5%. Those
are the two numbers to watch.

## 5. Milestones and stop rules

| Stage           | Goal                                         | Move on when                                                           |
| --------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| Pilot           | 10 hostels, one area                         | 7 of 10 activated; at least 5 pay anything after the trial             |
| Prove the model | 50 paying hostels                            | Payback under 6 months on at least one channel; monthly churn under 4% |
| Scale one city  | 150 to 300 paying                            | Online collection live with 25% or more of hostels; churn under 3%     |
| Expand          | New cities, chain plan, then other verticals | Repeatable playbook in a second city                                   |

**Stop or rethink if:** after 6 months of selling, fewer than 30% of trials
convert at any price, or churn stays above 6% a month. That means owners do
not value the product enough, and more features will not fix it. Go back to
owner interviews before building more.

## 6. Order of work

1. Billing (E14-T1), metrics (E15-T1) and the trial changes (E15-T2): you
   cannot learn without them.
2. Legal pack (E15-T6) and backups and monitoring (E15-T10): needed before
   real money and real KYC data at scale.
3. Money-lost dashboard (E15-T4), Hindi (E15-T5) and owner mobile flow
   (E15-T9): they win the sale.
4. Channels (E15-T8), referrals (E14-T12), signup site (E15-T7) and case
   studies (E15-T12): the growth engine.
5. Online rent collection (E14-T2) and the resident app (E14-T5): they
   build the moat.
6. Everything else in EP-14, ordered by what pilot owners ask for.
