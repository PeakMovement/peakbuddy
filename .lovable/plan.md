
# Practitioner alert notifications

When a patient logs a symptom that trips the risk profile, the practitioner is notified instantly on all three channels: push (existing), email with action buttons (new), and WhatsApp via the central webhook (existing, already wired). Not a duplicate of the existing `notifyAssignedPractitioner` flow — that stays for explicit Yves contact requests; this covers the risk-profile alert path.

## Trigger

Everywhere an `alerts` row is inserted today, we add one call to a new `notifyAlertEmail` server fn alongside the existing `notifyAlertPush` and `fireAlertWebhookServer`. Concretely those sites are:
- `src/routes/client.app.checkin.tsx` (risk-profile hit + pattern alert)
- `src/routes/client.app.yves.tsx` (Yves red-flag)
- `src/routes/api/public/triage-query.ts` (server-side triage)
- Nightly hooks in `src/routes/api/public/hooks/*` if they insert alerts

Same risk criteria as today — no changes to what counts as an alert.

Guard: new `alerts.email_fired boolean default false`, mirroring the existing `push_fired` pattern so retries and re-opens don't re-send.

## Email

New React Email template `src/lib/email-templates/practitioner-alert.tsx` registered in `registry.ts` (alongside the existing `practitioner-contact` and `practitioner-checkin`). Sent via existing infra (`/lovable/email/transactional/send`) from `notify.buddy-health.co.za`.

Contents:
- Subject: `⚠ {ClientFirstName} — {urgency} alert`
- Preview: the alert message
- Client name, urgency badge, symptom summary, timestamp
- 4 action buttons:
  1. **View patient** → `https://peakbuddy.lovable.app/practitioner/app/client-detail/{clientId}` (requires login — normal app auth)
  2. **Request check-in** → tokenised link to `/api/public/alerts/action?token=…&action=checkin` which fires the same push `sendCheckInNudge` already sends
  3. **Mark reviewed** → same route, `action=reviewed`; sets `alerts.reviewed_at` + `reviewed_by`
  4. **WhatsApp patient** → `https://wa.me/{clientPhoneDigits}?text=…`, only rendered when `clients.phone` is present

## Tokenised one-click actions

New table `alert_action_tokens` (id, alert_id, practitioner_id, action, expires_at, used_at). Tokens are single-use, 7-day expiry, HMAC-signed with a generated `ALERT_ACTION_SECRET`. New public route `src/routes/api/public/alerts/action.ts` validates the token (bound to `practitioner_id + alert_id + action`), executes, and returns a small branded confirmation page. No session required from the email.

Small `alerts` schema additions: `email_fired boolean`, `reviewed_at timestamptz`, `reviewed_by uuid`.

## WhatsApp

Already covered by `fireAlertWebhookServer` → central webhook (which forwards `practitioner_whatsapp`). No new code. This plan does not add a second WhatsApp path.

## Technical section

**Migration**
- `alerts`: add `email_fired boolean default false`, `reviewed_at timestamptz`, `reviewed_by uuid` (FK `auth.users`).
- `alert_action_tokens`: id, alert_id (FK alerts), practitioner_id (FK auth.users), action text check-in `('checkin','reviewed')`, token_hash text unique, expires_at timestamptz, used_at timestamptz, created_at. RLS enabled, service_role-only, plus GRANTs.

**New / edited files**
- `src/lib/email-templates/practitioner-alert.tsx` — template with 4 CTAs, uses existing `EmailShell`/`CtaButton` from `brand.tsx` for visual consistency with existing templates.
- `src/lib/email-templates/registry.ts` — register `practitioner-alert`.
- `src/lib/alert-actions.server.ts` — HMAC mint/verify + single-use enforcement (server-only extension).
- `src/lib/notify-practitioner.functions.ts` — add `notifyAlertEmail` server fn: idempotent on `email_fired`, loads practitioner email via `supabaseAdmin.auth.admin.getUserById`, loads client (name, phone, id), mints 3 action tokens (view is not tokenised — it goes to the logged-in app), calls `sendTransactionalEmailServer({ templateName: 'practitioner-alert', … })`, sets `email_fired = true`. Keep the existing `notifyAssignedPractitioner` untouched.
- `src/routes/client.app.checkin.tsx`, `src/routes/client.app.yves.tsx`, `src/routes/api/public/triage-query.ts` — after the existing `notifyAlertPush` call, also call `notifyAlertEmail({ alertId })`.
- `src/routes/api/public/alerts/action.ts` — new public route. Validates token, dispatches:
  - `checkin` → extracts push logic from `sendCheckInNudge` into a shared server-only core (`push.server.ts`) so this route can call it without a Supabase session.
  - `reviewed` → updates `alerts.reviewed_at` + `reviewed_by`.
  Marks token `used_at` in the same transaction. Returns minimal branded HTML.
- No changes to `fireAlertWebhookServer` or `notifyAssignedPractitioner`.

**Security**
- HMAC-SHA256 over `alert_id|practitioner_id|action|expires_at` using a generated `ALERT_ACTION_SECRET`. Only the token hash is stored (defence-in-depth if the DB is ever exposed).
- Single-use enforced by `used_at`. 7-day expiry.
- Public action route has no PII in the URL, only the opaque token.
- No email-provider changes; keeps `notify.buddy-health.co.za`.

**Out of scope for v1**
- Digest/batching (answer was "instant").
- Reply-in-email; the confirmation page is the only landing UI.
- Editing WhatsApp routing — stays on the existing central automation.
