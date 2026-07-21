
# Yves Analysis Upgrade — Phased Plan

Goal: raise precision (fewer false alarms) and recall (catch subtle red flags) without weakening safety. Ship in 4 phases so each phase is measurable before the next.

## Phase 1 — Richer patient context (fast, biggest immediate lift)

Expand what Yves sees before it reasons. Today it gets aggregates; give it evidence.

Server-side context builder (in `triage-query.ts` client-context section):
- Last 3 raw check-in notes verbatim (text + pain + timestamp + flagged bool)
- Wearable deltas over last 7 days (HRV drop %, RHR spike, sleep debt hrs, ACWR spike) — only if `yves_ai_consent = true`
- Practitioner-set fields: assigned program name + goals + known conditions/diagnosis notes
- Time-of-day + hours since last activity/session
- Last 2 red-flag categories fired for this client (with days ago)

Prompt change: replace freeform context block with a structured `<PATIENT_CONTEXT>` XML block so the model can reference specific fields.

## Phase 2 — Structured extraction + two-step reasoning

Split the single call into two:

1. **Extract** (Gemini Flash Lite, cheap): parse the message into normalized fields — `body_region`, `onset`, `duration`, `character`, `associated_symptoms[]`, `negations[]`, `attributions[]`, `language`. Handles "not chest pain, just tight" and "from yesterday's gym" correctly at the source.
2. **Triage** (existing model): receives raw text + extracted record + patient context. Prompt forces "reason then score" — first list which red-flag checklist items apply and the differential, then output severity/urgency. Add `what_would_change_my_mind` field to surface uncertainty.

Also: dynamically inject only the 2–3 few-shot examples matching the extracted `body_region` / suspected category, instead of always sending all 9.

## Phase 3 — Model router (cheap → strong on risk)

- First pass: Gemini Flash Lite on the triage step.
- Escalate to a reasoning model (GPT-5.5 or Gemini 3.1 Pro) when any of:
  - severity ≥ 6
  - confidence < 0.7
  - any red_flag_category set
  - keyword floor triggered
- Second model sees first model's output and must explicitly agree/disagree with reasoning. Final result = higher-urgency of the two, union of red_flags.
- Keeps hard-override and keyword floor as the safety net regardless of router path.

Add a combination floor (moderate + moderate pairs, e.g. `fever` + `neck stiff` → urgent) so cluster escalation doesn't depend only on the LLM.

## Phase 4 — Calibration loop from grading data

- Nightly aggregation of grading outcomes per practice + per red_flag_category → `yves_calibration` table (confirmed/false_alarm/already_aware counts, last 30/90 days).
- Inject a compact "prior" block into the prompt: "this practice: cardiac alerts 12/15 confirmed, mental_health 2/8 confirmed" — Yves adjusts confidence, not the safety floor.
- Per-keyword precision report for admins → surface floor terms with high false-alarm rate for manual tuning (never auto-relaxed).
- Observability: log prompt version, model(s) used, tokens, latency, floor terms hit, AI-only urgency vs final urgency, extraction output, escalation path. Enables A/B on prompt changes with real numbers.

## Safety invariants (unchanged across all phases)

- Hard-override phrases and keyword floor always run and can only escalate, never downgrade.
- Patient feedback (`setPatientFeedback`) still cannot influence severity/urgency.
- AI calls still gated by `yves_ai_consent`; anything wearable/personal-context also gated.
- Practitioner-visible rationale must cite whether escalation came from context, current text, or both.

## Technical notes

- Files touched: `src/routes/api/public/triage-query.ts` (prompt + extraction call + router), `src/lib/yves.ts` (types, combination floor), new `src/lib/yves-context.server.ts` (context builder), new migration for `yves_calibration` table + grants + RLS.
- No client UI changes required for phases 1–4; grading + consent UI already exist.
- Backwards compatible: same `TriageResult` shape returned; new fields additive.

## Suggested rollout

1. Phase 1 behind no flag (pure context expansion, low risk).
2. Phase 2 behind `platform_settings.yves_two_step_enabled` — A/B for 1 week.
3. Phase 3 rolled out once phase 2 numbers hold.
4. Phase 4 is background + admin surface; no user-visible risk.
