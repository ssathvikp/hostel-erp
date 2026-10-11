# Staging runbook

How to stand up and update the staging environment (E1-T3, E9-T4):
the app on Vercel, the database and auth on a separate hosted Supabase
project, and auth email through a custom SMTP provider.

Staging is the only hosted environment for now. A production project, when
it comes, repeats these steps with its own Supabase project and keys; the
two must never share a database.

## What you need

| Account                  | Used for                                       |
| ------------------------ | ---------------------------------------------- |
| Supabase (free tier)     | The staging database, auth and file storage    |
| Vercel (Hobby)           | Hosting the app, linked to the GitHub repo     |
| An SMTP provider         | Sign-up confirmation and password-reset emails |
| GitHub (this repository) | Secrets for the Staging workflow               |

Any SMTP provider works (Resend, Brevo, Amazon SES, SendGrid, Postmark). It
needs a sender address on a domain you have verified with the provider.
Supabase's built-in email only delivers to the project's own team members, so
real owners would never receive their confirmation link without it.

## Values

Copy `.env.staging.example` to `.env.staging` (git-ignored) and fill it in as
you go. Never commit it.

| Variable                        | Where it comes from                                                       |
| ------------------------------- | ------------------------------------------------------------------------- |
| `STAGING_SITE_URL`              | The Vercel production URL, e.g. `https://hostel-erp-staging.vercel.app`   |
| `STAGING_REDIRECT_URLS`         | Optional: `https://*-<team>.vercel.app/**` to let preview deploys sign in |
| `STAGING_PROJECT_REF`           | Supabase dashboard URL: `supabase.com/dashboard/project/<ref>`            |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → Project Settings → Data API → Project URL                      |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API Keys → publishable key                  |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → Project Settings → API Keys → secret key                       |
| `SUPABASE_ACCESS_TOKEN`         | supabase.com/dashboard/account/tokens (a personal access token)           |
| `SMTP_*`                        | Your SMTP provider's settings page                                        |
| `ID_PROOF_HMAC_KEY`             | Generate once (below); goes in Vercel only                                |

## First-time setup

### 1. Create the Supabase project

1. Create a project named `hostel-erp-staging` in region **South Asia
   (Mumbai)**, next to the Vercel functions (`bom1` in `vercel.json`). Save
   the database password in your password manager.
2. Link this checkout and apply every migration:

   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```

   `db push` applies only migrations the project has not seen, in order, and
   records them, so it is safe to run again.

3. Check that the `id-proofs` storage bucket exists (Storage in the
   dashboard). The migrations create it.

### 2. Deploy the app on Vercel

1. Import the GitHub repository in Vercel. The framework is detected as
   Next.js; leave the build settings at their defaults. The Node version
   comes from `engines` in `package.json` (24.x).
2. Under Settings → Environment Variables, add these for **Production** and
   **Preview**:

   | Variable                        | Value                                    |
   | ------------------------------- | ---------------------------------------- |
   | `NEXT_PUBLIC_SUPABASE_URL`      | from the table above                     |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from the table above                     |
   | `SUPABASE_SERVICE_ROLE_KEY`     | from the table above (mark as Sensitive) |
   | `ID_PROOF_HMAC_KEY`             | output of the command below (Sensitive)  |

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Keep that key in your password manager too. Changing it later makes
   existing residents' ID numbers unmatchable for duplicate detection.
   Never set `ENABLE_DIAGNOSTICS` on Vercel.

3. Deploy. Every push to `main` deploys production; every pull request gets
   a preview URL.

### 3. Configure auth and email

With `.env.staging` filled in, preview and then apply the auth settings:

```bash
npm run staging:auth -- --dry-run   # prints exactly what will be set
npm run staging:auth
```

This sets the site URL and redirect allow-list, the password and session
rules from `supabase/config.toml`, the custom SMTP account, and the email
subjects and templates from `supabase/templates/`. Run it again whenever a
template or the site URL changes.

### 4. Check it end to end

1. Run the smoke journey against the deployed site:

   ```bash
   npm run test:staging
   ```

   It creates a throwaway owner, sets up a hostel, a room, a rate and a
   resident, allocates the bed, generates an invoice, records the payment,
   checks the dashboard, and then deletes everything it created.

2. Once, by hand: sign up with an email address you can read, click the
   confirmation link, then use "Forgot password" and follow that link too.
   The smoke test creates its account already confirmed, so this is the
   check that real email reaches real inboxes.

### 5. Let GitHub run it

The **Staging** workflow (Actions tab → Staging → Run workflow) applies
pending migrations and runs the smoke test. Add these under Settings →
Secrets and variables → Actions:

| Kind     | Name                        | Value                 |
| -------- | --------------------------- | --------------------- |
| Secret   | `SUPABASE_ACCESS_TOKEN`     | personal access token |
| Secret   | `STAGING_DB_PASSWORD`       | the database password |
| Secret   | `STAGING_SERVICE_ROLE_KEY`  | secret key            |
| Variable | `STAGING_PROJECT_REF`       | project ref           |
| Variable | `STAGING_SITE_URL`          | Vercel URL            |
| Variable | `STAGING_SUPABASE_URL`      | Project URL           |
| Variable | `STAGING_SUPABASE_ANON_KEY` | publishable key       |

## Every release

1. Merge to `main`; Vercel deploys the app.
2. Apply new migrations, from the Staging workflow or locally with
   `npx supabase db push`, as soon as the merge lands. A migration that the
   previous version of the app cannot run against must say so in its pull
   request, so its rollout can be planned.
3. Run the smoke test (the workflow does this after migrating).

## Things to know

- **Free-tier pause.** A free Supabase project pauses after about a week
  without activity. The site then fails to sign anyone in until you press
  Restore in the dashboard, which takes a few minutes. Running the smoke
  test weekly keeps it awake.
- **Demo data.** `npm run db:seed` only ever targets the local stack; it
  refuses any other URL. Staging starts empty.
- **Dashboard edits.** Change the schema only through migrations, never in
  the Supabase table editor, or staging drifts from what the tests check.
