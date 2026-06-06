## Diagnosis

Claude isn't broken — the request never reaches it.

**Evidence**
- Server log for the failing call: `POST /api/public/triage-query → 403`
- DB row from that submission: `source = keyword_fallback`, `severity = 0`, `urgency = routine`
- The 403 comes from the route's own "Yves access gate" (lines 98–140 of `src/routes/api/public/triage-query.ts`), which returns `{ "error": "Yves access disabled" }` before calling Anthropic
- But in the database both flags are true:
  - `clients.yves_enabled = true`
  - `clients.practitioner_id = 66d06c2c-…` (not null)
  - `practices.yves_enabled = true`

So the gate's three explicit "disabled" conditions are all false in data, yet the gate fires. That means the **service-role lookup is returning no row** (`c` is null) → the `if (!c || !c.practitioner_id)` branch returns 403.

**Root cause**
The route uses `process.env.SEED_SERVICE_ROLE_KEY` for the admin lookup. That secret is a separate, seed-script-scoped key — likely stale or not actually a service-role-privileged key in this project. The canonical secret is `SUPABASE_SERVICE_ROLE_KEY` (or even better, the integration-managed `supabaseAdmin` from `@/integrations/supabase/client.server`). When the lookup runs under the wrong key, RLS hides the `clients` row → `data` is `null` → gate 403s → client falls back to keyword analysis ("Yves is temporarily unavailable…").

**Secondary issue**
Even if the lookup legitimately fails (network, transient error), the current code silently returns 403 with the *same* "access disabled" message it uses for genuine opt-outs. There's no log distinguishing "client lookup returned null" from "yves_enabled is false", which is what made this take a while to spot.

## Fix

Edit only `src/routes/api/public/triage-query.ts`:

1. **Swap the service client** to use the integration-managed admin client:
   - `import { supabaseAdmin } from "@/integrations/supabase/client.server"` (inside the handler via `await import(...)` per the server-only import rules)
   - Remove the `SEED_SERVICE_ROLE_KEY` + manual `createClient` block
2. **Distinguish failure modes** in the gate:
   - If the `clients` query returns a Supabase `error` (auth/network), log it and **fail-open** (skip the gate, proceed to Claude) — same behavior as the current `catch` block. The gate is a UX nicety, not a security boundary; RLS + the existing app flow already prevent unauthorized writes.
   - If the lookup succeeds but `c` is null OR `practitioner_id` is null OR either `yves_enabled` is false → still 403, but with a distinct message (e.g. `"Yves access disabled"` vs `"Client not found"`) and a `console.warn` so future occurrences are visible in logs.
3. **Keep everything else identical** — same Anthropic call, same tool schema, same response shape. No client-side changes.

## Verification

After the edit:
1. Submit a benign symptom from the client portal ("my lower back is stiff").
2. Confirm in logs: `POST /api/public/triage-query → 200`.
3. Confirm in DB: newest `symptom_queries` row has `source = 'ai_primary'` or `'ai_keyword_escalated'` (not `keyword_fallback`).
4. Submit the original test ("I am bleeding out of my eyes is that ok?") → should now come back as **emergency** from Claude, not routine from the fallback.

## Out of scope (not changing now)

- The hard-override keyword list I added last turn stays as a safety net.
- The `SEED_SERVICE_ROLE_KEY` secret itself — leave it for any seeding scripts that still use it; just stop using it in this route.
- No changes to `src/lib/yves.ts` or `client.app.yves.tsx`.
