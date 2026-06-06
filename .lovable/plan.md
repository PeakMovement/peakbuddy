
# Buddy Login & Registration — iPad/iPhone Audit + Fix Plan

I audited the source (no simulator needed) and found concrete defects that match Apple's "login/registration failed on iPad Air" report. Below: findings, then fixes.

## Findings

### 1. iOS zoom-on-focus (HIGH — likely root cause of Apple rejection)
Every `<input>` and `<select>` in `client.login.tsx`, `practitioner.login.tsx`, `practitioner.signup.tsx`, `practitioner.onboarding.tsx`, `admin.login.tsx` uses `font-size: 15px` (and `16px` placeholders on client.login). When font-size is < 16px, **iOS Safari/WKWebView auto-zooms the page on focus** and never zooms back. On iPad with a connected keyboard this is the classic "I tap password, the layout shifts, the login button is offscreen, I can't submit" reviewer failure.

### 2. `viewport-fit=cover` missing (HIGH on iPad/iPhone with notch/home indicator)
`src/routes/__root.tsx` sets `<meta name="viewport" content="width=device-width, initial-scale=1">`. Without `viewport-fit=cover`, `env(safe-area-inset-*)` evaluates to `0`, so the `.safe-area` class and the root padding do nothing. On iPad in landscape with the home indicator and on iPhone with notch, the submit button can sit under the home indicator / bottom bar.

### 3. iOS keyboard auto-behaviors on email field (MEDIUM)
Email inputs lack `autoCapitalize="none"`, `autoCorrect="off"`, `spellCheck={false}`. iOS uppercases the first letter and autocorrects the address, producing "Invalid email or password." with valid credentials — exactly the "login failed" reviewers see.

### 4. Registration depends on a server secret that may be unset (HIGH)
`registerPractitioner` in `src/lib/practitioner-signup.functions.ts` returns `{ ok: false, error: "Server is missing SEED_SERVICE_ROLE_KEY." }` when `SEED_SERVICE_ROLE_KEY` is absent in the production environment. If the secret isn't set on the deployed Worker, **every iPad/iPhone signup fails** after the auth user is already created (orphan auth user, user can't retry). Needs a runtime check.

### 5. Tap target sizes < 44×44 pt (MEDIUM — Apple HIG)
- Password show/hide eye button: 18px icon + 8px padding = 34×34 — under Apple's 44pt minimum.
- POPIA checkbox visual is 22×22 (full row is tappable, so OK, but the icon button isn't).
- Stepper circles 28×28 are decorative, fine.

### 6. iPad layout: form is a 360-px column on a 1180-px screen (LOW)
Not broken, but on iPad landscape with keyboard up the form is centered in a sea of navy and the submit button can be hidden by the keyboard because the page doesn't scroll the focused field into view. Combined with #1, reviewers report "can't reach Sign in."

### 7. `client.login` sign-in flow signs the user out immediately (INFO — by design)
This is intentional (looks up `clients` row as anon), but it means on slow networks there's a window where `signInWithPassword` succeeds, then `signOut` is in flight, then the `clients` lookup runs anon. If signOut hasn't fully cleared by the time the SELECT runs, RLS may behave inconsistently. Worth verifying after the other fixes.

### 8. `practitioner.signup` `emailRedirectTo` uses `window.location.origin` (LOW for web; matters when wrapped)
Fine for Safari testing; if the iPad build is a native wrapper (Capacitor), this needs the universal-link URL instead. Out of scope unless the iOS submission is a wrapped build — flag for confirmation.

---

## Fixes

### A. Global viewport + zoom prevention (`src/routes/__root.tsx`, `src/styles.css`)
- Change viewport meta to `width=device-width, initial-scale=1, viewport-fit=cover`.
- In `styles.css`, add a global rule so every form control is **16px on iOS** (prevents zoom-on-focus) while keeping the visual 15px elsewhere:
  ```css
  input, select, textarea { font-size: 16px; }
  ```
  Then drop explicit `fontSize: 15` from the inline `inputStyle` objects (or raise them to 16). 16px is the smallest safe value.

### B. Email field hardening (all 4 login/signup routes)
Add to every email input:
```tsx
autoCapitalize="none"
autoCorrect="off"
spellCheck={false}
name="email"
```
Add `name="current-password"` / `name="new-password"` to password fields to enable iOS Passwords/Keychain autofill (also helps reviewers).

### C. Safe-area + scroll-into-view for keyboard
- Keep `.safe-area` class; now that `viewport-fit=cover` is set, it'll actually pad.
- Add `scroll-margin-bottom: 120px` to inputs so iOS scrolls the focused field above the keyboard:
  ```css
  input, select, textarea { scroll-margin-bottom: 120px; }
  ```

### D. Tap targets ≥ 44×44 pt
- Password eye toggle: bump to `min-width: 44px; min-height: 44px` in `eyeBtn` style (3 files: signup, practitioner.login, admin.login).
- All primary submit buttons already use `minHeight: 48` — OK.

### E. Registration server-fn resilience (`src/lib/practitioner-signup.functions.ts`)
- Detect missing `SEED_SERVICE_ROLE_KEY` at the start, return a clear error before the auth user is created — currently the auth user is created in the component first, then the server fn fails, leaving an orphan auth account that can't sign up again.
- Better: move `supabase.auth.signUp` into the same server fn (using admin client + `auth.admin.createUser`) so the whole signup is atomic. Optional — minimum fix is the early-exit + a UI message telling the user "Server config error, contact support" before the auth.signUp call (preflight ping).

### F. iPad layout polish (optional but recommended)
- Raise form container `maxWidth` from 360/380 to `min(420px, 100%)` and add `paddingBottom: 120px` so the submit button isn't flush against the bottom safe area on iPad landscape.

### G. Quick verification pass after edits
- Use the browser tool at iPad viewport (834×1194 + 1194×834 landscape) and iPhone (390×844 + 844×390) to walk through:
  - `/client/login` → demo creds → land on `/client/app/checkin`
  - `/practitioner/login` → demo practitioner creds → dashboard
  - `/practitioner/signup` → fill form → success state
  - Confirm no zoom on input focus, submit button visible with keyboard up (simulated by shrinking viewport height).

---

## Files to change

```text
src/routes/__root.tsx                       # viewport meta
src/styles.css                              # 16px form controls + scroll-margin
src/routes/client.login.tsx                 # email attrs, tap targets
src/routes/practitioner.login.tsx           # email attrs, eye btn 44pt
src/routes/practitioner.signup.tsx          # email attrs, eye btn 44pt
src/routes/admin.login.tsx                  # email attrs, eye btn 44pt
src/routes/practitioner.onboarding.tsx      # input font-size cleanup
src/lib/practitioner-signup.functions.ts    # preflight secret check
```

## Out of scope (call out, don't fix here)

- Whether the iOS submission is a Capacitor/native wrapper (affects email-confirmation deep link).
- The `client.login` sign-in/sign-out dance — keep current behavior unless post-fix testing shows a race.
- Visual redesign for iPad (form stays centered narrow column; acceptable).

## Questions before I start (none blocking, but useful)
1. Is the iOS app a native Capacitor wrapper or just `peakbuddy.lovable.app` opened in Safari/WebView? Affects fix F (deep link).
2. Is `SEED_SERVICE_ROLE_KEY` set on the production Worker? If not, I'll add a Lovable secret prompt during the fix.

Approve and I'll apply all of the above in one pass, then verify with the browser tool at iPad + iPhone viewports.
