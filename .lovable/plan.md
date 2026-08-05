# Backend availability banner (admin portal)

## Why

No users were deleted. All 13 accounts and 36 tables are present. The database was mid-restart when it was first queried, so it briefly returned nothing — the admin screens rendered that as "empty", which looked like data loss.

## What to build

A small safeguard so a restart never looks like deletion again:

- A lightweight backend health check that distinguishes "database unreachable / starting up" from "query returned zero rows".
- A banner at the top of the admin portal: "Backend is restarting — data is temporarily unavailable. Nothing has been lost." shown only when the check fails.
- Admin lists (users, clients, data hub) show "Couldn't load — backend unavailable" instead of an empty-state when the health check is failing, so an outage is never rendered as "no records".

No schema changes, no changes to any user or client data.

## Technical notes

- Add a public server function that runs a trivial `select 1`-style read and returns `{ ok }`, polled by the admin layout on an interval.
- Surface it via a small context/hook so existing admin views can swap their empty-state for an outage state without restructuring their queries.
