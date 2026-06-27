import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles, Send, X, AlertTriangle, Users, TrendingUp, TrendingDown, PhoneCall, Activity, Flame } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  listMyDrafts,
  updateDraftStatus,
  type PractitionerDraft,
} from "@/lib/practitioner-drafts.functions";
import { log } from "@/lib/log";

export const Route = createFileRoute("/practitioner/app/insights")({
  head: () => ({ meta: [{ title: "Insights — Buddy" }] }),
  component: Insights,
});

function Insights() {
  const [items, setItems] = useState<PractitionerDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await listMyDrafts();
      setItems(rows);
    } catch (e) {
      log.error(e);
      setError("Could not load insights.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const act = async (id: string, status: "sent" | "dismissed") => {
    setBusy(id);
    setError(null);
    try {
      await updateDraftStatus({ data: { id, status } });
      setItems((p) => p.filter((d) => d.id !== id));
    } catch (e) {
      log.error(e);
      setError("Action failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ padding: "24px 20px 32px", color: "var(--white)" }}>
      <h1 style={{ fontFamily: "var(--font-hero)", fontSize: 24, fontWeight: 400 }}>Insights</h1>
      <p style={{ marginTop: 6, color: "var(--white-muted)", fontSize: 13 }}>
        Drafted notes from nightly passive monitoring. Review, send to your records, or dismiss.
      </p>

      <DemoOverview />

      <h2 style={{ marginTop: 28, fontFamily: "var(--font-hero)", fontSize: 18, fontWeight: 400 }}>
        Drafted notes
      </h2>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 14,
            padding: 12,
            background: "color-mix(in oklab, var(--red) 18%, transparent)",
            border: "1px solid var(--red)",
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ marginTop: 20, color: "var(--white-muted)" }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ marginTop: 24, color: "var(--white-muted)" }}>
          No drafts right now. New insights appear here after the nightly risk run.
        </p>
      ) : (
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((d) => (
            <div
              key={d.id}
              style={{
                background: "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <strong style={{ fontSize: 15 }}>{d.client_name}</strong>
                {d.risk_score !== null && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: d.risk_score >= 60 ? "var(--red)" : "var(--navy)",
                      color: "var(--white)",
                      fontFamily: "var(--font-data)",
                    }}
                  >
                    <AlertTriangle size={12} /> Risk {d.risk_score}
                  </span>
                )}
              </div>
              <div
                style={{
                  marginTop: 10,
                  padding: 12,
                  background: "var(--navy)",
                  borderRadius: 10,
                  border: "1px solid var(--navy-border)",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Sparkles size={14} /> {d.draft_title}
                </div>
                <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45, color: "var(--white-muted)" }}>
                  {d.draft_body}
                </p>
                {d.suggested_action?.program_name && (
                  <p style={{ marginTop: 8, fontSize: 12, color: "var(--blue-accent)" }}>
                    Suggested program: {d.suggested_action.program_name}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  onClick={() => act(d.id, "dismissed")}
                  disabled={busy === d.id}
                  style={{
                    flex: 1, minHeight: 44, borderRadius: 8,
                    background: "transparent",
                    border: "1px solid var(--navy-border)",
                    color: "var(--white)",
                    fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 14,
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                    cursor: "pointer", opacity: busy === d.id ? 0.5 : 1,
                  }}
                >
                  <X size={16} /> Dismiss
                </button>
                <button
                  onClick={() => act(d.id, "sent")}
                  disabled={busy === d.id}
                  style={{
                    flex: 2, minHeight: 44, borderRadius: 8,
                    background: "var(--blue-accent)",
                    border: "none", color: "var(--white)",
                    fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 14,
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                    cursor: "pointer", opacity: busy === d.id ? 0.5 : 1,
                  }}
                >
                  <Send size={16} /> Mark actioned
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------
// Demo overview: shells filled with artificial data for visual review.
// Replace each block with real queries when wiring up live analytics.
// ----------------------------------------------------------------------

const COLORS = {
  blue: "#3B82F6",
  green: "#22c55e",
  amber: "#f59e0b",
  red: "#ef4444",
  violet: "#8b5cf6",
  cyan: "#06b6d4",
};

const checkInTrend = [
  { day: "Mon", checkins: 18 },
  { day: "Tue", checkins: 22 },
  { day: "Wed", checkins: 19 },
  { day: "Thu", checkins: 26 },
  { day: "Fri", checkins: 24 },
  { day: "Sat", checkins: 12 },
  { day: "Sun", checkins: 9 },
];

const painTrend = [
  { week: "W1", pain: 6.4 },
  { week: "W2", pain: 6.1 },
  { week: "W3", pain: 5.8 },
  { week: "W4", pain: 5.3 },
  { week: "W5", pain: 5.0 },
  { week: "W6", pain: 4.6 },
];

const progressBuckets = [
  { name: "Improving", value: 14, color: COLORS.green },
  { name: "Stable", value: 9, color: COLORS.blue },
  { name: "Worsening", value: 5, color: COLORS.red },
  { name: "No data", value: 3, color: "#475569" },
];

const contactStatus = [
  { label: "Contacted this week", value: 11, color: COLORS.green },
  { label: "Awaiting outreach", value: 6, color: COLORS.amber },
  { label: "Overdue (>14d)", value: 4, color: COLORS.red },
];

const symptoms = [
  { name: "Lower back", count: 17 },
  { name: "Knee", count: 12 },
  { name: "Shoulder", count: 9 },
  { name: "Neck", count: 7 },
  { name: "Sleep", count: 6 },
  { name: "Headache", count: 4 },
];

const topMovers = [
  { name: "J. Carter", delta: -2.4 },
  { name: "M. Singh", delta: -1.8 },
  { name: "A. Rivera", delta: -1.3 },
  { name: "K. Owens", delta: +1.6 },
  { name: "R. Patel", delta: +2.2 },
];

function DemoOverview() {
  return (
    <section style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 style={{ fontFamily: "var(--font-hero)", fontSize: 18, fontWeight: 400 }}>
          Practice overview
        </h2>
        <span
          style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 999,
            background: "color-mix(in oklab, var(--amber) 22%, transparent)",
            border: "1px solid var(--amber)", color: "var(--amber)",
            fontFamily: "var(--font-data)", fontWeight: 700, letterSpacing: 0.4,
          }}
        >
          DEMO DATA
        </span>
      </div>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <Kpi Icon={Users} label="Active clients" value="31" tone="blue" />
        <Kpi Icon={Activity} label="Check-ins (7d)" value="130" tone="cyan" />
        <Kpi Icon={TrendingDown} label="Avg pain" value="5.0" sub="↓ 1.4 vs 6w ago" tone="green" />
        <Kpi Icon={PhoneCall} label="Contacted (7d)" value="11" tone="violet" />
      </div>

      {/* Charts grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        <Card title="Recent check-ins" Icon={Activity}>
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={checkInTrend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.cyan} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={COLORS.cyan} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--navy-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" stroke="var(--white-muted)" fontSize={11} />
              <YAxis stroke="var(--white-muted)" fontSize={11} />
              <Tooltip contentStyle={tooltipStyle} />
              <Area type="monotone" dataKey="checkins" stroke={COLORS.cyan} fill="url(#cg)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Average pain (6 weeks)" Icon={TrendingDown}>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={painTrend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="var(--navy-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" stroke="var(--white-muted)" fontSize={11} />
              <YAxis domain={[0, 10]} stroke="var(--white-muted)" fontSize={11} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="pain" stroke={COLORS.green} strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Client progress" Icon={TrendingUp}>
          <ResponsiveContainer width="100%" height={170}>
            <PieChart>
              <Pie data={progressBuckets} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={2}>
                {progressBuckets.map((b) => <Cell key={b.name} fill={b.color} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <Legend items={progressBuckets.map(b => ({ label: b.name, value: b.value, color: b.color }))} />
        </Card>

        <Card title="Outreach status" Icon={PhoneCall}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
            {contactStatus.map((c) => {
              const total = contactStatus.reduce((a, b) => a + b.value, 0);
              const pct = Math.round((c.value / total) * 100);
              return (
                <div key={c.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: "var(--white-muted)" }}>{c.label}</span>
                    <span style={{ fontFamily: "var(--font-data)" }}>{c.value}</span>
                  </div>
                  <div style={{ height: 6, background: "var(--navy)", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: c.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Most prevalent symptoms" Icon={Flame}>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={symptoms} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--navy-border)" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" stroke="var(--white-muted)" fontSize={11} />
              <YAxis dataKey="name" type="category" stroke="var(--white-muted)" fontSize={11} width={80} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill={COLORS.violet} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Biggest movers (pain Δ vs baseline)" Icon={TrendingUp}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
            {topMovers.map((m) => {
              const improving = m.delta < 0;
              return (
                <div key={m.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontSize: 13 }}>{m.name}</span>
                  <span
                    style={{
                      fontFamily: "var(--font-data)", fontSize: 12, fontWeight: 700,
                      padding: "2px 8px", borderRadius: 999,
                      background: improving ? "color-mix(in oklab, var(--green) 20%, transparent)" : "color-mix(in oklab, var(--red) 20%, transparent)",
                      color: improving ? "var(--green)" : "var(--red)",
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}
                  >
                    {improving ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                    {m.delta > 0 ? "+" : ""}{m.delta.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </section>
  );
}

const tooltipStyle = {
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--white)",
};

function Kpi({
  Icon, label, value, sub, tone,
}: {
  Icon: typeof Users; label: string; value: string; sub?: string;
  tone: "blue" | "cyan" | "green" | "violet" | "amber" | "red";
}) {
  const color = COLORS[tone];
  return (
    <div
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 12, padding: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--white-muted)", fontSize: 12 }}>
        <Icon size={14} color={color} /> {label}
      </div>
      <div style={{ marginTop: 6, fontFamily: "var(--font-data)", fontSize: 24, fontWeight: 700 }}>
        {value}
      </div>
      {sub && (
        <div style={{ marginTop: 2, fontSize: 11, color: "var(--white-muted)" }}>{sub}</div>
      )}
    </div>
  );
}

function Card({ title, Icon, children }: { title: string; Icon: typeof Users; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 12, padding: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Icon size={14} color="var(--blue-accent)" />
        <strong style={{ fontSize: 13 }}>{title}</strong>
      </div>
      {children}
    </div>
  );
}

function Legend({ items }: { items: { label: string; value: number; color: string }[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
      {items.map((i) => (
        <div key={i.label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--white-muted)" }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: i.color }} />
          {i.label} <span style={{ fontFamily: "var(--font-data)", color: "var(--white)" }}>{i.value}</span>
        </div>
      ))}
    </div>
  );
}
