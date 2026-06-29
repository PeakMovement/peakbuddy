## Goal
1. Verify in-app push notifications actually deliver end-to-end through the Despia → OneSignal bridge.
2. Make iOS Password AutoFill / Face ID AutoFill work inside the Despia-wrapped WebView.

---

## Part 1 — Test in-app notifications

### What we know from the codebase
- `src/lib/push.ts` calls `window.despia?.requestPushToken()` to get a device token, then `savePushToken` writes it to `push_tokens`.
- `src/lib/push.functions.ts` `sendPushCore` currently **simulates** delivery — it logs `"[sendPush] would notify…"` and returns `simulated: true`. The "real OneSignal REST" wiring referenced earlier is not actually present in this file; the `DESPIA_PUSH_SEND` block is still a stub.
- Triggers exist for: practitioner → client check-in nudge, reward issued, Yves/morning alert push.

So today, even if a token is saved, **no notification is actually sent**. We need to (a) confirm the token saves, then (b) add a real send path before any test can succeed.

### Build steps
1. **Add a Super-Admin "Send test push" tool**
   - New section in `admin.app.settings.tsx`: pick a user (or "me"), enter title/body, button → `sendPush` server fn.
   - Surface the response (`attempted`, `delivered`, `simulated`, `failures`) directly in the UI so we can see why a send fails.
2. **Add a client-side "Notification status" panel** in `client.app.profile.tsx`:
   - Shows whether `window.despia` bridge is present, whether a token is saved for this user, last_seen timestamp, and a "Send test to myself" button (gated to demo accounts + super admin).
3. **Wire real delivery in `sendPushCore`**
   - Replace the stub with a real OneSignal REST call using `ONESIGNAL_APP_ID` + `ONESIGNAL_REST_API_KEY` (request via add_secret if missing).
   - Map our stored `token` (OneSignal player_id from the Despia bridge) to `include_player_ids`.
   - Set `simulated: false` and return real per-token success/failure.
4. **Log every send attempt** to a new lightweight `push_send_log` row (id, user_id, title, status, error) so we can diagnose without console access on device.

### How we'll actually test
- Open the published app on your iPhone through Despia → log in → open Profile → confirm "bridge: yes, token saved: yes".
- From Super Admin → Settings → "Send test push" → target your client account → expect a banner notification within seconds.
- If nothing arrives: check the new `push_send_log` and OneSignal dashboard delivery response surfaced in the UI.

---

## Part 2 — iOS Password / Face ID AutoFill inside Despia

### Why it's broken today
iOS only offers Password AutoFill in a WebView when **all** of these are true:
- The app ships an `apple-app-site-association` (AASA) file declaring `webcredentials` for the domain.
- The native app has the `com.apple.developer.associated-domains` entitlement with `webcredentials:<your-domain>`.
- The login form uses standard `<input type="email" autocomplete="username">` + `<input type="password" autocomplete="current-password">` (or `new-password` on signup), inside a real `<form>`.

Despia wraps the site as a WKWebView. Without the entitlement + AASA, iOS treats the form as untrusted and suppresses the AutoFill / Face ID prompt. That's the core fix.

### Build steps (web side — what we control)
1. **Audit & fix every login/signup form** so AutoFill heuristics fire:
   - `admin.login.tsx`, `client.login.tsx`, `practitioner.login.tsx`, `practitioner.signup.tsx`.
   - Confirm each has: real `<form>`, `name="email"`/`name="password"`, `autocomplete="username"` and `autocomplete="current-password"` (or `new-password` for signup), `type="email"`, `inputMode="email"`, `id` attributes, and a same-form submit button. Most are close — we'll fill the gaps (e.g. `autocomplete="username"` is missing on the email fields).
2. **Publish an AASA file** at `https://peakbuddy.lovable.app/.well-known/apple-app-site-association` via a TanStack server route returning JSON (`application/json`, no extension):
   ```json
   { "webcredentials": { "apps": ["TEAMID.bundle.id"] } }
   ```
   You'll need to give me your Apple Team ID + iOS bundle ID from Despia.
3. **Add a clear in-app help row** on the login screens: "Save password" instructions for users on the current build.

### Despia-side steps (you do this, I'll write the exact checklist)
1. In Despia's dashboard, enable **Associated Domains** for `webcredentials:peakbuddy.lovable.app` (and your custom domain if/when added).
2. Rebuild and re-publish the iOS binary — entitlement changes need a new build, not just a content refresh.
3. After install, iOS fetches the AASA once; you may need to delete + reinstall the app to force the refetch.

### Fallback if Despia won't expose Associated Domains
Two safety nets we can ship now so users aren't stuck retyping:
- **"Remember me" + magic-link** is already implemented — surface it more prominently on the login screen.
- Add **biometric session unlock** via a long-lived refresh token + a "stay signed in for 30 days" toggle, so Face ID effectively replaces re-login at the OS prompt level even without true AutoFill.

---

## Open questions before I build
1. Do you have **OneSignal credentials** set up in Despia already (App ID + REST API key)? If yes I'll request them as secrets; if no, we need to create the OneSignal app first.
2. Can you share your **Apple Team ID** and **iOS bundle identifier** from the Despia build settings? Needed to write the AASA file.
3. Should the "Send test push" tool be **super-admin only**, or also available to practitioners for their own clients?
