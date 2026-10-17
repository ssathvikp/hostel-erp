# ClickUp sync - Hostel/PG ERP

This folder is the repo-side mirror of the ClickUp development plan. **ClickUp is the source of truth for task status.** These files keep the plan reproducible and reviewable in git.

## Files

| File | Purpose |
|---|---|
| `targets.json` | ClickUp team, space, folder and list IDs |
| `plan-0N.ndjson` | The full plan spec, one JSON object per task |
| `created-tasks.json` | Map of plan key (for example `E6-T3`) to ClickUp task id and URL |
| `sync-plan.ps1` | Idempotent push: creates only missing tasks, wires dependencies, writes the mapping |
| `sync.log` | Log of the last push: created, skipped and failed counts |

## Spec fields

`k` key | `t` epic or task | `p` parent epic key | `name` | `pri` 1 urgent to 4 low | `h` hours | `deps` blocked-by keys | `tags` | `w` what and why | `ac` acceptance criteria bullets | `out` out of scope | `f` affected files | `dod` definition of done override | `sec` section heading override | `chk` false for plain bullets | `list` sets the backlog list

## How to push changes

```
powershell -ExecutionPolicy Bypass -File scripts/clickup/sync-plan.ps1
```

- The script skips any task whose name already exists in the target list, so re-runs never create duplicates.
- It requires `CLICKUP_API_TOKEN` in `.env.local` at the project root, which is gitignored. Never commit it.
- Effort is pushed to the native **Time Estimate** field in milliseconds.

## ClickUp structure mapping

```
Workspace : Sai Sathvik P s Workspace
Space     : HOSTEL ERP
Folder    : Hostel/PG ERP
  List    : MVP - v0.1            -> 9 epic parent tasks + 63 subtasks
  List    : Backlog - Post-MVP    -> 3 epic parent tasks, no subtasks yet
```

## Known ClickUp API limitations

1. **Custom field definitions cannot be created through the API** (read and set values only), so effort is carried by the native Time Estimate field instead of a custom field.
2. **Space statuses cannot be set through the API.** The Space carries ClickUp s native statuses. Adding Backlog, In Progress, Blocked and In Review is a manual step in Space settings.
3. Dependency edges require one API call each (`depends_on` or `dependency_of`, never both). The reciprocal link is created automatically by ClickUp.
4. Rate limit is 100 requests per minute on Free, Unlimited and Business plans, so bulk operations must be paced.

## Scope decisions (recorded)

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-21 | MVP is fixed at the 9 MVP epics, 63 tasks, 280 hours | Ship a usable product before widening scope |
| 2026-09-21 | EP-10, EP-11 and EP-12 remain container epics with zero subtasks | Detail is written only when an epic is scheduled; no invented requirements |
| 2026-09-21 | The gaps listed below stay out of the MVP by choice | Owner decision, taken with the retrofit cost understood |
| 2026-10-17 | Scheduled the backlog work that needs no external account (plan-10.ndjson): EP-10, EP-11 manual channel, staff and deposits from EP-12, and new EP-13 for data import and DPDP | MVP complete; these are what the first paying hostels need. Tasks tagged `built` are done in code; set their ClickUp status after syncing |

### Gaps knowingly deferred out of the MVP

- SaaS billing and subscriptions: how the hostel owner actually pays you
- Data import from an owner s existing spreadsheets (rooms, beds, residents)
- Data protection and DPDP Act 2023: consent, retention, export and erasure of stored KYC data
- Resident-facing portal or mobile app
- Marketing site and trial signup funnel
- Backups, disaster recovery, paid monitoring and product analytics
- Native mobile app; the MVP is responsive web only

Revisit when scheduling EP-10 to EP-12. Reconsider data import and DPDP specifically before the first paying hostel, because both are expensive to retrofit.

## Open actions

- [ ] Rotate the ClickUp API token, because it was shared in a chat message, then update `.env.local`
- [ ] Add statuses in the HOSTEL ERP space: Backlog, In Progress, Blocked, In Review. The ClickUp API cannot set statuses, so this is a manual step
- [ ] Confirm the Backlog, In Progress, Blocked and In Review statuses exist before Phase 7 status updates are attempted
