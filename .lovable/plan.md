
# Passive Monitoring & Predictive Nudges — Build Plan

Two new agentic capabilities on top of the existing check-in system:

1. **Nightly Risk Analysis** — every night, score each active client against their own baseline and draft a practitioner-facing note when risk rises.
2. **Predictive Nudges** — detect recurring weekday patterns (e.g. "high stress on Tuesdays") and proactively message the client that morning with a relevant program snippet.

---

## 1. Data model (new tables)

All in `public`, with full GRANTs + RLS (authenticated read scoped to owning practitioner / client; service_role full access for the cron worker).

**`client_baselines`** — rolling 30-day baseline per client, refreshed nightly.
- client_id, computed_at
- pain_mean, pain_std, sleep_mean, stress_mean, energy_mean, mood_mean
- sample_size

**`risk_scores`** — one row per client per night.
- client_id, score_date (date), risk_score (0–100), delta_vs_baseline (jsonb of which metrics moved), trend ('improving'|'stable'|'worsening'), summary

**`practitioner_drafts`** — AI-drafted notes waiting in the practitioner portal.
- practitioner_id, client_id, risk_score_id, kind ('risk_flare'|'pattern_insight'), draft_title, draft_body, suggested_action (jsonb: e.g. program_id, message_template), status ('new'|'sent'|'dismissed'|'edited'), created_at, acted_at

**`client_patterns`** — detected recurring patterns per client.
- client_id, pattern_type ('weekday_stress'|'weekday_pain'|'weekday_sleep'|...), day_of_week (0–6), metric, avg_value, confidence (0–1), sample_size, last_detected_at, active boolean

**`predictive_nudges`** — scheduled/sent nudges to clients.
- client_id, pattern_id, scheduled_for (timestamptz), nudge_title, nudge_body, program_id (optional), status ('scheduled'|'sent'|'opened'|'dismissed'|'skipped'), sent_at, opened_at

**`clients` additions**: `passive_monitoring_enabled boolean default true`, `predictive_nudges_enabled boolean default true`, `timezone text default 'Africa/Johannesburg'` (needed to send 8am local).

---

## 2. Server functions (`src/lib/`)

**`risk-analysis.functions.ts`**
- `computeBaseline(clientId)` — pulls last 30 days of `check_ins`, calculates mean/std for each metric, upserts `client_baselines`.
- `computeRiskScore(clientId, forDate)` — pulls last 3 days of check-ins, compares to baseline using z-scores; weights: pain 35%, sleep 20%, stress 20%, energy 15%, mood 10%. Returns score 0–100 + per-metric deltas.
- `draftPractitionerNote(clientId, riskScore)` — only when score ≥ threshold (default 60) OR jumped ≥ 20 vs prior night. Calls Lovable AI (`google/gemini-3-flash-preview`) with: client's primary complaint, last 7 days of check-ins, baseline, current risk breakdown, and the catalogue of approved programs. Returns `{draft_title, draft_body, suggested_program_id}`. Inserts into `practitioner_drafts`.

**`pattern-detection.functions.ts`**
- `detectWeekdayPatterns(clientId)` — pulls 6+ weeks of check-ins, groups by weekday, flags a day when its mean for a metric is ≥ 1 std above the client's overall mean AND appears in ≥ 4 of last 6 weeks. Upserts `client_patterns` with confidence.
- `scheduleNudgesForTomorrow()` — for each active pattern whose `day_of_week === tomorrow`, builds a nudge (uses approved program from `programs` matching the metric tag, e.g. `stress`) and inserts `predictive_nudges` with `scheduled_for = tomorrow 08:00 client-local`.

**`practitioner-drafts.functions.ts`** (auth-protected, practitioner-only)
- `listMyDrafts({status})`, `sendDraft(id, editedBody?)` → marks `sent`, optionally posts to client timeline/email, `dismissDraft(id)`, `editDraft(id, body)`.

