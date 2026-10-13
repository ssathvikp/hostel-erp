# Data protection (E10-T10)

Hostel ERP stores personal data about residents (names, phone numbers,
addresses, dates of birth, guardians and KYC references) on behalf of
hostel owners. Under India's **Digital Personal Data Protection Act 2023**
the hostel is the data fiduciary for its residents and Hostel ERP processes
the data for it. This page records what the product does and the retention
rules it follows.

> **Status: to be confirmed by a lawyer before the first paying hostel.**
> The retention periods below are proposals based on the usual Indian
> record-keeping rules. Nothing here is legal advice.

## What owners can do in the app

| Request                 | Where                                    | What happens                                                                                   |
| ----------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Export all hostel data  | Settings → Hostel → Your data            | One JSON file with every table for the hostel. Recorded in `data_requests`.                    |
| Erase a former resident | The resident's page, once they have left | Personal fields and the ID proof file are deleted for good; financial records stay. Recorded.  |
| Close the owner account | Settings → Hostel → Your data            | Scheduled 30 days ahead so a final export can be taken; can be cancelled until then. Recorded. |

Admins see every request at `/admin/requests`.

## What erasure removes and keeps

Removed: name (replaced by "Erased resident"), mobile and alternate
numbers, email, gender, date of birth, permanent address, guardian name and
number, notes, ID proof type, last 4 characters and keyed hash, and the
ID proof file.

Kept: the resident's record id, stays (dates, bed, rent), invoices with
their numbers and lines, payments and receipts, charges, deposits and
credit. These are financial records the hostel must keep (see below). They
show the resident as "Erased resident".

An erased resident cannot be edited or erased again (`resident_erased`).
Only a resident who has left can be erased: status vacated and no current
or future stay.

Not covered yet: free text that mentions a resident elsewhere (a complaint
description or comment). The owner should edit those by hand.

## Retention (proposed)

| Data                                       | Kept for                                                 | Basis to confirm                                |
| ------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------- |
| Resident personal data                     | While they stay, then until erased or the account closes | DPDP Act 2023: no longer than the purpose needs |
| ID proof files                             | While they stay; erased with the resident                | DPDP Act 2023                                   |
| Invoices, payments and other money records | 8 years from the end of the financial year               | Income-tax and GST record-keeping rules         |
| Admin audit log                            | 8 years                                                  | Accountability for access to customer data      |
| Closed accounts                            | Deleted 30 days after the request, except money records  | Notice period for a final export                |

## Closing an account (operator steps)

Closures are carried out by an operator, not automatically, until the
retention rules above are confirmed:

1. On or after the scheduled date (`/admin/requests` shows it as due),
   check that the owner has had the chance to export.
2. Erase every resident of the owner's hostels (each must have left; vacate
   them first if the hostel has closed).
3. Suspend the owner's hostels so nothing new can be recorded.
4. Keep the money records for the retention period, then delete the
   hostels and the owner's account.
5. Note the completion date against the request.

## Not in this task

- Consent capture and notices for residents (residents have no login yet).
- Automatic deletion jobs; they wait for the retention rules to be signed off.
