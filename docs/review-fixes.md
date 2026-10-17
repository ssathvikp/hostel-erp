# Review fixes

Changes made after the full-repository bug review (October 2026). Each
entry says what was wrong, what changed, and how it is tested. Database
changes are in `supabase/migrations/20261018090000_review_fixes.sql`;
merged migrations were not edited.

Not changed, because they need a product decision, are listed at the end.

## 1. Open redirect in email links

- **Problem:** `safeNextPath` checked the raw `next` value, but returned the
  path after URL resolution. `/.//evil.com`, `/..//evil.com` and
  `/%2e//evil.com` resolve to `//evil.com`, which the browser treats as
  another site. A crafted confirmation or reset link could therefore send
  someone to an outside page after signing them in.
- **Change:** `src/lib/auth/redirect.ts` also rejects a resolved path that
  starts with `//` or contains a backslash.
- **Tests:** four new cases in `tests/unit/auth.test.ts`.

## 2. Imported residents had no consent recorded

- **Problem:** the import screen required ticking "every resident agreed",
  but the rows sent to `import_residents` never carried that, so every
  imported resident showed "Consent: Not recorded".
- **Change:** `src/features/import/actions.ts` sends `consent: true` with
  each row once the box is ticked. The database stamps the time and the
  person who imported.
- **Tests:** `tests/e2e/imports.spec.ts` now checks `consent_at` and
  `consent_recorded_by` on every imported resident. It failed before the fix.

## 3. Large resident imports failed at "Check file"

- **Problem:** the duplicate check put every ID fingerprint (64 characters
  each) into one request URL. Measured on the local stack: 100 works, 150
  and above fail with "URI too long", so files of more than about 120
  residents could not be checked or imported.
- **Change:** the room-number, mobile and ID lookups in
  `src/features/import/actions.ts` run in batches of 50 values.
- **Tests:** new e2e test imports a 500-resident file, then checks the same
  file again and finds all 500 as already registered. It failed before.

## 4. Saving in a stale tab changed the other hostel

- **Problem:** owners with several hostels pick one with the hostel switcher,
  stored in a cookie. Server actions used whatever hostel the cookie named
  _when the form was submitted_. With hostel A open in one tab and B chosen
  in another, saving A's settings, rates, invoices, new residents, rooms,
  imports or staff invitations in the first tab wrote them into B.
- **Change:**
  - `src/components/shell/ActiveHostel.tsx`: the app shell provides the
    hostel each screen was shown for; `HostelField` adds it to a form as a
    hidden `hostel_id`.
  - `src/lib/hostels/form.ts`: `formHostel(formData)` returns the active
    hostel only if it matches the posted one, otherwise "You switched to a
    different hostel in another tab. Reload this page and try again." The
    posted value can only refuse a save, never choose another hostel.
  - Every action that writes hostel data now uses it (fees, rooms,
    residents, allocations, deposits, reminders, import, staff, hostel
    settings, consent). Every form for those actions carries `HostelField`;
    the reminder send buttons pass the id directly.
- **Tests:** new `tests/e2e/hostel-tabs.spec.ts` (fails without the check);
  the whole browser suite passes, so no form was missed.

## 5. Cancelling or resending a staff invitation could hit the wrong account

- **Problem:** Resend and Cancel looked up whichever account currently owned
  the invited email and deleted or banned it. If the invitation's own
  account had gone (for example a resend that failed half-way) and the same
  address later signed up as an owner, Cancel banned that owner and Resend
  could delete them. Other gaps in `src/features/staff/actions.ts`:
  - failed `deleteUser` calls were ignored, so an invitation could show as
    cancelled while its link still worked;
  - two quick clicks on Invite could delete the account the first
    invitation used;
  - re-inviting a removed staff member reactivated them before recording
    the invitation, so a failure left someone with access shown as
    "removed";
  - Remove stopped at "already removed", so a removal whose login ban had
    failed could never be finished.
- **Change:**
  - `invitedAccount()` only returns the account when it is the
    invitation's own: same user id, staff of this hostel. Otherwise
    nothing is deleted or banned. Resend withdraws the invitation and
    says the address now has its own account.
  - Every `deleteUser` and `updateUserById` result is checked.
  - `discardUnusedUser()` only deletes a newly created account that no
    open invitation references. A duplicate invitation from a double click
    shows "already invited".
  - Re-invite records the invitation first, then lifts the ban and
    reactivates, and undoes both if either step fails.
  - Remove can be repeated safely, keeping the original removal time.
- **Tests:** new e2e case in `tests/e2e/staff.spec.ts` deletes the
  invitation's account and recreates the address as an independent owner.
  Resend must not touch that owner. It failed before the change. The
  existing invite, accept, remove, resend and cancel tests still pass.

## 6. Voiding an invoice while a payment was being recorded

- **Problem:** recording a payment takes a per-invoice lock; voiding the
  invoice did not. If both happened at the same moment, each check missed
  the other. The result was a void invoice with a live payment, money that
  then disappeared from the resident's balance.
- **Change:** `private.invoices_guard_update` takes the same lock first,
  then checks for payments.
- **Tests:** `tests/integration/review-fixes.test.ts` holds a payment
  transaction open and voids in a second connection. The void now waits,
  then is refused.

## 7. A resident could be erased before their last stay was billed

