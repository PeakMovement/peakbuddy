## Add "Remind Me To Check In" on the Check-In page

### UI (top-right of `src/routes/client.app.checkin.tsx`)
- Small on-brand card/button labeled **"Remind Me To Check In"** with a bell icon (Void Navy + Cold Blue). Shows current schedule ("Daily at 8:00 AM") once set, or "Off".
- Click opens a modal (`ReminderScheduleModal.tsx`) with:
  - **Frequency**: Daily / Morning / Evening / Custom
  - **Time picker** (defaults: Morning 8:00, Evening 7:00)
  - **Day selector** (Mon–Sun chips) — only shown for Custom
  - Save / Disable buttons

### Permission flow
1. On Save → request notification permission via OneSignal (already integrated through `src/lib/push.ts`).
2. If granted → register player ID (existing `linkPushToken` path) and persist schedule.
3. If denied → inline message explaining how to enable in iOS Settings (Despia wrapper).

### Persistence
- New table `public.checkin_reminders` (per client): `client_id`, `enabled`, `frequency` (daily/morning/evening/custom), `time_of_day` (time), `days_of_week` (int[]), `timezone`, `updated_at`.
- Grants + RLS: client can select/update own row; service_role full access.
- Server fns in `src/lib/checkin-reminders.functions.ts`: `getMyReminder`, `upsertMyReminder`, `disableMyReminder` (all `requireSupabaseAuth`).

### Delivery (nightly + minute-tick)
- pg_cron job every 5 minutes hits `/api/public/hooks/checkin-reminders` (auth via `apikey` header).
- Handler selects reminders whose local time (based on `timezone`) falls in the current 5-min window AND today's weekday matches, then calls `sendPushCore` with title "Time for your check-in" and deep link to `/client/app/checkin`.
- Skip if a check-in already exists for that client today.

### Files
- New: `src/components/checkin/ReminderScheduleModal.tsx`, `src/components/checkin/RemindMeButton.tsx`, `src/lib/checkin-reminders.functions.ts`, `src/routes/api/public/hooks/checkin-reminders.ts`, migration.
- Edit: `src/routes/client.app.checkin.tsx` (mount button top-right of header).

### Out of scope
- No changes to the Wearables prompt card or other check-in fields.
- No email reminders (push only for now).
