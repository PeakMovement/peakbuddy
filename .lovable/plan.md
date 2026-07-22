# Generate Insight — AI-powered client analysis on the Data Hub

Add a new **Generate Insight** section to `src/routes/admin.app.data-hub.tsx` that reads all the metrics, symptoms, wearable data, alerts, patterns and Yves history already fetched by `getAdminClientBundle`, sends them to Lovable AI, and returns a highly-accurate, informative narrative about the selected client.

## UI (data hub page)

- New collapsible section titled **"Generate Insight"**, positioned near the top (right under Overview) and included in the show/hide chip bar as `SectionKey = "insight"`.
- Contents:
  - Short helper text: *"AI reads all available metrics, symptoms, wearable data and alerts to summarise what matters about this client."*
  - **Generate insight** button (disabled while streaming, disabled if no client selected).
  - Optional focus dropdown: *General overview / Pain & symptoms / Sleep & recovery / Training load / Risk factors* — appended to the prompt as a focus hint.
  - Streamed markdown response rendered with `react-markdown` (already used elsewhere) inside a card styled with existing tokens (`C.card`, `C.border`).
  - Timestamp of last generation + **Regenerate** button.

## Backend (server function)

New file `src/lib/data-hub-insight.functions.ts`:

- `generateClientInsight` — `createServerFn({ method: "POST" })` with `.middleware([requireSupabaseAuth])`.
- Input: `{ clientId: string, focus?: string }`.
- Authorisation: verify caller is `super_admin` OR the client's assigned practitioner (via `context.supabase` under RLS on `clients` / `profiles`).
- Data gathering (server-side, admin client so we get complete history):
  - Client profile + baselines + condition context (`clients`, `client_baselines`).
  - Last 90 days of `check_ins` (pain, sleep, stress, energy, mood, notes, flags).
  - Last 90 days of `wearable_sessions` (sleep score, HRV, resting HR, steps, calories, training load, session types).
  - `wearable_tokens` providers (so the prompt knows which wearable is connected and what data is *not* available).
  - Recent `alerts` (last 30 days, with type / urgency / message).
  - `client_patterns` + `predictive_nudges` if present.
  - Last 20 `yves_triage_logs` entries (query, triage_level, summary).
- Compact the payload: aggregate to daily rollups + 7/30-day means, cap arrays, strip nulls — keep total prompt well under model limits.
- Call Lovable AI Gateway via AI SDK (`streamText`) using the pattern in `ai-sdk-lovable-gateway` and `connecting-to-ai-models-tanstack`. Model: `google/gemini-3.1-pro-preview` (strong reasoning, multimodal, cheap enough for on-demand insights). Return a streamed UI message response so the UI can stream progressively.
- Log every generation to a new table `client_insight_logs` (`id`, `client_id`, `generated_by`, `focus`, `prompt_summary`, `response`, `model`, `created_at`) so we can iterate on prompt quality.

## Prompt design (trainable)

System prompt lives in `src/lib/data-hub-insight.prompt.ts` so it can be tuned without touching route code:

- Role: senior clinical data analyst assisting a practitioner.
- Rules: base every statement on the supplied JSON; never invent data; when a metric is missing, explicitly say the connected wearable does not report it; cite the time window ("over the last 14 days…"); prefer specific numbers over vague adjectives; end with 3 prioritised, actionable recommendations.
- Structure the response as: **Snapshot**, **What's changing** (trends with numbers), **Risk signals**, **Wearable data quality notes**, **Recommended next steps**.
- Length: ~250–400 words.

## Data model

Migration adds:

```text
public.client_insight_logs
  id uuid pk default gen_random_uuid()
  client_id uuid references clients on delete cascade
  generated_by uuid references auth.users
  focus text
  model text
  prompt_tokens int
  response text
  created_at timestamptz default now()

+ GRANTs to authenticated / service_role, RLS: super_admin OR client's practitioner can select/insert own rows.
```

## Files touched

- `src/routes/admin.app.data-hub.tsx` — add `insight` section, chip, collapsible card, streaming hook.
- `src/lib/data-hub-insight.functions.ts` — new server function.
- `src/lib/data-hub-insight.prompt.ts` — system prompt + payload shaper (easy to iterate).
- `src/lib/ai-gateway.server.ts` — reuse existing helper (create if not present per `ai-sdk-lovable-gateway`).
- New migration for `client_insight_logs`.

## Out of scope

- No changes to the client / practitioner apps.
- No changes to existing sections' data flow.
- No new scheduled/automated insight generation (button-driven only for now).
