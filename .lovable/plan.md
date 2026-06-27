# Cascade AI feature control

Today's gating is split across several flags (`platform_settings.programs_feature_enabled`, `practices.yves_enabled`, `practices.programs_suggest_enabled`, per-client `yves_ai_consent`). You want one clear cascade:

```text
Super Admin ──(per practitioner toggle)──► Practitioner ──(unlocked features)──► Clients
                                                │
                                                ├─ Practitioner: client summaries, insights, morning analysis
                                                └─ Clients: Anthropic-powered Yves (3 questions/day cap)
                                                              + Google-powered program suggestions
```

## What changes

### 1. One master switch per practitioner
- Add `practices.ai_features_enabled boolean default false` (off by default — super admin must turn it on).
- Retire the split between `yves_enabled` and `programs_suggest_enabled` for gating purposes; both will read from the new master flag. Columns stay in DB to avoid breaking history, but server code stops checking them.
- Keep `platform_settings.programs_feature_enabled` as a global kill switch (super admin can disable platform-wide in emergencies); the cascade is: global ON AND practice ON.

### 2. Super Admin UI
On `admin.app.practitioner-detail.$id.tsx`: a single "AI Features" toggle card with copy explaining that turning it on unlocks Yves (3 questions/day) + program suggestions for all of this practitioner's clients, plus AI summaries/insights for the practitioner.

### 3. Practitioner UI
- If practice has `ai_features_enabled = false`: hide Insights tab, Morning Analysis widget, Program Suggestions queue, and show a small "AI features are not enabled for your practice" note in the dashboard.
- If true: everything works as today.

### 4. Client UI (Yves page)
- If `ai_features_enabled = false` on their practice: show a friendly "Yves is not available for your clinic yet" empty state; hide the composer, consent modal, and disclosure bar.
- If true: existing consent flow runs, daily cap of 3 questions stays as-is (already enforced).

### 5. Server enforcement (hard gate)
- `triage-query.ts`: load the client's practice, refuse with `ai_disabled` error if `ai_features_enabled = false`. Daily limit (3/day) stays.
- `client-program.functions.ts` + auto-suggest path: refuse to insert suggestions if practice flag is off.
- Morning analysis / nightly risk analysis: skip practices with the flag off.

### 6. Default for existing practices
Existing practices get `ai_features_enabled = true` in the migration (so current users don't suddenly lose Yves). New practices default to `false` and must be enabled by super admin.

## Technical section

**Migration**
```sql
ALTER TABLE public.practices
  ADD COLUMN IF NOT EXISTS ai_features_enabled boolean NOT NULL DEFAULT false;
-- Grandfather existing practices
UPDATE public.practices SET ai_features_enabled = true WHERE created_at < now();
-- New practices default false from here on
ALTER TABLE public.practices ALTER COLUMN ai_features_enabled SET DEFAULT false;
```

**Helper** `src/lib/ai-gate.functions.ts` — `isPracticeAiEnabled(practiceId)` returns `global_enabled AND practice.ai_features_enabled`. All gates call this.

**Files touched**
- `supabase/migrations/<new>.sql`
- `src/lib/ai-gate.functions.ts` (new)
- `src/routes/api/public/triage-query.ts` (gate before Anthropic call)
- `src/lib/client-program.functions.ts`, `src/lib/programs.functions.ts` (gate suggestion writes)
- `src/routes/api/public/hooks/nightly-risk-analysis.ts` (skip disabled practices)
- `src/lib/morning-analysis.functions.ts` (skip disabled practices)
- `src/routes/admin.app.practitioner-detail.$id.tsx` (add toggle)
- `src/routes/practitioner.app.dashboard.tsx`, `practitioner.app.insights.tsx`, `practitioner.app.program-queue.tsx` (conditional rendering)
- `src/routes/client.app.yves.tsx` (empty state when disabled)

Daily question cap of 3 is already enforced in `triage-query.ts` and surfaces in the Yves UI — no change needed there.

## Questions before I build

1. Confirm: for existing practices currently using Yves, grandfather them to `enabled = true`? (Otherwise they'd lose access until you toggle each one.)
2. Confirm: keep the per-client `yves_ai_consent` consent modal on top of the practice-level gate? (Recommended for POPIA; you said yes earlier.)
