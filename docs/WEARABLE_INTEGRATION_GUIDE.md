# Wearable Integration Guide — Oura, Polar & Garmin

How to integrate the three wearables into **PeakBuddy**, porting the proven logic from the
PREDICTIV MVP. This document is the implementation plan: architecture decision, data model,
secrets, per-provider flows, the PeakBuddy-native code layout, and a phased rollout.

> ## 🎯 Scope of this build (MVP)
> **Two things only:** (1) a user can **connect** their Oura / Polar / Garmin account, and
> (2) their wearable data is **fetched and displayed** in the app.
>
> **In scope:** OAuth connect flow, token storage/refresh, pulling each provider's data into
> `wearable_sessions`, and a UI to show it (connection status + the metrics).
>
> **Out of scope (deferred):** feeding wearable signals into baselines, risk scoring, predictive
> nudges, alerts, and training-load math (ACWR/strain/monotony). The schema leaves room for these,
> but we do **not** build them now. Sections §3.3 (`training_trends`) and §8 (intelligence wiring)
> are marked *deferred* — skip them for the MVP.

> **Source of truth for the logic:** the PREDICTIV repo (`predictivmvp`) already ships working
> Oura, Polar, and Garmin integrations as ~25 Supabase Edge Functions. We are not re-deriving the
> OAuth/webhook logic — we are *porting* it into PeakBuddy's architecture. Use the PREDICTIV
> functions as reference implementations (endpoints, scopes, refresh quirks are all proven there).

---

## 1. The core architectural decision (read this first)

The two apps run server code differently. This is the single most important thing to get right.

| | PREDICTIV (source) | PeakBuddy (target) |
|---|---|---|
| Server runtime | **Supabase Edge Functions** (Deno) | **Cloudflare Workers** via TanStack Start |
| Server logic | `supabase/functions/*/index.ts` | `src/lib/*.functions.ts` (`createServerFn`) + `src/routes/api/**` (route handlers) |
| Supabase role | DB + Auth + **compute** | DB + Auth **only** (no `supabase/functions/` dir exists) |
| Scheduled jobs | Supabase cron → edge function | External cron → API route guarded by `CRON_SECRET` |

PeakBuddy currently has **no** `supabase/functions/` directory. You have two options:

### Option A — Port to TanStack Start / Cloudflare Workers ✅ Recommended

Reimplement the wearable logic as PeakBuddy-native API routes + server functions. OAuth callbacks
and webhooks become `src/routes/api/public/wearables/...` route handlers; sync logic becomes
`src/lib/wearables/*.functions.ts`. One backend, one deploy, one set of conventions
(CORS helper, `CRON_SECRET`, `client.server.ts`).

- **Pro:** single runtime, native to PeakBuddy, no second deploy target, reuses existing auth
  middleware and CORS/rate-limit patterns already in `src/routes/api/public/`.
- **Con:** the Deno edge functions can't be copy-pasted; logic must be transcribed to Web-standard
  `fetch`/`Request`/`Response` (mostly mechanical — both runtimes are Web-API based).

### Option B — Add Supabase Edge Functions to PeakBuddy

Spin up `supabase/functions/` in PeakBuddy and copy the PREDICTIV functions nearly verbatim.

- **Pro:** maximum code reuse; fastest to a working prototype.
- **Con:** introduces a *second* backend runtime/deploy alongside Cloudflare Workers, splits secrets
  and conventions, and diverges from how every other PeakBuddy server feature is built.

**Recommendation: Option A.** The reuse win of Option B is real but one-time; the architectural
cost is permanent. The OAuth/webhook code is Web-standard already, so porting is transcription, not
redesign. The rest of this guide assumes **Option A** (notes call out where B differs).

> Decision needed from you: confirm Option A before Phase 2. If you'd rather ship the prototype fast
> and refactor later, say so and we'll do Option B first.

---

## 2. Provider cheat-sheet (the quirks that bite)

All three are OAuth2 but differ in ways that dictate the implementation:

