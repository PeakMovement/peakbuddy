## Goal
Backfill ~7 weeks (49 days) of realistic, compliant check-in history for the demo client (`client@demo.com`) so the demo practitioner (`practitioner@demo.com`) sees a rich dashboard, progress charts, and timeline.

## Approach
Single SQL insert (via `supabase--insert`) that:

1. Looks up the demo client + practitioner IDs by email (no hardcoded UUIDs).
2. Deletes existing auto-seeded check-ins for that client in the last 60 days to avoid duplicates on re-run.
3. Inserts 49 daily check-ins (today − 48 … today) with a believable "compliant + improving" arc:
   - **Pain**: starts ~7/10, trends down to ~2/10 with small day-to-day noise and the occasional flare day.
   - **Sleep**: starts ~5, climbs to ~8.
   - **Stress**: starts ~7, drifts down to ~3.
   - **Energy**: starts ~4, climbs to ~8.
   - **Mood**: weighted rotation through `rough` → `okay` → `good` → `great` as the weeks progress.
   - **Medication taken**: ~90% true (compliant).
   - **Notes**: short, varied human-sounding lines (e.g. "Morning stretches helped", "Slept through the night", "Light flare after gardening").
   - **Flagged**: only true on the 1–2 highest-pain early days.
   - `created_at` set to the synthetic date so charts/timeline render correctly.

## Out of scope
- No new alerts, symptom_queries, or program data.
- No schema changes.
- No edits to `scripts/seed-demo.ts` (one-off backfill; can revisit later if you want it auto-seeded).

## Verification
After insert, run a quick `SELECT count(*), min(created_at), max(created_at)` to confirm 49 rows across the right window, then you can open the practitioner dashboard → Demo Client to see the history.