- **Problem:** "owes nothing" only looked at invoices already issued.
  Someone who left on the 10th could be erased on the 12th. Generating
  that month afterwards billed an erased person with no contact details.
- **Change:**
  - `erase_resident` refuses while any month in which the resident held
    a priced bed has no issued invoice, saying which month to bill first.
    Only months from the hostel's first billed month count, so stays from
    before the hostel used billing don't block anyone.
  - `generate_invoices` skips erased residents as a safety net.
  - The erase screen explains: "Bill October 2026 first: generate that
    month's invoices in Fees, collect what is due, then erase."
- **Tests:** an erasure is refused until the last month is billed and
  paid, then allowed; and billing never invoices an erased resident.

## 8. Erased residents could still get new records

- **Problem:** new deposit entries and reminder log rows could be added for
  an erased resident. A deposit could point at another resident's stay, and
  a reminder at another resident's invoice.
- **Change:** one guard trigger per table refuses both (hints
  `resident_erased` and `reference_other_resident`, each with a plain
  message in the app). Residents' own actions also show a clear message
  for `resident_erased`, where they used to show "Something went wrong".
- **Tests:** two cases in `review-fixes.test.ts`.
- **Found while testing:** my first version shared one trigger function
  between the two tables. PostgreSQL rejects a column the table doesn't
  have even in a branch that never runs. The tests caught it, and the
  function is now split per table.

## 9. Deposit totals overflowed above ₹2.15 crore

- **Problem:** deposit sums were cast to 32-bit integers in four places:
  the dashboard total, the per-resident held amount, the balances view and
  the insert guard. Above ₹2,14,74,836 held, they all failed.
- **Change:** all four use bigint now, and a single entry is capped at
  ₹10 lakh, as the form already was.
- **Tests:** 25 entries of ₹10 lakh (₹2.5 crore), then a refund, with no
  error; an entry of ₹10 lakh + 1 paisa is refused.

## 10. Allocating a bed at the same moment as changing its room or resident

- **Problem:**
  - Archiving a room checked for occupied beds before waiting for an
    allocation that was in progress, so it could archive a room someone
    had just moved into.
  - Marking a resident vacated at the same moment as giving them a bed
    could leave a vacated resident holding a bed.
- **Change:**
  - Archive and shrink lock the room's beds before checking (in
    `rooms_guard_update` and `sync_room_beds`).
  - A new allocation locks the resident's row before checking their
    status.
- **Tests:** two concurrent-transaction tests, both failing before the
  fix. A third, for shrinking, already passed before and stays as a
  regression test.

## 11. The new-hostel trial rule never ran

- **Problem:** the trigger was `SECURITY DEFINER`, so its "signed-in users
  always start on a trial" branch could never match. Column permissions
  happened to cover for it.
- **Change:** it now runs as the caller, so the rule applies.
- **Tests:** the existing trial tests still pass.

## 12. Owners could edit a suspended hostel's details

- **Change:** the hostel update policy excludes suspended hostels.
- **Tests:** new case in `review-fixes.test.ts`. One expectation in
  `tests/rls/platform-admin.test.ts` changed: an owner trying to lift a
  suspension now matches no row at all, where before the status guard
  refused it. Either way, nothing changes.

## 13. The fee month filter listed months with only void invoices

- **Change:** `billed_months` counts issued invoices only.
- **Tests:** new case in `review-fixes.test.ts`.

All eleven tests above fail when run without
`20261018090000_review_fixes.sql`, except the room-shrink case (see 10).

## 14. Erased residents still showed call and WhatsApp links

- **Problem:** after erasure a resident has no mobile number, but the fee
  list, invoice page, reminders page and dashboard still rendered
  `tel:+91` and `https://wa.me/91?...`. WhatsApp then opens a contact
  picker, so a receipt could be sent to the wrong person and still be
  logged as sent. The printed invoice showed an empty Mobile field and the
  invoice page a stray "·".
- **Change:**
  - `whatsAppLink()` returns null without a valid 10-digit mobile.
  - `SendButtons` then offers only Copy.
  - The call links, the "·" separator and the printed Mobile field appear
    only when there is a number; the reminders list says "No mobile
    number", and the residents list and invoice show "—".
- **Tests:** unit cases for `whatsAppLink`; new e2e case in
  `tests/e2e/data-rights.spec.ts` (an erased resident's paid invoice has no
  `tel:` or `wa.me` link, and Copy is still offered).

## 15. Receipts for earlier payments showed today's totals

- **Problem:** the receipt and its WhatsApp text used the invoice's current
  paid and balance figures. For an ₹8,000 invoice paid in two parts, the
  receipt for the first ₹4,000 said "₹8,000 paid, ₹0 due" and "Nothing more
  is due".
- **Change:** `src/features/fees/receipt.ts` (`receiptTotals`) adds up live
  payments up to and including this one, ordered by date received and then
  by when they were entered. The printed receipt (`InvoiceDocument.tsx`) and
  the WhatsApp text (`fees/[id]/page.tsx`) both use it.
- **Tests:** `tests/unit/receipt.test.ts`; `tests/e2e/fees.spec.ts` now
  checks the first part payment's receipt shows ₹3,000 paid and ₹5,000 due
  (it failed before).

## 16. The trial banner printed on invoices and receipts

- **Change:** `TrialBanner` is `print:hidden`.
- **Tests:** `tests/e2e/admin.spec.ts` checks it disappears in print media
  (it failed before).