| Aspect | Oura | Garmin | Polar |
|---|---|---|---|
| OAuth variant | Standard (secret in callback) | **PKCE** (code_verifier/challenge, no secret to browser) | Standard (HTTP Basic on token exchange) |
| Authorize URL | `cloud.ouraring.com/oauth/authorize` | `connect.garmin.com/oauth2Confirm` | `flow.polar.com/oauth2/authorization` |
| Token URL | `api.ouraring.com/oauth/token` | `diauth.garmin.com/di-oauth2-service/oauth/token` | `polarremote.com/v2/oauth2/token` |
| Scopes | `email personal daily heartrate workout tag session spo2` | (set in Garmin app config) | `accesslink.read_all` |
| Token refresh | Yes (refresh_token, ~30d expiry) | Yes (refresh_token, **~24h expiry**) | **No** (long-lived token) |
| Data delivery | **Pull** (REST v2) | **Push only** (webhooks + backfill — OAuth apps *cannot* pull live data → `InvalidPullTokenException`) | **Pull** (AccessLink v3, 2 endpoints) |
| Post-auth step | — | Fetch stable `userId`; request **backfill** to populate history | **Register user** at `accesslink/v3/users` (needs consent) |
| Stable user id | not needed | **essential** (`provider_user_id` for webhook routing) | `x_user_id` |
| Webhook | Yes (HMAC-SHA256 verify) | Yes (must always return 200) | Planned/optional |
| Consent failure mode | — | — | 403 if user hasn't consented in Polar app |

**The three "gotchas" that cause most lost time:**
1. **Garmin is push-only.** After OAuth you must call its `/backfill/*` endpoints to make Garmin
   push history to your webhook. There is no synchronous pull. Build the webhook *first*.
2. **Garmin webhook user resolution** is hard because the Health-API `userId` can differ from what
   you stored. PREDICTIV uses a 3-tier fallback: `provider_user_id` → `access_token` →
   single-active-user self-heal. Port this exactly.
3. **Polar needs an explicit user-registration call** after token exchange, and silently 403s
   without in-app consent.

---

## 3. Database schema (new migrations)

Add to `supabase/migrations/`. PeakBuddy is client/practitioner-centric, so key wearable data on
**`client_id`** (not `auth.users`) to slot into the existing health model (`check_ins`,
`client_baselines`, `risk_scores`). Adapt PREDICTIV's schema accordingly.

### 3.1 `wearable_tokens` — one row per (client, provider)
```sql
create table wearable_tokens (
  client_id        uuid not null references clients(id) on delete cascade,
  provider         text not null check (provider in ('oura','garmin','polar')),
  access_token     text not null,
  refresh_token    text,                       -- null for Polar
  expires_at       timestamptz,                -- null for Polar
  provider_user_id text,                        -- Garmin userId / Polar x_user_id
  status           text not null default 'active' check (status in ('active','token_expired')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (client_id, provider)
);
```

### 3.2 `wearable_sessions` — normalized daily metrics (one row per client/provider/date)
Carry the union of fields PREDICTIV stores. Minimum viable set for PeakBuddy's needs:
```sql
create table wearable_sessions (
  client_id uuid not null references clients(id) on delete cascade,
  source    text not null check (source in ('oura','garmin','polar','manual')),
  date      date not null,
  -- scores
  sleep_score numeric, readiness_score numeric, activity_score numeric,
  -- vitals
  resting_hr numeric, hrv_avg numeric, spo2_avg numeric,
  -- sleep breakdown (minutes)
  total_sleep_duration int, deep_sleep_duration int, light_sleep_duration int,
  rem_sleep_duration int, sleep_efficiency numeric,
  -- activity
  total_steps int, total_calories int, active_calories int,
  duration_minutes int, avg_heart_rate numeric, max_heart_rate numeric,
  training_load numeric, total_distance_km numeric, session_type text,
  -- garmin extras
  stress_avg numeric, body_battery_min int, body_battery_max int,
  respiration_rate_avg numeric, vo2_max numeric,
  fetched_at timestamptz not null default now(),
  unique (client_id, source, date)
);
```

### 3.3 `training_trends` — derived load metrics — ⏸️ DEFERRED (not in MVP)
ACWR / strain / monotony / HRV per client/source/date. **Skip for the connect+display MVP.** Port
later if PeakBuddy wants training-load analytics. Listed here only so the schema plan is complete.

### 3.4 `garmin_oauth_state` — short-lived PKCE state
```sql
create table garmin_oauth_state (
  state         text primary key,
  client_id     uuid not null references clients(id) on delete cascade,
  code_verifier text not null,
  expires_at    timestamptz not null  -- ~10 min TTL
);
```
(Oura/Polar can pass `client_id` in the OAuth `state` param directly; Garmin needs the verifier
stashed server-side, hence this table.)

