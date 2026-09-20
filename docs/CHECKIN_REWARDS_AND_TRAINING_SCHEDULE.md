# Training schedule × symptoms, and restaurant check-in rewards

Two production features on Buddy. Neither touches the Peak Movement marketing site.

## 1. Symptom layout × training schedule

**What it is.** Practitioners log a client's training sessions (hard / moderate / recovery / rest / competition). Buddy overlays those days on check-in symptom scores (pain, sleep, stress, energy, flags) so you can see whether symptoms spike around hard sessions or ease on recovery days.

**Where the schedule comes from**

| Source | Used as | Notes |
| ------ | ------- | ----- |
| **Manual `training_sessions`** (this feature) | Source of truth for “hard vs recovery vs rest” | Practitioner (or practice owner) adds sessions on the client detail page |
| Wearable `wearable_sessions` | Optional overlay (training load) | Oura / Polar / Garmin when connected. Not a planned calendar |
| Google Calendar / iCal | Check-in **reminders** only | Not imported as workouts |

There is no wearable or calendar import of a training *plan*. If Justin later wants Garmin workouts or a GCal training calendar, that is a follow-up.

**Enable / hide**

1. Code kill-switch: `TRAINING_SCHEDULE_CROSSCHECK` in `src/lib/feature-flags.ts` (default `true`).
2. Admin → Settings → **Show symptom × training schedule overlay** (`platform_settings.training_schedule_enabled`, default on).

**Apply the migration** (Lovable Cloud → Supabase → run pending migrations, or `supabase db push`):

`supabase/migrations/20260920150000_training_schedule_and_restaurant_partners.sql`

**UI**

- Practitioner client detail: “Symptoms × training” card — add session, overlay chart, observations.
- Client Progress: read-only overlay of the same data.
- Admin Data Hub already has a *wearable load vs pain* cross-check; this feature is the **scheduled session** version and does not replace Data Hub.

Health data stays in Buddy. The overlay is local math (no model call, no restaurant/partner payload).

## 2. Restaurant discount incentives for check-ins

**What it is.** Extends the existing `rewards` / `client_rewards` engine. Super-admin (Justin) and practitioners manage **restaurant partners** and attach redeemable discount vouchers. Clients earn them by check-in streaks (3 / 7 / 14 / 30) or a lifetime check-in count, or a practitioner can approve one. Redeem in Profile (“Mark as used”). After a qualifying check-in the voucher is revealed on the success screen.

**Justin’s restaurant list is not in the database.** Tables start empty on purpose. Do not seed fake venue names.

### Load restaurants

**Option A — Admin UI (preferred)**

1. Activate Rewards: Admin → Settings → Rewards → **Activate rewards** (and allowed SAST days).
2. Admin → Settings → **Restaurant partners** → add each venue (name, city, address, maps URL). Tick **Platform-wide** so every practice can issue that partner’s discounts.
3. On each partner, **Add discount** — voucher code, % off, and earn rule:
   - *Streak milestone* (optional required streak 3 / 7 / 14 / 30)
   - *After N check-ins*
   - *Practitioner approve only*
4. Practitioners can add extra **practice-scoped** partners on Practitioner → Settings if a local café is not on Justin’s list.

**Option B — SQL** (clearly marked example, replace names before running):

See `docs/examples/restaurant-partners.example.sql`.

**Rollout flags**

- `RESTAURANT_REWARD_PARTNERS` in `src/lib/feature-flags.ts` (default `true`).
- Issuance still requires `platform_settings.rewards_enabled` (off until you activate Rewards) plus practice `gamification_enabled` / `auto_reward_enabled`.

### POPIA / partners

Buddy **does not send patient names, check-ins, or any health data to restaurants**. Partners only appear on the client’s voucher in-app. Redemption is “show code at the till”; there is no partner API.

## Follow-ups for Justin

- Provide the real restaurant list (name, city, discount %, voucher codes, maps links, earn rule).
- Confirm whether platform-wide partners are Peak Movement-wide (current default) or per-practice only.
- Optional later: import training from wearables or Google Calendar; weekday `client_patterns` as a second overlay series.
