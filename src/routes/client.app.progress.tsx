import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useServerFn } from "@tanstack/react-start";
import { getMyWearableSnapshot, type WearableSnapshot } from "@/lib/wearables/snapshot.functions";
import { WearableTiles } from "@/components/wearables/WearableTiles";
import { getClientId } from "@/lib/client-session";
import type { CheckIn, Client } from "@/lib/types";

export const Route = createFileRoute("/client/app/progress")({
  component: ProgressScreen,
});

function ringColor(pct: number) {
  if (pct >= 75) return "var(--green)";
  if (pct >= 50) return "var(--amber)";
  return "var(--red)";
}

function CircularRing({
  size,
  stroke,
  pct,
  color,
  children,
}: {
  size: number;
  stroke: number;
  pct: number;
  color: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(Math.max(pct, 0), 100) / 100) * c;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--navy-border)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ProgressScreen() {
  const [client, setClient] = useState<Client | null>(null);
  const [items, setItems] = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<WearableSnapshot | null>(null);
  const loadSnapshot = useServerFn(getMyWearableSnapshot);

  useEffect(() => {
    const id = getClientId();
    if (!id) return;
    (async () => {
      const [{ data: c }, { data: ci }] = await Promise.all([
        supabase.from("clients").select("*").eq("id", id).maybeSingle(),
        supabase
          .from("check_ins")
          .select("*")
          .eq("client_id", id)
          .order("created_at", { ascending: true }),
      ]);
      setClient(c as Client | null);
      setItems((ci as CheckIn[]) ?? []);
      setLoading(false);
      loadSnapshot()
        .then(setSnapshot)
        .catch(() => setSnapshot({ connected: false, provider: null, date: null, session: null }));
    })();
  }, []);

  const stats = useMemo(() => {
    const avg = (key: keyof CheckIn) => {
      const vals = items.map((i) => i[key]).filter((v) => typeof v === "number") as number[];
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };
    return {
      sleep: avg("sleep_quality"),
      stress: avg("stress_level"),
      energy: avg("energy_level"),
      mood: avg("mood"),
    };
  }, [items]);

  const compliancePct = useMemo(() => {
    if (!client) return 0;
    const weeks = client.tracking_duration_weeks ?? 8;
    const expected = client.check_in_frequency === "daily" ? weeks * 7 : weeks;
    const start = new Date(client.created_at).getTime();
    const elapsed = Math.max(1, Math.ceil((Date.now() - start) / (1000 * 60 * 60 * 24)));
    const expectedSoFar =
      client.check_in_frequency === "daily"
        ? Math.min(elapsed, expected)
        : Math.min(Math.ceil(elapsed / 7), expected);
    return Math.min(100, Math.round((items.length / Math.max(1, expectedSoFar)) * 100));
  }, [client, items]);

  const trend = useMemo(() => {
    const pains = items.filter((i) => i.pain_level != null).map((i) => i.pain_level as number);
    if (pains.length < 6) return { label: "Stable", color: "var(--blue-cold)", Icon: Minus };
    const half = Math.floor(pains.length / 2);
    const avg1 = pains.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const avg2 = pains.slice(half).reduce((a, b) => a + b, 0) / (pains.length - half);
    const diff = avg2 - avg1;
    if (diff <= -0.7) return { label: "Improving", color: "var(--green)", Icon: TrendingDown };
    if (diff >= 0.7) return { label: "Declining", color: "var(--red)", Icon: TrendingUp };
    return { label: "Stable", color: "var(--blue-cold)", Icon: Minus };
  }, [items]);

  const last30 = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return items
      .filter((i) => new Date(i.created_at).getTime() >= cutoff && i.pain_level != null)
      .map((i) => ({
        date: new Date(i.created_at).toLocaleDateString(undefined, {
          month: "numeric",
          day: "numeric",
        }),
        pain: i.pain_level,
      }));
  }, [items]);

  if (loading) return <div style={{ padding: 24, color: "var(--white-muted)" }}>Loading…</div>;

  const TrendIcon = trend.Icon;

  return (
    <div style={{ padding: "24px 20px 32px" }}>
      <h1
        style={{
          fontFamily: "var(--font-hero)",
          fontWeight: 400,
          fontSize: 28,
          color: "var(--white)",
        }}
      >
        Your Progress
      </h1>

      {items.length < 3 ? (
        <p style={{ marginTop: 24, color: "var(--white-muted)" }}>
          Keep checking in. Your progress will appear here after 3 check-ins.
        </p>
      ) : (
        <>
          {/* Compliance Ring */}
          <div
            style={{
              marginTop: 28,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <CircularRing
              size={180}
              stroke={14}
              pct={compliancePct}
              color={ringColor(compliancePct)}
            >
              <div style={{ textAlign: "center" }}>
                <div
                  style={{
                    fontFamily: "var(--font-data)",
                    fontSize: 36,
                    fontWeight: 700,
                    color: "var(--white)",
                  }}
                >
                  {compliancePct}%
                </div>
              </div>
            </CircularRing>
            <div
              style={{
                marginTop: 12,
                fontFamily: "var(--font-ui)",
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--white-muted)",
                fontSize: 12,
              }}
            >
              Compliance
            </div>
          </div>

          {/* Trend */}
          <div
            style={{
              marginTop: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: trend.color,
            }}
          >
            <TrendIcon size={20} />
            <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600 }}>{trend.label}</span>
          </div>

          {/* Pain trend chart */}
          {last30.length >= 3 && (
            <div
              style={{
                marginTop: 28,
                background: "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                borderRadius: 12,
                padding: 16,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-ui)",
                  fontWeight: 600,
                  color: "var(--white)",
                  marginBottom: 12,
                }}
              >
                Pain — last 30 days
              </div>
              <div style={{ width: "100%", height: 180 }}>
                <ResponsiveContainer>
                  <LineChart data={last30} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid stroke="var(--navy-border)" strokeDasharray="3 3" />
                    <XAxis dataKey="date" stroke="var(--white-muted)" fontSize={10} />
                    <YAxis domain={[0, 10]} stroke="var(--white-muted)" fontSize={10} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--navy)",
                        border: "1px solid var(--navy-border)",
                        color: "var(--white)",
                        fontSize: 12,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="pain"
                      stroke="var(--blue-cold)"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* 2x2 metric rings — self-reported check-in averages */}
          <div
            style={{
              marginTop: 24,
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--white-muted)",
              marginBottom: 12,
            }}
          >
            How you&apos;ve been feeling · your check-ins
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <MetricRing label="Sleep" value={stats.sleep} />
            <MetricRing label="Stress" value={stats.stress} />
            <MetricRing label="Energy" value={stats.energy} />
            <MetricRing label="Mood" value={stats.mood} />
          </div>

          <WearableTiles snapshot={snapshot} />
        </>
      )}
    </div>
  );
}

function MetricRing({ label, value }: { label: string; value: number }) {
  const pct = (value / 5) * 100;
  return (
    <div
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
      }}
    >
      <CircularRing size={84} stroke={8} pct={pct} color="var(--blue-cold)">
        <div
          style={{
            fontFamily: "var(--font-data)",
            fontSize: 18,
            fontWeight: 700,
            color: "var(--white)",
          }}
        >
          {value ? value.toFixed(1) : "—"}
        </div>
      </CircularRing>
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          color: "var(--white-muted)",
          fontSize: 12,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
}