### 3.5 RLS
Follow PeakBuddy's existing model: clients see their own rows (`current_client_id()`),
practitioners see their clients' rows, super_admin sees all. Token tables should be
**service-role only** (no client read of `access_token`). Mirror the `is_super_admin()` /
`current_client_id()` security-definer pattern already used in PeakBuddy migrations.

### 3.6 Reuse the existing `passive_monitoring_enabled` flag
`clients.passive_monitoring_enabled` already exists — gate wearable sync on it.

---

## 4. Secrets / environment variables

Add to Cloudflare Workers env (and `.env` for local). No `.env.example` exists today — create one.

```bash
# Oura
OURA_CLIENT_ID=
OURA_CLIENT_SECRET=
OURA_REDIRECT_URI=https://buddy.peakmovement.co.za/api/public/wearables/oura/callback
OURA_WEBHOOK_VERIFICATION_TOKEN=

# Garmin
GARMIN_CONSUMER_KEY=
GARMIN_CONSUMER_SECRET=
GARMIN_REDIRECT_URI=https://buddy.peakmovement.co.za/api/public/wearables/garmin/callback

# Polar
POLAR_CLIENT_ID=
POLAR_CLIENT_SECRET=

# already present in PeakBuddy — reused
# SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, ALLOWED_ORIGINS, BUDDY_APP_BASE_URL
```

Register the redirect URIs above in each provider's developer console (see §9 checklist).

---

## 5. PeakBuddy-native code layout (Option A)

Map each PREDICTIV edge function to a PeakBuddy primitive:

```
src/
  lib/wearables/
    oura.ts                 # endpoints, scopes, token refresh, data mappers (pure logic)
    garmin.ts               # PKCE helpers, backfill trigger, webhook payload parsers
    polar.ts                # AccessLink client, user-registration, mappers
    tokens.ts               # get/refresh/store valid token per (client, provider)
    normalize.ts            # vendor payload -> wearable_sessions row
    connect.functions.ts    # createServerFn: returns authorize URL for a provider (client-auth'd)
    sync.functions.ts       # createServerFn: on-demand "sync now" for a client
  routes/api/public/wearables/
    oura/callback.ts        # GET OAuth callback -> exchange code, store token
    oura/webhook.ts         # GET verify + POST events (HMAC verify)
    garmin/callback.ts      # GET PKCE callback -> exchange, fetch userId, trigger backfill
    garmin/webhook.ts       # POST push (always 200); resolve user; upsert sessions
    polar/callback.ts       # GET callback -> exchange (Basic auth) -> register user
  routes/api/public/hooks/
    wearables-sync.ts       # POST, CRON_SECRET-guarded: refresh tokens + pull Oura/Polar daily
```

### Patterns to reuse from the existing codebase
- **API route handler shape** (from `src/routes/api/public/hooks/nightly-risk-analysis.ts`):
  ```ts
  export const Route = createFileRoute("/api/public/wearables/oura/callback")({
    server: { handlers: { GET: async ({ request }) => { /* ... */ } } },
  });
  ```
- **CORS + origin allowlist** helper from `src/routes/api/public/triage-query.ts`.
- **`CRON_SECRET` gate** (Bearer check) for the scheduled sync hook — copy from
  `nightly-risk-analysis.ts`.
- **Server-side Supabase (service role)** from `src/integrations/supabase/client.server.ts`.
- **Auth middleware** (`src/integrations/supabase/auth-middleware.ts`) for the `connect`/`sync`
  server functions so only the logged-in client can connect their own device.

> **Option B note:** if you choose Edge Functions instead, skip §5 entirely and copy
> `predictivmvp/supabase/functions/{oura,garmin,polar}-*` into a new `supabase/functions/` dir,
> renaming token columns `user_id`→`client_id`.

---

## 6. Per-provider implementation

For each provider: reference the named PREDICTIV function, then implement the PeakBuddy equivalent.

### 6.1 Oura (easiest — do this first to prove the pipeline)
**Reference:** `oura-auth-initiate`, `oura-auth`, `fetch-oura-data`, `fetch-oura-auto`, `oura-webhook`,
`_shared/oura-token-refresh.ts`.

