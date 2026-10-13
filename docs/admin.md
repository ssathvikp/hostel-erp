# Platform admin (EP-10)

The admin area at `/admin` is for running Hostel ERP itself: finding
customers, helping them, suspending a hostel, and watching how the platform
is used. It can see every hostel's data, so access is tightly limited.

## Who can be an admin

- Only the product owner decides who is an admin. Keep the list short and
  review it whenever someone leaves.
- An admin account is used only for admin work. It cannot own a hostel or
  be staff: `grant-admin.mts` refuses such an account. Use a separate email.

## Adding an admin

1. The person signs up at `/signup` with the email they will use for admin
   work, and confirms it.
2. An operator who holds the service role key runs:

   ```bash
   node scripts/admin/grant-admin.mts grant person@example.com
   ```

   Against staging or production, set `NEXT_PUBLIC_SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` for that project in the shell first.

3. The new admin signs in and is sent to `/admin/mfa` to set up an
   authenticator app. Until they enter a code, they can open nothing else.

No screen, API or signup field can grant the role: `profiles.role` is not
writable by signed-in users and signup ignores any role in its metadata.
The RLS suite proves both (`tests/rls/admin.test.ts`).

## Removing an admin

```bash
node scripts/admin/grant-admin.mts revoke person@example.com
```

The role is read on every request and in every admin database function, so
the next request is refused whatever session the person still holds.

## How access is checked

- Every admin page calls `requirePlatformAdmin()`: anyone else gets a 404,
  and an admin whose session has not passed MFA goes to `/admin/mfa`.
- Every admin database function checks `private.is_platform_admin()`: the
  profile role **and** an `aal2` session. Calling one as an owner, staff
  member, signed-out visitor or admin without MFA fails with `42501`.
- Admins belong to no hostel, so tenant RLS gives them no customer rows.
  They read customer data only through the admin functions, which never
  write customer records. Suspension changes only a hostel's status.

## Audit log

Every look at customer data and every change is written by the database
function itself to `admin_audit_log`, with the admin, the reason, the
hostel or account and the request id. Rows cannot be updated or deleted.
Search it at `/admin/audit`.

A reason is required to open a hostel's support view, suspend or restore,
and for every support action. Owners see each support visit, its date and
its reason (not the admin's name) under Settings → Hostel.

## Support view

`/admin/hostels/<id>` asks why before showing anything. It then shows rooms,
residents, occupancy and fees read-only for 30 minutes; every load is
logged. ID numbers are shown as type and last 4 characters, and ID proof
files cannot be opened.

## Suspension

Suspending a hostel:

- removes it from the app for the owner and staff, who see only that it is
  suspended and how to contact support;
- refuses new invoices and payments for it (`hostel_suspended`);
- deletes nothing;
- queues an email to the owner.

**Decided:** a suspended hostel gives its owner no read-only access in the
app. If they need their data, support exports it for them on request (see
E10-T10). EP-14 builds on this for non-payment.

## Support actions

From an owner's page: resend the sign-up confirmation, send a password
reset, or sign the owner out of every device. Admins never see or set a
password. To change an email address, the owner does it themselves so that
Supabase confirms both addresses.

## Email outbox

Suspension and restore emails are queued in `email_outbox`. **There is no
email provider yet**, so nothing sends them: until one is set up, read the
outbox and send the message by hand. Auth emails (confirmation, password
reset) go through Supabase Auth as before.

## Announcements

`/admin/announcements` publishes a banner shown to every owner and staff
member between its start and end time. Each user can dismiss it.
