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