1. **Connect** (`connect.functions.ts`): build authorize URL at
   `cloud.ouraring.com/oauth/authorize` with scopes above, `state = client_id`, redirect =
   `OURA_REDIRECT_URI`.
2. **Callback** (`oura/callback.ts`): exchange `code` at `api.ouraring.com/oauth/token`; upsert
   `wearable_tokens` (provider `oura`).
3. **Sync** (`sync.functions.ts` + scheduled hook): pull these v2 endpoints for the last 7 days →
   `usercollection/daily_sleep`, `daily_readiness`, `daily_activity`, `daily_spo2`, `sleep`,
   `heartrate`. Map into `wearable_sessions` via `normalize.ts`.
4. **Token refresh:** port `getValidOuraToken()` — refresh if expiring within 5 min, 3 retries with
   backoff. Respect Oura's 5000-req/5-min limit.
5. **Webhook** (`oura/webhook.ts`): `GET` returns the challenge using
   `OURA_WEBHOOK_VERIFICATION_TOKEN`; `POST` verifies HMAC-SHA256 with `OURA_CLIENT_SECRET`, then
   re-pulls the affected day.

### 6.2 Polar (medium)
**Reference:** `polar-auth-initiate`, `polar-auth-callback`, `fetch-polar-sleep`,
`fetch-polar-exercises`, `fetch-polar-auto`.

1. **Connect:** authorize at `flow.polar.com/oauth2/authorization`, scope `accesslink.read_all`,
   `state = client_id`.
2. **Callback:** exchange at `polarremote.com/v2/oauth2/token` using **HTTP Basic**
   (`base64(client_id:client_secret)`). Response includes `x_user_id`.
3. **Register the user** (critical, easy to miss): `POST accesslink.com/v3/users` with the
   `member-id`. Store `provider_user_id = x_user_id`. No refresh token — token is long-lived.
4. **Sync:** pull `v3/users/sleep` and `v3/exercises?samples=true&zones=true`. Durations are in
   **seconds → convert to minutes**. Use `training_load_pro['cardio-load']` for `training_load`.
   Sum exercises per day; pick the longest for HR stats. Handle **403 = no consent** gracefully
   (surface "reconnect/grant access in Polar app" to the user).

### 6.3 Garmin (hardest — webhook-first)
**Reference:** `garmin-auth-initiate`, `garmin-auth`, `garmin-webhook`, `garmin-backfill`,
`fetch-garmin-data`.

1. **Connect (PKCE):** generate `code_verifier` (64 chars) + `code_challenge`
   (SHA-256 → base64url). Persist `{state, client_id, code_verifier}` in `garmin_oauth_state`
   (10-min TTL). Authorize at `connect.garmin.com/oauth2Confirm` with the challenge.
2. **Callback:** look up the verifier by `state`; exchange at
   `diauth.garmin.com/di-oauth2-service/oauth/token` including `code_verifier`. Then fetch the
   stable id from `apis.garmin.com/wellness-api/rest/user/id` and store as `provider_user_id`.
3. **Backfill:** immediately call Garmin's `/backfill/*` endpoints to request ~30 days of history —
   Garmin pushes it **asynchronously to your webhook** (no synchronous response).
4. **Webhook** (`garmin/webhook.ts`): **always return 200** (a non-200 can deregister you). Parse
   `dailies`, `sleeps`, `activities`, `hrvSummaries`, plus `deregistrations` /
   `userPermissionsChange`. Resolve the client with the **3-tier fallback**:
   `provider_user_id` → `access_token` → single-active-user self-heal. Upsert `wearable_sessions`.
5. **Token refresh:** ~24h expiry — refresh 30 min before expiry; on failure set
   `status='token_expired'` and prompt reconnect. **Do not** attempt live pulls
   (`InvalidPullTokenException`); all data arrives via webhook/backfill.

---

## 7. Frontend — connect UI + data display (the whole MVP front end)

PeakBuddy uses TanStack Router file-based routes + Radix UI + Recharts. Natural home: the client app.

### 7a. Connect
- **Add a "Connected Devices" section** to `src/routes/client.app.profile.tsx` (or a new
  `client.app.devices.tsx` route).
