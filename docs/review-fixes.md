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
