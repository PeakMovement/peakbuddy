## Answering your questions

**1. Where you manage the rewards pool today**
Super Admin portal → **Settings** page → **Rewards** section (powered by `RewardsManager`). You can add, edit, deactivate, and delete vouchers there. This is already super-admin only (server-side `assertSuperAdmin` guards every call) — no change needed for that part.

**2. What's missing — global kill switch + day-of-week schedule**
Right now there's only a per-practitioner `gamification_enabled` toggle. There is no platform-wide on/off and no schedule. I'll add both, controlled only by the super admin.

---

## Plan

### Database (migration)
Add two columns to `platform_settings`:
- `rewards_enabled` (boolean, default `true`) — global kill switch.
- `rewards_allowed_days` (smallint[], default `{0,1,2,3,4,5,6}`) — days of the week (0 = Sunday … 6 = Saturday) practitioners are allowed to approve a reward.

### Server logic (`src/lib/rewards.functions.ts`)
In `approveClientReward`, before issuing:
- Load `platform_settings`. If `rewards_enabled = false`, reject with "Rewards are currently disabled."
- Check today's weekday (in UTC) against `rewards_allowed_days`. If not allowed, reject with "Rewards can only be approved on: Mon, Wed, Fri" (humanised list).
- Existing per-practice `gamification_enabled` check stays as a second gate.

Add two new super-admin-only server fns:
- `getRewardsSchedule()` — returns `{ enabled, allowedDays }`.
- `updateRewardsSchedule({ enabled, allowedDays })` — validates and writes.

### UI (`src/components/RewardsManager.tsx`, rendered in Admin → Settings)
Add a **Reward availability** card above the existing pool list:
- Master toggle: **Rewards enabled** (on/off).
- Day picker: seven small chips (Sun–Sat) the super admin taps to allow/disallow each day.
- Save button + inline status.

### Practitioner-side feedback (`src/components/ClientRewardsSection.tsx`)
- Catch the new rejection messages and show them in the existing error slot (no layout change), so a practitioner who tries to approve on a disallowed day sees a clear reason.

### Out of scope (flag if you want it)
- Time-of-day windows (e.g. only between 9am–5pm).
- Per-practitioner overrides of the global schedule.
- Timezone-aware day calculation (plan uses UTC; happy to switch to practitioner's local TZ if you'd rather).

Want me to go ahead with this?