- Three connect buttons (mirror PREDICTIV's `ConnectGarminButton.tsx` / `ConnectPolarButton.tsx`).
  Each calls the `connect` server function → receives the provider authorize URL → `window.location`
  redirect.
- A `useWearableConnections` hook (React Query) reads `wearable_tokens` status per provider to show
  **Connect / Connected / Reconnect** states. Surface `token_expired` as a "Reconnect" CTA.
- After the OAuth round-trip, the provider redirects back to your callback route, which then
  redirects the browser to a friendly `client.app.profile?wearable=connected` page.
- A **"Sync now"** button → `sync.functions.ts` (gives the user immediate feedback that data flows).

### 7b. Display (this is the second half of the MVP — don't skip it)
- **Add a wearable data view** — e.g. a `client.app.devices.tsx` route or a card block on the
  progress page (`client.app.progress.tsx`, which already uses Recharts).
- A `useWearableSessions` hook (React Query) reads `wearable_sessions` for the logged-in client
  (RLS scopes to their own rows) ordered by `date`.
- Suggested first-pass UI:
  - **Today / latest card:** sleep score, resting HR, HRV, steps, readiness — whatever the connected
    provider supplies (fields vary by vendor; render only non-null values).
  - **Trend charts:** a 7–30 day line/bar chart of sleep duration, HRV, and resting HR (Recharts,
    matching the existing progress charts).
  - **Empty / pending state:** right after connecting, Oura/Polar populate within a sync; **Garmin
    backfill is async** — show "syncing, data appears shortly" until the first webhook lands.
- Keep it provider-agnostic: read from the normalized `wearable_sessions` table, not vendor payloads,
  so one component renders all three.

---


## 9. Provider app registration checklist (do before coding each provider)

- [ ] **Oura:** create OAuth app at the Oura developer portal; set redirect URI; note client id/secret;
      configure webhook subscription + verification token.
- [ ] **Garmin:** apply for **Health/Wellness API** access (approval can take time — start early);
      register OAuth2 app; configure redirect URI; register the **webhook (ping/push) URL**; confirm
      you're in the correct (eval vs production) tier.
- [ ] **Polar:** create app in Polar AccessLink admin; set redirect URI; note client id/secret;
      ensure the AccessLink product/consent is configured.
- [ ] Add all redirect URIs as `https://<prod-domain>/api/public/wearables/<provider>/callback`
      **and** a localhost variant for dev.

> **Garmin lead time is the schedule risk.** Submit the Health API application on day 1.

---

## 10. Phased rollout

1. **Phase 0 — Foundations:** migrations (§3), secrets (§4), `lib/wearables/` skeleton, connect UI
   shell. Decide Option A vs B.
2. **Phase 1 — Oura end-to-end:** connect → callback → pull sync → `wearable_sessions` → UI status.
   Proves the whole pipeline on the easy provider.
3. **Phase 2 — Polar:** add OAuth + user-registration + pull sync. Handle consent/403 UX.
4. **Phase 3 — Garmin:** PKCE + webhook + backfill + 3-tier user resolution. Most effort; do last.
5. **Phase 4 — Scheduled sync + intelligence:** `CRON_SECRET` hook for daily Oura/Polar refresh;
   feed wearable signals into baselines, risk scoring, nudges (§8).
6. **Phase 5 — Hardening:** token-expired UX, retries/backoff, rate-limit handling, logging tables,
   per-provider sync health.

---

## 11. Reference index — PREDICTIV functions to mine

| PeakBuddy piece | PREDICTIV source function(s) |
|---|---|
| Oura connect/callback | `oura-auth-initiate`, `oura-auth` |
| Oura sync | `fetch-oura-data`, `fetch-oura-auto` |
| Oura refresh | `_shared/oura-token-refresh.ts` |
| Oura webhook | `oura-webhook`, `oura-webhook-setup` |
| Polar connect/callback | `polar-auth-initiate`, `polar-auth-callback` |
| Polar sync | `fetch-polar-sleep`, `fetch-polar-exercises`, `fetch-polar-auto` |
| Garmin connect (PKCE) | `garmin-auth-initiate`, `garmin-auth` |
| Garmin webhook | `garmin-webhook` |
| Garmin backfill | `garmin-backfill` |
| Trend math (ACWR/strain) | `calculate-oura-trends` + `training_trends` schema |

All under `predictivmvp/supabase/functions/`. Treat them as the canonical reference for endpoints,
scopes, headers, and refresh edge-cases — they encode hard-won fixes (esp. Garmin webhook routing).
