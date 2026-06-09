## What you're seeing — and why

I checked the data and the code paths and found two concrete bugs.

### 1. The onboarding intro never shows for Bruce Wayne
There are **two `clients` rows with the same email** `peakmvement@gmail.com` — one has the Knee program assigned (`pending`), the other has no program. The lookup that powers the intro modal uses `.maybeSingle()`, which silently returns `null` whenever more than one row matches. So when Bruce logs in, the bootstrap call returns "no client found" → no modal, no banner, nothing different from a normal check-in.

Nothing is wrong with your onboarding flow itself — the duplicate row is masking it.

### 2. The check-in suggestion ignores the practitioner-assigned program
`suggestProgram` runs a generic keyword match across **all 14 active programs** and ignores `clients.suggested_program_id` entirely. So when Bruce logs "knee pain", the matcher fires whatever scores highest globally (often Lower Back or a generic one), never the Knee Stability program his practitioner assigned. It also fires on almost every check-in because a single tag hit is enough.

---

## Fix plan

### A. Clean up duplicate clients + prevent it happening again
- **Data fix (migration)**: collapse the two `peakmvement@gmail.com` rows — keep the one with `suggested_program_id` set, delete the empty duplicate. Reassign any `check_ins` / `alerts` from the deleted row to the kept one first.
- **Schema**: add a unique index on `lower(email)` in `clients` so this can't happen again.
- **createClientAccount**: return a friendly "this email is already a client" error instead of inserting a second row.
- **Defensive lookup**: change `loadClientByAuth` to `.order("created_at", { ascending: false }).limit(1)` so a future near-miss still resolves to the most recent record instead of silently returning null.

### B. Make the check-in suggestion respect the assigned program and stop over-suggesting
Rework `suggestProgram` so it takes the client into account:

1. **Pass the client id** from the check-in screen into `suggestProgram`.
2. **Prefer the assigned program** when it's relevant. If the client has a `suggested_program_id` AND the check-in matches its `symptom_tags`/`focus_area` OR pain is in its range → return that program with a reason like *"Your knee program from Dr. X fits today's check-in."*
3. **Tighten the threshold for everything else**. Only surface a non-assigned program when:
   - it overlaps **2+ tags** with the check-in, OR
   - pain ≥ 7 AND the program's focus area matches the dominant tag.
   Otherwise return `null` (no card). The AI fallback only runs in this stricter mode.
4. **Never suggest a program the client already accepted or declined** — if `program_status = 'accepted'` and the assigned program matches, just affirm it ("Keep going with your knee program"). If `declined`, skip suggestions for that program entirely.

### C. Surface the assigned program on the check-in screen too (small UX touch)
At the top of the check-in form, if the client has an accepted program, show a one-line reminder ("Today: Knee Strength & Stability — Day X"). This makes the program feel present every day, not just on day one. *(Light addition — say no if you want me to skip it.)*

---

## Technical details

**Files touched**
- `supabase/migrations/<new>.sql` — merge duplicate Bruce Wayne rows, add `UNIQUE (lower(email))` index on `clients`
- `src/lib/client-program.functions.ts` — defensive lookup order; new `getMyAssignedProgramForSuggestion` helper
- `src/lib/programs.functions.ts` — `suggestProgram` accepts optional `clientId`, branches on assigned program, raises match threshold
- `src/lib/clients.functions.ts` — duplicate-email guard in `createClientAccount`
- `src/routes/client.app.checkin.tsx` — pass `clientId` to `suggestProgram`; (optional C) top-of-screen program reminder

**Out of scope** (say if you want any of these)
- Changing how clients log in (still email/password via Supabase auth)
- Re-designing the practitioner program picker
- AI rewriting the suggestion copy
