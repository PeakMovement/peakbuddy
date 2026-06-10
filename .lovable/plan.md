# Improve Yves Detection

Yves today runs three layers: hard-override phrases → Claude (Sonnet 4) with light context → keyword floor. The two main weaknesses are: (1) narrow vocabulary that only catches textbook English phrases, (2) the AI sees almost no client history (just 5 aggregate numbers, no assigned program, no past symptoms, no conditions), and (3) alerts only fire on a single high-severity event — there's no pattern detection across check-ins.

This plan tackles all three, plus tunes practitioner alerts.

---

## 1. Broader symptom vocabulary (`src/lib/yves.ts`)

Expand the rule layer so we catch more before falling back to AI, and so the keyword floor still rescues the AI when it underrates something.

- **Lay terms & misspellings**: "puked blood", "couldnt feel my legs", "pins n needles", "head splitting", "blacking out", "pass out", "fainted", "vision went black", "ears ringing", "world spinning".
- **Body-area gaps**: shoulder ("frozen shoulder", "can't lift arm"), neck ("locked neck", "shooting into shoulder blade"), hip ("hip giving way"), ankle/foot ("foot drop", "ankle won't hold"), knee ("knee locked", "knee buckled", "knee gave out"), wrist/hand ("dropping things", "grip weakness").
- **Mental health**: "panic attack", "can't stop crying", "hopeless", "no reason to live", "hearing voices", "intrusive thoughts".
- **Systemic red flags**: "lump", "swollen lymph", "coughing up", "blood in spit", "passing blood", "black stool", "tarry stool".
- **Afrikaans / SA-specific** (small starter set, since this is a SA app): "borspyn" (chest pain), "kortasem" (short of breath), "duiselig" (dizzy), "naar" (nauseous), "flou val" (fainting).
- **Restructure** `KEYWORD_FLOOR` into grouped exports by category (cardiac, neuro, MSK, mental_health, systemic) so it's maintainable and the matched category can be returned in `RealTimeResult`.

---

## 2. Smarter context awareness (`triage-query.ts` + `client-program.functions.ts`)

The model currently gets 5 numeric aggregates. Give it the clinical picture.

- **Extend `ClientRiskContext`** in `src/lib/yves.ts` with:
  - `assignedProgram` (name + focus area, e.g. "Knee Stability")
  - `knownConditions` (from `clients.notes` / future structured field)
  - `recentSymptoms[]` — last 5 check-in notes + their pain/flag status (truncated)
  - `previousRedFlags[]` — symptoms Yves has already flagged in the last 30 days
  - `daysSinceLastCheckIn`
  - `painChange7d` (numeric delta)
- **Build context server-side** in the `/api/public/triage-query` handler instead of trusting the client payload. Query `check_ins`, `alerts`, `clients.suggested_program_id` for the validated `client_id`. This is safer (no client tampering) and richer.
- **Inject into the prompt** as a structured "Patient profile" block so Claude reasons about:
  - "Patient on Knee Stability program reporting knee buckling" → recognise relevance
  - "Third flagged check-in this week, pain rising" → escalate even if today's text is mild
  - "Previously flagged sciatic symptoms, now reports new bladder issue" → cauda equina alarm

---

## 3. Stronger clinical reasoning (`triage-query.ts`)

- **Upgrade model** from `claude-sonnet-4-20250514` to `claude-sonnet-4-5` (or `claude-opus-4` for the hardest cases — configurable).
- **Restructure system prompt** with an explicit **red-flag checklist** the model must walk through before scoring:
  1. Cardiac (chest, arm, jaw, breathlessness, palpitations)
  2. Neurological (sudden weakness, speech, vision, numbness, severe headache)
  3. Cauda equina (saddle numbness, bladder/bowel, bilateral leg weakness)
  4. Systemic / oncological (unexplained weight loss, night sweats, lumps, bleeding)
  5. Mental health crisis (suicidal ideation, psychosis, severe panic)
  6. Infection (fever + localised pain, neck stiffness, severe headache)
  7. MSK alarm (trauma, sudden loss of function, locked joint)
- **Expand tool schema** with:
  - `differential[]` — top 2-3 possible explanations with likelihood (helps practitioners review)
  - `red_flag_category` — which checklist item triggered (cardiac / neuro / etc.)
  - `recommended_questions[]` — follow-ups Yves should ask the client to clarify
  - `escalation_reason` — "context", "current_text", or "both"
- **Few-shot examples in prompt** now include context-aware cases (e.g. "patient with rising pain trend reports mild new symptom → soon, not routine").

---

## 4. Smarter alert thresholds (`client.app.checkin.tsx` + new server logic)

Today alerts fire on a single `should_notify_practitioner` flag. Add **pattern-based alerts**:

- **Pattern detection** runs after each check-in/triage in a server function `evaluateAlertPatterns(clientId)`:
  - 3+ moderate (severity 5-6) symptoms in 7 days → "soon" alert
  - Pain rising trend (+2 or more over 3 check-ins) → alert even at moderate severity
  - Same red-flag category recurring within 14 days → escalate one tier
  - Missed check-ins (>7 days for an active client with prior flags) → "monitor" alert
- **Deduplicate**: don't re-alert on the same red-flag category within 24h unless severity rose.
- **Alert payload** now includes `pattern` field ("recurring_cardiac", "rising_pain", "missed_checkins") so the practitioner alerts page can group them.
- **Practitioner setting** (`practices.alert_sensitivity`: low/normal/high) — adjusts thresholds. Default normal.

---

## 5. Feedback signal (lightweight, for future tuning)

Add a one-tap "Was this triage right?" on the practitioner alerts page → stores `practitioner_assessment` ("correct" / "over" / "under") on the `alerts` row. Not used for auto-tuning yet, but gives us the data to refine thresholds later. **One DB migration** for the new column + `differential` jsonb on `symptom_queries`.

---

## Files Touched

```text
src/lib/yves.ts                                  vocabulary + context types
src/routes/api/public/triage-query.ts            prompt, model, context build, schema
src/lib/yves-access.functions.ts                 server-side context fetch helper
src/routes/client.app.checkin.tsx                pass clientId only; context built server-side
src/routes/practitioner.app.alerts.tsx           pattern grouping + feedback button
src/routes/practitioner.app.settings.tsx        alert sensitivity setting
supabase/migrations/<ts>_yves_detection.sql      alerts.pattern, alerts.practitioner_assessment,
                                                  symptom_queries.differential,
                                                  practices.alert_sensitivity
new: src/lib/alert-patterns.functions.ts         pattern evaluator
```

## Out of Scope

- Auto-tuning thresholds from feedback (just collecting for now)
- Voice/audio symptom input
- Push notifications to practitioner phones (alerts table only)
- Replacing Claude with a different provider

---

**Suggested rollout order** (each is independently shippable):
1. Vocabulary expansion (low risk, immediate lift)
2. Server-built context + stronger prompt + model upgrade
3. Pattern-based alerts + sensitivity setting
4. Feedback button
