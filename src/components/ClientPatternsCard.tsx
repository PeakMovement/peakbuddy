import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { describePattern, type DetectedPattern } from "@/lib/client-patterns";

// #5 Read-only practitioner surface for detected day-of-week patterns.
// Reads the client_patterns store (populated by the nightly detection job).
// Silent when there are no active, confidence-worthy patterns. No side effects.

type Row = {
  pattern_type: string;
  day_of_week: number;
  metric: string;
  avg_value: number;
  confidence: number;
  sample_size: number;
};

const MIN_CONFIDENCE = 0.45;

export function ClientPatternsCard({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("client_patterns")
        .select("pattern_type, day_of_week, metric, avg_value, confidence, sample_size")
        .eq("client_id", clientId)
        .eq("active", true)
        .gte("confidence", MIN_CONFIDENCE)
        .order("confidence", { ascending: false })
        .limit(4);
      if (cancelled) return;
      setRows((data ?? []) as Row[]);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!ready || rows.length === 0) return null;

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <CalendarClock size={17} color="var(--blue-accent)" aria-hidden />
        <span style={eyebrow}>Weekly patterns</span>
      </div>
      <p style={sub}>Day-of-week tendencies from this client's own check-ins. Signals to discuss, not diagnoses.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
        {rows.map((r, i) => (
          <div key={`${r.metric}-${r.day_of_week}-${i}`} style={item}>
            <div style={{ color: "var(--white)", fontFamily: "var(--font-ui)", fontSize: 14, lineHeight: 1.45 }}>
              {describePattern(r as unknown as DetectedPattern)}
            </div>
            <div style={{ color: "var(--white-muted)", fontFamily: "var(--font-data)", fontSize: 11, marginTop: 4 }}>
              {Math.round(r.confidence * 100)}% confidence · {r.sample_size} check-ins
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const card: CSSProperties = {
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 16,
  padding: 18,
  marginTop: 12,
};
const eyebrow: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--white-muted)",
};
const sub: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  lineHeight: 1.5,
  color: "var(--white-muted)",
  margin: "8px 0 0",
};
const item: CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--navy-border)",
  borderRadius: 10,
  padding: "10px 12px",
};
