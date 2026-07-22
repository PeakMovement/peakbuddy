## Garmin data categories — what Buddy actually pulls

Based on `src/lib/wearables/garmin.ts` and `src/routes/api/public/wearables/garmin/webhook.ts`.

### Backfill requested from Garmin
Buddy requests backfill for these 7 Wellness API endpoints (`GARMIN.BACKFILL_ENDPOINTS`):
- `dailies`
- `sleeps`
- `activities`
- `epochs`
- `stressDetails`
- `userMetrics`
- `hrv`

Garmin then pushes matching data to our webhook.

### Data categories actually stored (webhook → `wearable_sessions`)
Only 4 payload types are mapped and persisted; the rest are received but not currently written to the DB:

**1. Daily summaries (`dailies` → `mapGarminDaily`)**
- Steps (`total_steps`)
- Total calories (`total_calories`)
- Active calories (`active_calories`)
- Resting heart rate (`resting_hr`)

**2. Sleep (`sleeps` → `mapGarminSleep`)**
- Overall sleep score (`sleep_score`)
- Total sleep duration
- Deep / REM / light sleep durations

**3. HRV (`hrvSummaries` → `mapGarminHrv`)**
- Last-night average HRV (`hrv_avg`)

**4. Activities (`activities` → `mapGarminActivity`)**
- Per-day distance accumulated from workouts (`total_distance_km`)
- (Activity start time is used to bucket by date; device model is captured from the `deviceName` field for attribution.)

### Requested but not currently persisted
`epochs`, `stressDetails`, `userMetrics` (VO2 max, fitness age) are subscribed for in the backfill loop but there are no mappers writing them to `wearable_sessions` today.

### Not pulled
No location/GPS tracks, no raw ECG, no body composition, no women's health / menstrual data, no Pulse Ox time series, no health snapshot, no third-party (Training API / Courses / etc.).

---

Want me to also (a) turn on persistence for stress, Body Battery, and VO2 max from the endpoints we already subscribe to, or (b) leave the pull surface exactly as-is?