**`client-nudges.functions.ts`** (auth-protected, current client)
- `getDueNudges()` — returns nudges where `scheduled_for <= now()` AND `status='scheduled'`, marks them `sent`. Called by client app on load.
- `markNudgeOpened(id)`, `dismissNudge(id)`.

---

## 3. Cron jobs (`pg_cron` → public API routes)

Two new public routes (auth via shared anon key as per platform pattern):

- **`/api/public/hooks/nightly-risk-analysis`** (runs 02:00 UTC daily)
  For every client with `passive_monitoring_enabled`: recompute baseline → compute today's risk → if threshold crossed, draft note. Batched in chunks of 50.

- **`/api/public/hooks/schedule-daily-nudges`** (runs 23:00 UTC daily — pre-dawn for SA)
  Re-runs `detectWeekdayPatterns` weekly (Sundays) and `scheduleNudgesForTomorrow` nightly.

Both endpoints loop server-side using `supabaseAdmin` (loaded inside handler), with structured logging and per-client try/catch so one failure doesn't abort the batch.

---

## 4. Practitioner UI

New route **`src/routes/practitioner.app.insights.tsx`** ("Insights" tab):
- Section 1: **Risk drafts** — list of `practitioner_drafts` where `status='new'`, sorted by urgency. Each card: client name, risk score, AI-drafted summary, suggested action, [Send] [Edit] [Dismiss] buttons.
- Section 2: **Client trends** — small sparkline per client of last 14 days of risk score (pulled from `risk_scores`).
- Add badge count on practitioner nav for unread drafts.

On `practitioner.app.client-detail.$clientId.tsx`: add "Risk trend" sparkline + "Detected patterns" list pulled from `client_patterns`.

---

## 5. Client UI

- On `client.app.index.tsx`: on mount, call `getDueNudges()`. If any, show a soft top-of-screen card (reuse `ProgramIntroModal` styling but lighter) with the nudge body + "Start exercise" CTA → links to program / external_url.
- New toggle in `client.app.profile.tsx`: "Allow predictive nudges" (writes `predictive_nudges_enabled`).

---

## 6. Safety / gates

- **Feature flag** in `platform_settings`: `passive_monitoring_enabled` and `predictive_nudges_enabled` (admin kill-switches).
- **Per-client consent**: respects `passive_monitoring_enabled` / `predictive_nudges_enabled` flags on `clients`.
- **AI gating**: drafts only use AI if `yves_ai_consent = true`; otherwise fall back to a template-based summary.
- **Rate limits**: max 1 draft per client per day; max 1 nudge per client per day.
- **No auto-send**: practitioner drafts are *drafts* — never sent to the client without practitioner action.

---

## 7. Rollout phases

```text
Phase 1 — Foundations
  • Migrations: 5 new tables + 3 client columns + 2 platform_settings flags
  • Cron job 1 (nightly risk) + risk-analysis.functions.ts
  • Practitioner Insights page (drafts list only)

Phase 2 — Patterns & nudges
  • pattern-detection.functions.ts + cron job 2
  • Client nudge UI + consent toggle
  • Client-detail risk sparkline + pattern list

Phase 3 — Polish
  • Email/push notification on new high-urgency draft (uses existing webhook hook)
  • Admin dashboard tile: total drafts/nudges sent, acceptance rate
```

---

## Technical notes

- All AI calls use the gateway model already in use (`google/gemini-3-flash-preview`), structured output via AI SDK `Output.object`.
- Risk-score math kept in TS (not SQL) so it's testable; add `risk-analysis.test.ts` covering baseline, z-score, threshold trigger.
- Timezone handling: store `clients.timezone`; `scheduled_for` is computed in TS using `Intl.DateTimeFormat` from local 08:00 → UTC.
- All new tables: `GRANT SELECT, INSERT, UPDATE, DELETE ON ... TO authenticated; GRANT ALL ... TO service_role;` + RLS policies scoped via existing `current_client_id()` and practitioner ownership.
