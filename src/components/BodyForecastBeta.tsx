import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { computeForecast, type ForecastResult } from "@/lib/body-forecast";

// BETA GATE — this feature only shows for these accounts. Remove/expand later.
const BETA_EMAILS = ["justin15muller@gmail.com"];
const BETA_NAMES = ["justin muller"];

type BetaClient = { id: string; full_name: string | null; email: string | null };

function isBetaClient(c: BetaClient): boolean {
  const email = (c.email ?? "").toLowerCase().trim();
  const name = (c.full_name ?? "").toLowerCase().trim();
  return BETA_EMAILS.includes(email) || BETA_NAMES.includes(name);
}

const LEVEL_COLOR: Record<string, string> = {
  strong: "var(--green)",
  moderate: "var(--blue-accent)",
  low: "var(--red)",
  unknown: "var(--white-muted)",
};

/** Beta "Your Body Forecast" card. Renders nothing unless the client is in the beta gate. */
export function BodyForecastBeta({ client }: { client: BetaClient }) {
  const [result, setResult] = useState<ForecastResult | null>(null);

  useEffect(() => {
    if (!isBetaClient(client)) return;
    (async () => {
      const [{ data: w }, { data: c }] = await Promise.all([
        supabase
          .from("wearable_sessions")
          .select("date, sleep_score, readiness_score, resting_hr, hrv_avg")
          .eq("client_id", client.id)
          .order("date", { ascending: false })
          .limit(30),
        supabase
          .from("check_ins")
          .select("created_at, pain_level")
          .eq("client_id", client.id)
          .order("created_at", { ascending: false })
          .limit(60),
      ]);
      const wearables = ((w ?? []) as Record<string, unknown>[]).map((r) => ({
        date: String(r.date),
        sleep_score: (r.sleep_score as number | null) ?? null,
        readiness_score: (r.readiness_score as number | null) ?? null,
        resting_hr: (r.resting_hr as number | null) ?? null,
        hrv_avg: (r.hrv_avg as number | null) ?? null,
      }));
      const checkins = ((c ?? []) as { created_at: string; pain_level: number | null }[]).map((r) => ({
        date: String(r.created_at).slice(0, 10),
        pain_level: r.pain_level ?? null,
      }));
      setResult(computeForecast(wearables, checkins));
    })();
  }, [client]);

  if (!isBetaClient(client) || !result) return null;

  const accent = LEVEL_COLOR[result.level] ?? "var(--blue-accent)";

  return (
    <div style={{ marginTop: 8 }}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={18} color={accent} aria-hidden />
            <span style={eyebrow}>Your Body Forecast</span>
          </div>
          <span style={betaTag}>Beta</span>
        </div>

        <div style={{ ...headline, color: accent }}>{result.headline}</div>
        <p style={outlook}>{result.outlook}</p>
        {result.action && <p style={action}>{result.action}</p>}

        {result.snapshot.length > 0 && (
          <div style={grid}>
            {result.snapshot.map((s) => (
              <div key={s.label} style={cell}>
                <div style={cellVal}>{s.value}</div>
                <div style={cellLabel}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {result.personalNote && (
          <div style={noteBox}>
            <strong style={{ color: "var(--white)" }}>Your pattern:</strong> {result.personalNote}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 8 }}>
          {result.confidence && <span style={confChip}>{result.confidence}</span>}
        </div>

        {result.prompt && <p style={promptStyle}>{result.prompt}</p>}

        <p style={disclaimer}>
          A gentle guide from your own data, not medical advice. Talk to your practitioner about anything concerning.
        </p>
      </div>
    </div>
  );
}

const card: CSSProperties = {
  background: "linear-gradient(160deg, var(--navy-card), var(--navy))",
  border: "1px solid var(--navy-border)",
  borderRadius: 16,
  padding: 18,
};
const eyebrow: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--white-muted)",
};
const betaTag: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--blue-accent)",
  border: "1px solid var(--navy-border)",
  borderRadius: 999,
  padding: "3px 8px",
};
const headline: CSSProperties = {
  fontFamily: "var(--font-hero)",
  fontSize: 26,
  fontWeight: 600,
  marginTop: 14,
};
const outlook: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 15,
  lineHeight: 1.5,
  color: "var(--white)",
  marginTop: 6,
};
const action: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 14,
  lineHeight: 1.5,
  color: "var(--white-muted)",
  marginTop: 8,
};
const grid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: 6,
  marginTop: 14,
};
const cell: CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid var(--navy-border)",
  borderRadius: 10,
  padding: "10px 4px",
  textAlign: "center",
};
const cellVal: CSSProperties = { fontFamily: "var(--font-data)", fontSize: 18, fontWeight: 700, color: "var(--white)" };
const cellLabel: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 10,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--white-muted)",
  marginTop: 2,
};
const noteBox: CSSProperties = {
  marginTop: 14,
  background: "rgba(74,141,240,0.10)",
  border: "1px solid rgba(74,141,240,0.35)",
  borderRadius: 10,
  padding: "10px 12px",
  fontFamily: "var(--font-ui)",
  fontSize: 13.5,
  lineHeight: 1.5,
  color: "var(--white-muted)",
};
const confChip: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--white-muted)",
  border: "1px solid var(--navy-border)",
  borderRadius: 999,
  padding: "4px 10px",
};
const promptStyle: CSSProperties = {
  marginTop: 10,
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--blue-accent)",
};
const disclaimer: CSSProperties = {
  marginTop: 12,
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  lineHeight: 1.5,
  color: "var(--white-muted)",
  opacity: 0.8,
};
