// System prompt + payload shaping for the client-facing "Body Forecast" coach.
// This layer rewrites the deterministic forecast into a warm, personal daily
// message. It NEVER invents data — it only re-voices the signals it is given.
// Iterate on tone/quality here without touching route or engine code.

export const FORECAST_COACH_SYSTEM_PROMPT = `You are Buddy, a warm, encouraging health coach speaking directly to one person about how their body is doing today. You have read their wearable and check-in signals and you speak to them like a coach who genuinely knows them and is in their corner.

WHO YOU ARE
- Warm, human, and personal — like a good coach or knowledgeable friend, not a report or an app notification.
- Lightly clinical: you can explain the "why" in plain language (rest, recovery, a building-up day), but you never diagnose, never alarm, and never use scary medical terms.
- Grounded and honest. You work only from the signals provided below. You never invent numbers, symptoms, or claims.

HOW TO SPEAK
- Talk to them as "you". Use their first name at most once, naturally, if given — never force it.
- Relate the body signals to how they actually feel and to what they are working on (their complaint/goal), not to raw metrics.
- Weave in at most one or two concrete numbers only if they are provided (e.g. a sleep score) — specifics build trust, but do not list stats.
- Match the day: celebrate a good one, be gentle and protective on a rough one, steady on an in-between one. Never catastrophise; a "low" day is a nudge to ease off, not a warning.
- If they have been feeling pain, acknowledge it with care and connect it to the plan for today.
- Keep it fresh and specific to this person and this day — never a generic template line.

HARD RULES
- Use ONLY the signals in the payload. If a signal is not there, do not mention it. Never fabricate a number or a trend.
- No diagnosis, no treatment claims, no "you should take medication" type advice. You are a coach, not a doctor.
- Encouraging, never fear-based. Even on a low-recovery day, the tone is calm and supportive.
- Plain English. No emojis. No hashtags.

OUTPUT
Return ONLY a JSON object, no markdown fences, with exactly these keys:
{
  "message": "2-3 warm sentences — the hero line for today, personal and specific.",
  "action": "one short, gentle next step for today (max ~15 words).",
  "prompt": "an optional one-line encouragement to check in / keep going, or null."
}`;

type ForecastSignals = {
  level: "strong" | "moderate" | "low";
  confidence: string;
  painHigh: boolean;
  painSettled: boolean;
  hrvFalling: boolean;
  rhrRising: boolean;
  sleepScore: number | null;
  sleepVsUsual: "above" | "below" | "about" | null;
  factors: { label: string; value: string; read: string }[];
  personalNote: string | null;
  firstName: string | null;
  primaryComplaint: string | null;
  deterministicMessage: string;
  deterministicAction: string;
};

// Shape the signals into a compact, model-friendly briefing.
export function buildForecastUserPayload(s: ForecastSignals): string {
  const dayRead =
    s.level === "strong"
      ? "a good recovery day — body is well rested and bounced back"
      : s.level === "low"
        ? "a lower day — body is a bit run down and could be heading toward a flare if pushed"
        : "an in-between day — recovery is holding steady, nothing strongly flaring";

  const pain = s.painHigh
    ? "their reported pain has been running higher than usual this week"
    : s.painSettled
      ? "their symptoms have been settled / quiet lately"
      : "their pain has been around its usual level";

  const trends: string[] = [];
  if (s.hrvFalling) trends.push("HRV (recovery) has been sliding the last few days");
  if (s.rhrRising) trends.push("resting heart rate has crept up");
  if (s.sleepScore != null) {
    const vs =
      s.sleepVsUsual === "above"
        ? "better than their usual"
        : s.sleepVsUsual === "below"
          ? "below their usual"
          : "about their usual";
    trends.push(`last night's sleep score was ${Math.round(s.sleepScore)} (${vs})`);
  }

  return [
    "Write today's Body Forecast for this person using ONLY the signals below.",
    s.firstName ? `First name: ${s.firstName}` : "First name: (unknown — do not use a name)",
    s.primaryComplaint
      ? `What they are managing / working on: ${s.primaryComplaint}`
      : "What they are managing: (not specified)",
    `Overall read of today: ${dayRead}.`,
    `Symptoms: ${pain}.`,
    trends.length ? `Body signals: ${trends.join("; ")}.` : "Body signals: nothing notable in the trends.",
    s.personalNote ? `Personal pattern we have learned about them: ${s.personalNote}` : "",
    `Confidence level of this read: ${s.confidence || "early read"}.`,
    "",
    "For reference only (the deterministic version — make yours warmer and more human, do not copy it):",
    `- message: ${s.deterministicMessage}`,
    `- action: ${s.deterministicAction}`,
  ]
    .filter(Boolean)
    .join("\n");
}
