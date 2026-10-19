# Platform admins

Platform admins run Hostel ERP itself: they see every hostel in `/admin`, set
plans and trials, suspend and restore hostels, help owners with their
accounts, and publish announcements. They never work inside a hostel and
cannot change anything in one.

## Who can add or remove an admin

Only someone with the project's service role key, that is the founders, using
the script below. No one can become an admin from inside the app: the `role`
column cannot be written by any signed-in user, and the signup trigger ignores
any role in user metadata.

```sh
# Make an existing account an admin (sign up with that address first)
npm run admin:grant -- someone@example.com

# Take admin rights away (they become a plain owner account, signed out everywhere)
npm run admin:grant -- --revoke someone@example.com

# Lost phone: remove their authenticator and sign them out
npm run admin:grant -- --reset-mfa someone@example.com
```

For staging or production, pass the environment file:
`node --env-file=.env.staging scripts/grant-admin.mts someone@example.com`.

Use a separate e-mail address for an admin account. An admin cannot own a
hostel or be staff in one.

## Second factor

Every admin confirms each sign-in with an authenticator app, such as Google
Authenticator, Microsoft Authenticator or 1Password (TOTP).

- **First sign-in:** after the password, the admin sets up the app from
  `/admin/mfa`, by scanning the QR code or typing the key.
- **Later sign-ins:** the admin enters the 6-digit code.
- **Until then:** every admin page redirects to `/admin/mfa`, and every admin
  database function refuses the session (`mfa_required`). The page check is
  only a convenience; the database check is the one that counts.
- **Configuration:** TOTP is switched on in `supabase/config.toml`
  (`[auth.mfa.totp]`). On a hosted project, also turn it on under
  Authentication → Multi-Factor in the Supabase dashboard.

## What is recorded

Every admin action is written to `admin_audit_log`: who did it, what, to
which hostel or account, why, and when. Entries cannot be changed or removed,
not even with the service role. Browse them at `/admin/audit`.

A reason is required for:

- changing a plan or trial;
- suspending or restoring a hostel;
- opening the support view;
- signing an account out everywhere;
- resending a confirmation e-mail or sending a password reset.

## Support view

`/admin/hostels/<id>/support` shows a hostel's rooms, residents and fees,
read-only, for one hour after the admin gives a reason. The owner sees each
opening, with the reason, in Settings → Hostel. Phone and ID numbers show only
their last four digits, and ID proof files cannot be opened. Admins are
members of no hostel, so the tenant tables stay closed to them; the view is
built by an admin-only database function.

## Suspended hostels

A suspended hostel has no members. Its owner and staff cannot read or change
its rooms, residents, invoices or payments; nothing is deleted. The owner
still sees the hostel and the reason on `/suspended`, and gets everything back
the moment it is restored. Restoring needs a reason too.

There is no e-mail to the owner yet; that needs an e-mail provider.
