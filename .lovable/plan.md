## Goal
Seed the `programs` table with a broad catalog of programs (no URLs) covering all current tags plus new ones, so you can test that different check-in symptoms map to the right programs.

## Tag vocabulary (expand current set)
Keep existing keywords in the matcher and add coverage for these tag families. Programs will be tagged from this list:

- Pain regions: `lower-back`, `back`, `neck`, `shoulder`, `knee`, `hip`, `headache`, `general-pain`
- Pain intensity: `high-pain` (auto when pain ≥ 7), `chronic-pain`
- Recovery / lifestyle: `sleep`, `stress`, `energy`, `mood`, `mobility`, `posture`, `desk-worker`, `core-strength`, `flexibility`, `cardio`, `beginner`, `post-injury`, `prehab`

I will also extend `KEYWORDS` in `src/lib/programs.functions.ts` so notes mentioning hip, posture, desk, mobility, etc. derive the right tags.

## Programs to seed (≈14, no URLs)
Each row: name, description, symptom_tags, pain_min, pain_max, priority, active=true, external_url='' (placeholder), image_url=null.

1. **Lower Back Recovery** — `lower-back, back, high-pain, chronic-pain, mobility` — pain 5-10, prio 90
2. **Gentle Back Mobility (Beginner)** — `lower-back, back, beginner, mobility, flexibility` — pain 2-6, prio 70
3. **Neck & Upper Back Relief** — `neck, shoulder, posture, desk-worker` — pain 2-8, prio 80
4. **Shoulder Rehab Basics** — `shoulder, post-injury, prehab, mobility` — pain 2-8, prio 75
5. **Knee Strength & Stability** — `knee, post-injury, prehab, mobility` — pain 2-8, prio 75
6. **Hip Mobility Reset** — `hip, mobility, flexibility, desk-worker` — pain 0-7, prio 70
7. **Headache & Tension Relief** — `headache, stress, neck, posture` — pain 0-8, prio 70
8. **Sleep Reset** — `sleep, stress, mood` — pain 0-10, prio 60
9. **Stress & Recovery** — `stress, mood, sleep` — pain 0-10, prio 60
10. **Energy Builder (Low-Impact Cardio)** — `energy, mood, cardio, beginner` — pain 0-5, prio 65
11. **Mood Lift Movement** — `mood, energy, stress, cardio` — pain 0-6, prio 60
12. **Desk Worker Daily Reset** — `desk-worker, posture, neck, shoulder, hip, mobility` — pain 0-6, prio 70
13. **Core & Posture Foundations** — `core-strength, posture, lower-back, back` — pain 0-6, prio 65
14. **General Movement Foundations** — `beginner, mobility, flexibility` — pain 0-10, prio 40 (fallback)

I'll first delete the current seed rows so the catalog is clean, then insert this set.

## Technical changes
- `src/lib/programs.functions.ts`: extend `KEYWORDS` with `hip`, `posture`, `desk`, `mobility`, `flexibility` triggers; no logic changes.
- Data: DELETE existing programs, INSERT the 14 above via the insert tool. No schema migration needed.

You'll then test by submitting check-ins; URLs can be filled in later from the admin Programs page.