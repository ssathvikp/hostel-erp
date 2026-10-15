# Resident complaints from the room (E15-T3, T4, T5)

Residents report problems without an account: each room has a printed QR
code; the resident proves who they are with the mobile number on their
record and a one-time code by SMS; they follow the complaint from a link
texted to them, and confirm the fix or reopen it.

## For the hostel

1. Settings → Complaints → Residents: reporting is on by default; set how
   many days a resident has to confirm a fix (3) before it closes by
   itself.
2. On a room's page, **Make a QR code**, then **Print code** and put the
   card up in the room. **Make a new code** (owners) retires the printed
   one at once, for example if a photo of it was shared outside.
3. A resident's complaint arrives like any other, marked "from the room's
   QR code", routed to a worker as usual. When it is assigned, started and
   marked fixed, the resident gets an SMS with their status link. Their
   confirmation, rating (1 to 5) and comment show on the complaint.

## Security

- **Room codes** are 16 random bytes. They only open the room's page; to
  report anything a resident must also receive the SMS code.
- **One-time codes**: 6 digits, valid 10 minutes, 5 tries, used once,
  stored only as a SHA-256 hash. Only a resident (active or on notice) with
  a live stay in that room, at that number, gets one.
- **Nothing reveals who lives where**: an unknown number, a resident of
  another room, a rate limit or reporting being off all show the same
  "if this number belongs to a resident of this room" message.
- **Rate limits** (in the database): 3 codes per number per 15 minutes and
  10 a day; 30 per room an hour; 5 complaints per resident a day.
- **Sessions** last 2 hours, are stored as hashes, live in an httpOnly
  cookie scoped to `/r`, and end as soon as the resident's stay ends.
- **Status links** are 24 random bytes, last 60 days from the last
  complaint, and show only that resident's complaints from the last 90
  days. Workers appear by trade, never by name or number.
- Everything resident-facing runs on the server with the service role
  through `resident_*` functions that are not executable by signed-in users
  or visitors. Resident photos are checked by real file type like every
  other upload.

## SMS: what to set up

Set `SMS_PROVIDER`:

| Value   | Use                                                                         |
| ------- | --------------------------------------------------------------------------- |
| (unset) | Resident reporting is off; the room page asks residents to tell the warden. |
| `log`   | Development and tests: messages go to the server log, nothing is sent.      |
| `msg91` | Production, through MSG91's Flow API.                                       |

India requires every business SMS to match a **DLT-registered template**
from a registered sender. For MSG91:

1. Register the business (principal entity) on a DLT portal (for example
   Jio or Vodafone Idea's) and a 6-letter sender id.
2. Register exactly these two templates (they are in
   `src/lib/sms/messages.ts`; `{#var#}` marks a variable):
   - `{#var#} is your code to report a problem at {#var#}. It expires in 10 minutes. Do not share it. - Hostel ERP`
   - `Complaint #{#var#} at {#var#}: {#var#}. Track it: {#var#} - Hostel ERP`
3. In MSG91, create a Flow for each with the DLT template id, and set
   `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_RESIDENT_CODE` and
   `MSG91_TEMPLATE_COMPLAINT_UPDATE` (the Flow template ids).
4. Check the Flow API payload against MSG91's current documentation before
   going live (`src/lib/sms/provider.ts`).

Changing a template's wording means registering it again on DLT first.

## Delivery

One-time codes are sent at once. Progress messages are queued in
`sms_outbox` (one per step, never twice) and sent right after the staff
action that queued them, plus by `GET /api/cron/outbox`, which also sends
the billing emails in `email_outbox` (`RESEND_API_KEY`, `EMAIL_FROM`). The
endpoint needs `Authorization: Bearer $CRON_SECRET`. `vercel.json` runs it
daily (the most Vercel's Hobby plan allows); on Pro, or from an external
scheduler such as cron-job.org, run it every 5 minutes.

## Photos (E15-T5)

Phones shrink photos in the browser before upload (longest side 1600 px,
JPEG), for residents, staff and workers alike (`src/lib/images/shrink.ts`).
The server still checks the real type and size.

## Testing

- `tests/integration/resident-complaints.test.ts`: codes, limits, neutral
  refusals, sessions ending with the stay, raising, SMS steps, the status
  link's scope, confirming, reopening, automatic closing.
- `tests/e2e/resident-complaints.spec.ts`: the whole journey in a browser
  with no session, scanned with axe.
- `tests/unit/sms.test.ts` and `tests/unit/images.test.ts`.
