## Auto-email the assigned practitioner on "Contact Practitioner"

Replace the manual per-practitioner webhook with built-in Lovable Emails so it works the same in the live iOS build with no per-practice setup.

### Flow
1. Client taps the contact button in the Yves screen.
2. Frontend calls a new server fn `notifyAssignedPractitioner({ clientId, symptomDescription, symptomScore, urgency })`.
3. Server fn (admin-elevated) looks up the client, refuses if `practitioner_id` is null, loads the practitioner's email from `auth.users`, name from `profiles`, and practice from `practices`.
4. Sends a `client-contact-request` app email via `/lovable/email/transactional/send` with a per-event `idempotencyKey` so retries don't double-send.
5. Inserts a row in `alerts` so it also shows in the practitioner's in-app alert list.
6. Returns `{ ok: true }`; UI shows "Notified Dr. X" (existing UX).

### Email template
New `src/lib/email-templates/client-contact-request.tsx`:
- Subject: `[Buddy] {clientName} requested contact`
- Body: client name, urgency badge, symptom description + score, deep link to `/practitioner/app/client-detail/{clientId}`, reminder that this is not an emergency channel.

### Prerequisites (one-time)
1. Lovable Cloud — already enabled.
2. Email domain — set up via the email setup dialog (suggested: `notify.peakmovement.co.za`). I'll trigger that first.
3. `setup_email_infra` + `scaffold_transactional_email` to install queue, send route, suppression, unsubscribe page.
4. Register the new template in `src/lib/email-templates/registry.ts`.

### Code changes
- New: `src/lib/email-templates/client-contact-request.tsx`
- New: `src/lib/notify-practitioner.functions.ts` (server fn)
- Edit `src/routes/client.app.yves.tsx`: replace both `fireContactWebhook(...)` calls with `notifyAssignedPractitioner(...)`.
- Leave `src/lib/webhooks.ts` `fireAlertWebhook` intact (background AI alerts can still optionally hit a webhook). `fireContactWebhook` becomes unused.

### Out of scope
- Push notifications (APNs) — separate piece.
- Removing legacy webhook columns from `practices`.
- Per-practice email template customisation.

### What you'll do
When prompted, pick a sender subdomain (suggested `notify.peakmovement.co.za`) and add the DNS records Lovable shows. Sending starts as soon as DNS verifies.
