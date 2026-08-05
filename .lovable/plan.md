# Fix "Gemini is rate-limited" on Yves insight generation

## What the message means

Yves insight generation calls Google's Gemini API directly using your own `GEMINI_API_KEY`, because that key is set. Google replied with HTTP 429 — you have hit a quota limit on that key (requests per minute, requests per day, or a free-tier project with no billing attached). It is not a bug in Buddy and not a Lovable AI credits problem; the request never reached Lovable's gateway because the direct key takes priority.

Typical causes, in order of likelihood:
1. The Google Cloud / AI Studio project behind `GEMINI_API_KEY` is on the free tier, which allows only a couple of Pro-model requests per minute and a small daily cap.
2. `GEMINI_MODEL` points at a Pro model with a much tighter quota than the Flash models.
3. Several insight generations were fired close together (Data Hub, Teach Yves, memory checks all share the same key).

## How to fix it

Three layers, cheapest first:

1. **Automatic fallback (recommended, code change).** When the direct Gemini call returns 429, silently fall back to the Lovable AI gateway instead of failing. The prompt and data are identical — only billing differs — so the user still gets their insight. This makes the error effectively disappear.
2. **One short retry with backoff.** Before falling back, retry once after ~2 seconds; most free-tier 429s are per-minute bursts and clear immediately.
3. **Clearer message if everything fails.** If both routes are rate-limited, show "Yves is busy right now — try again in a minute" rather than exposing the provider name.

Optional, no code needed: enable billing on the Google project behind `GEMINI_API_KEY`, or change the `GEMINI_MODEL` secret to a Flash model (much higher quota) for insight generation.

## Technical detail

Files touched:
- `src/lib/data-hub-insight.functions.ts` — `callInsightModel`: wrap the direct-Gemini branch so a 429 (or 5xx) retries once, then falls through to the existing Lovable gateway branch instead of throwing. Keep the existing 402 credits handling on the gateway branch.
- `src/lib/yves-teach.functions.ts` and `src/lib/yves-memory.functions.ts` — these have their own inline 429 throws for the same provider; route them through the shared `callInsightModel` (or apply the same retry + fallback) so all Yves surfaces behave consistently.

No database, RLS, or UI-structure changes. No change to prompts, Yves identity, or memory logic.
