import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Watch } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { computeForecast, type ForecastResult } from "@/lib/body-forecast";
import { GarminAttribution } from "@/components/wearables/GarminAttribution";

type WRow = {
  date: string;
  source: string;
  sleep_score: number | null;
  readiness_score: number | null;
  resting_hr: number | null;
  hrv_avg: number | null;
  total_steps: number | null;
};

/**
 * Practitioner-facing wearable summary on the client detail screen.
 * Reads wearable_sessions (RLS already allows the client's practitioner).
 * Renders nothing when the client has no wearable data.
 */
export function ClientWearablesCard({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<WRow[]>([]);
  const [forecast, setForecast] = useState<ForecastResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data }, { data: ci }] = await Promise.all([
        supabase
          .from("wearable_sessions")
          .select("date, source, sleep_score, readiness_score, resting_hr, hrv_avg, total_steps")
          .eq("client_id", clientId)
          .order("date", { ascending: false })
          .limit(30),
        supabase
          .from("check_ins")
          .select("created_at, pain_level")
          .eq("client_id", clientId)
          .order("created_at", { ascending: false })
          .limit(60),
      ]);
      const wrows = (data ?? []) as WRow[];
      setRows(wrows);
      const checkins = ((ci ?? []) as { created_at: string; pain_level: number | null }[]).map((r) => ({
        date: String(r.created_at).slice(0, 10),
        pain_level: r.pain_level ?? null,
      }));
      setForecast(computeForecast(wrows, checkins));
      setLoaded(true);
    })();
  }, [clientId]);

  if (!loaded || rows.length === 0) return null;

  const latest = (key: keyof WRow): number | null => {
    for (const r of rows) {
      const v = r[key];
      if (typeof v === "number") return v;
    }
    return null;
  };

  const sleepSeries = rows
    .slice(0, 7)
    .map((r) => r.sleep_score)
    .filter((v): v is number => typeof v === "number")
    .reverse();

  const stats: { label: string; value: number | null; unit?: string }[] = [
    { label: "Sleep", value: latest("sleep_score") },
    { label: "Readiness", value: latest("readiness_score") },
    { label: "Rest HR", value: latest("resting_hr"), unit: "bpm" },
    { label: "HRV", value: latest("hrv_avg"), unit: "ms" },
    { label: "Steps", value: latest("total_steps") },
  ];

  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Watch size={16} color="var(--blue-accent)" aria-hidden />
        <span style={titleStyle}>Wearable</span>
        <span style={{ color: "var(--white-muted)", fontFamily: "var(--font-ui)", fontSize: 11 }}>
          · {rows[0].source} · synced {new Date(rows[0].date).toLocaleDateString()}
        </span>
        {rows[0].source === "garmin" && <GarminAttribution />}
      </div>


      {forecast && forecast.hasWearable && (
        <div style={readBox}>
          <div style={readTitle}>Recovery vs symptoms</div>
          <div style={readMsg}>{forecast.message}</div>
          {forecast.personalNote && <div style={readNote}>{forecast.personalNote}</div>}
        </div>
      )}

      <div style={grid}>
        {stats.map((s) => (
          <div key={s.label} style={cell}>
            <div style={valueStyle}>
              {s.value == null ? "—" : Math.round(s.value).toLocaleString()}
              {s.value != null && s.unit ? <span style={unitStyle}> {s.unit}</span> : null}
            </div>
            <div style={labelStyle}>{s.label}</div>
          </div>
        ))}
      </div>

      {sleepSeries.length >= 2 && <Sparkline values={sleepSeries} />}
    </section>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 220;
  const h = 34;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ ...labelStyle, marginBottom: 4 }}>Sleep score · last {values.length}</div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
        <polyline
          points={pts}
          fill="none"
          stroke="var(--blue-accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 700,
  color: "var(--white)",
  fontSize: 14,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};
const readBox: CSSProperties = {
  marginTop: 12,
  padding: "10px 12px",
  borderRadius: 10,
  background: "rgba(74,141,240,0.08)",
  border: "1px solid rgba(74,141,240,0.28)",
};
const readTitle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 10,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--blue-accent)",
  marginBottom: 4,
};
const readMsg: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13.5,
  lineHeight: 1.5,
  color: "var(--white)",
};
const readNote: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--white-muted)",
  marginTop: 6,
};
const grid: CSSProperties = {
  marginTop: 12,
  display: "grid",
  gridTemplateColumns: "repeat(5, 1fr)",
  gap: 6,
};
const cell: CSSProperties = {
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  padding: "10px 6px",
  textAlign: "center",
};
const valueStyle: CSSProperties = {
  fontFamily: "var(--font-data)",
  fontSize: 16,
  fontWeight: 700,
  color: "var(--white)",
};
const unitStyle: CSSProperties = { fontSize: 10, color: "var(--white-muted)", fontWeight: 400 };
const labelStyle: CSSProperties = {
  marginTop: 2,
  fontFamily: "var(--font-ui)",
  fontSize: 10,
  color: "var(--white-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
