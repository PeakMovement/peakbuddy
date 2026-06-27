import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Sparkles, Send, X, AlertTriangle, Users, TrendingUp, TrendingDown,
  PhoneCall, Activity, Flame, EyeOff, Eye, ChevronDown, ChevronUp,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  listMyDrafts,
  updateDraftStatus,
  type PractitionerDraft,
} from "@/lib/practitioner-drafts.functions";
import { getPracticeInsights, type InsightsPayload } from "@/lib/insights.functions";
import {
  loadHidden, saveHidden, INSIGHTS_CARD_LABELS, type InsightsCardId,
} from "@/lib/insights-visibility";
import { supabase } from "@/integrations/supabase/client";
import { log } from "@/lib/log";

const DEMO_PRACTITIONER_EMAIL = "practitioner@demo.com";

export const Route = createFileRoute("/practitioner/app/insights")({
  head: () => ({ meta: [{ title: "Insights — Buddy" }] }),
  component: Insights,
});

function Insights() {
  const [items, setItems] = useState<PractitionerDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [isDemoPractitioner, setIsDemoPractitioner] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  const [insights, setInsights] = useState<InsightsPayload | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);

  const [hidden, setHidden] = useState<Set<InsightsCardId>>(new Set());
  const [showHiddenPanel, setShowHiddenPanel] = useState(false);

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
    void (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data.user?.id ?? null;
        const email = data.user?.email ?? null;
        setUserId(uid);
        setHidden(loadHidden(uid));
        if (email && email.toLowerCase() === DEMO_PRACTITIONER_EMAIL) {
          setIsDemoPractitioner(true);
          setShowDemo(true); // demo account defaults to demo view
        }
      } catch (e) {
        log.error(e);
      }
    })();
    void (async () => {
      setInsightsLoading(true);
      try {
        const data = await getPracticeInsights();
        setInsights(data);
      } catch (e) {
        log.error(e);
      } finally {
        setInsightsLoading(false);
      }
    })();
  }, []);

  const toggleHidden = (id: InsightsCardId) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveHidden(userId, next);
      return next;
    });
  };

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

  const hiddenList = useMemo(
    () => (Object.keys(INSIGHTS_CARD_LABELS) as InsightsCardId[]).filter((id) => hidden.has(id)),
    [hidden],
  );

  return (
    <div style={{ padding: "24px 20px 32px", color: "var(--white)" }}>
      <h1 style={{ fontFamily: "var(--font-hero)", fontSize: 24, fontWeight: 400 }}>Insights</h1>
      <p style={{ marginTop: 6, color: "var(--white-muted)", fontSize: 13 }}>
        Drafted notes from nightly passive monitoring. Review, send to your records, or dismiss.
      </p>

      {isDemoPractitioner && (
        <div
          style={{
            marginTop: 14,
            display: "inline-flex",
            background: "var(--navy-card)",
            border: "1px solid var(--navy-border)",
            borderRadius: 999,
            padding: 4,
            gap: 4,
          }}
        >
          <ToggleChip active={!showDemo} onClick={() => setShowDemo(false)} label="Live data" />
          <ToggleChip active={showDemo} onClick={() => setShowDemo(true)} label="Demo data" />
        </div>
      )}

      {showDemo ? (
        <DemoOverview hidden={hidden} onToggleHidden={toggleHidden} />
      ) : (
        <LiveOverview
          data={insights}
          loading={insightsLoading}
          hidden={hidden}
          onToggleHidden={toggleHidden}
        />
      )}

      {/* Hidden cards panel */}
      <section style={{ marginTop: 20 }}>
        <button
          onClick={() => setShowHiddenPanel((s) => !s)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "transparent", border: "1px solid var(--navy-border)",
            color: "var(--white-muted)", borderRadius: 8, padding: "8px 12px",
            fontSize: 12, cursor: "pointer",
          }}
        >
          {showHiddenPanel ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Hidden cards ({hiddenList.length})
        </button>
        {showHiddenPanel && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {hiddenList.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--white-muted)" }}>
                Nothing hidden. Use the eye icon on any card to hide it.
              </p>
            ) : (
              hiddenList.map((id) => (
                <button
                  key={id}
                  onClick={() => toggleHidden(id)}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "space-between",
                    gap: 8, background: "var(--navy-card)", border: "1px solid var(--navy-border)",
                    color: "var(--white)", borderRadius: 8, padding: "8px 12px",
                    fontSize: 13, cursor: "pointer",
                  }}
                >
                  <span>{INSIGHTS_CARD_LABELS[id]}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--blue-accent)", fontSize: 11 }}>
                    <Eye size={12} /> Show
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </section>

      <h2 style={{ marginTop: 28, fontFamily: "var(--font-hero)", fontSize: 18, fontWeight: 400 }}>
        Drafted notes
      </h2>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 14, padding: 12,
            background: "color-mix(in oklab, var(--red) 18%, transparent)",
            border: "1px solid var(--red)", borderRadius: 10, fontSize: 13,
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
                background: "var(--navy-card)", border: "1px solid var(--navy-border)",
                borderRadius: 12, padding: 14,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <strong style={{ fontSize: 15 }}>{d.client_name}</strong>
                {d.risk_score !== null && (
                  <span
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: 11, padding: "2px 8px", borderRadius: 999,
                      background: d.risk_score >= 60 ? "var(--red)" : "var(--navy)",
                      color: "var(--white)", fontFamily: "var(--font-data)",
                    }}
                  >
                    <AlertTriangle size={12} /> Risk {d.risk_score}
                  </span>
                )}
              </div>
              <div
                style={{
                  marginTop: 10, padding: 12, background: "var(--navy)",
                  borderRadius: 10, border: "1px solid var(--navy-border)",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14, display: "inline-flex", alignItems: "center", gap: 6 }}>
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
                    background: "transparent", border: "1px solid var(--navy-border)",
                    color: "var(--white)", fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 14,
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
                    background: "var(--blue-accent)", border: "none", color: "var(--white)",
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

function ToggleChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px", borderRadius: 999,
        background: active ? "var(--blue-accent)" : "transparent",
        color: "var(--white)", border: "none", cursor: "pointer",
        fontSize: 12, fontFamily: "var(--font-ui)", fontWeight: 600,
      }}
    >
      {label}
    </button>
  );
}

// ----------------------------------------------------------------------
// Shared visual primitives
// ----------------------------------------------------------------------

const COLORS = {
  blue: "#3B82F6",
  green: "#22c55e",
  amber: "#f59e0b",
  red: "#ef4444",
  violet: "#8b5cf6",
  cyan: "#06b6d4",
  slate: "#475569",
};

const tooltipStyle = {
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--white)",
};

function HideButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Hide from insights"
      title="Hide from insights"
      style={{
        background: "transparent", border: "none", color: "var(--white-muted)",
        cursor: "pointer", padding: 4, display: "inline-flex", alignItems: "center",
      }}
    >
      <EyeOff size={14} />
    </button>
  );
}

function Kpi({
  Icon, label, value, sub, tone, id, hidden, onToggleHidden,
}: {
  Icon: typeof Users; label: string; value: string; sub?: string;
  tone: "blue" | "cyan" | "green" | "violet" | "amber" | "red";
  id: InsightsCardId; hidden: Set<InsightsCardId>; onToggleHidden: (id: InsightsCardId) => void;
}) {
  if (hidden.has(id)) return null;
  const color = COLORS[tone];
  return (
    <div
      style={{
        background: "var(--navy-card)", border: "1px solid var(--navy-border)",
        borderRadius: 12, padding: 12, position: "relative",
      }}
    >
      <div style={{ position: "absolute", top: 8, right: 8 }}>
        <HideButton onClick={() => onToggleHidden(id)} />
      </div>
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

function Card({
  id, title, Icon, hidden, onToggleHidden, children,
}: {
  id: InsightsCardId; title: string; Icon: typeof Users;
  hidden: Set<InsightsCardId>; onToggleHidden: (id: InsightsCardId) => void;
  children: React.ReactNode;
}) {
  if (hidden.has(id)) return null;
  return (
    <div
      style={{
        background: "var(--navy-card)", border: "1px solid var(--navy-border)",
        borderRadius: 12, padding: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon size={14} color="var(--blue-accent)" />
          <strong style={{ fontSize: 13 }}>{title}</strong>
        </div>
        <HideButton onClick={() => onToggleHidden(id)} />
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

// ----------------------------------------------------------------------
// Live overview (real data)
// ----------------------------------------------------------------------

function LiveOverview({
  data, loading, hidden, onToggleHidden,
}: {
  data: InsightsPayload | null; loading: boolean;
  hidden: Set<InsightsCardId>; onToggleHidden: (id: InsightsCardId) => void;
}) {
  if (loading) {
    return <p style={{ marginTop: 20, color: "var(--white-muted)" }}>Loading insights…</p>;
  }
  if (!data) {
    return <p style={{ marginTop: 20, color: "var(--white-muted)" }}>No data available.</p>;
  }

  const progressColored = data.progressBuckets.map((b) => ({
    ...b,
    color:
      b.name === "Improving" ? COLORS.green :
      b.name === "Stable" ? COLORS.blue :
      b.name === "Worsening" ? COLORS.red : COLORS.slate,
  }));
  const contactColored = data.contactStatus.map((c, i) => ({
    ...c,
    color: [COLORS.green, COLORS.amber, COLORS.red][i] ?? COLORS.slate,
  }));

  const painSub =
    data.kpis.avgPainDelta === null
      ? undefined
      : `${data.kpis.avgPainDelta > 0 ? "↑" : "↓"} ${Math.abs(data.kpis.avgPainDelta)} vs 6w ago`;

  return (
    <Overview
      headerTitle="Practice overview"
      badge={null}
      hidden={hidden}
      onToggleHidden={onToggleHidden}
      kpis={{
        active: String(data.kpis.activeClients),
        checkins: String(data.kpis.checkins7d),
        pain: data.kpis.avgPain === null ? "—" : data.kpis.avgPain.toFixed(1),
        painSub,
        contacted: String(data.kpis.contacted7d),
      }}
      checkInTrend={data.checkInTrend}
      painTrend={data.painTrend}
      progressBuckets={progressColored}
      contactStatus={contactColored}
      symptoms={data.symptoms}
      topMovers={data.topMovers}
    />
  );
}

// ----------------------------------------------------------------------
// Demo overview (artificial data, only shown to demo practitioner)
// ----------------------------------------------------------------------

const demoCheckInTrend = [
  { day: "Mon", checkins: 18 }, { day: "Tue", checkins: 22 }, { day: "Wed", checkins: 19 },
  { day: "Thu", checkins: 26 }, { day: "Fri", checkins: 24 }, { day: "Sat", checkins: 12 },
  { day: "Sun", checkins: 9 },
];
const demoPainTrend = [
  { week: "W1", pain: 6.4 }, { week: "W2", pain: 6.1 }, { week: "W3", pain: 5.8 },
  { week: "W4", pain: 5.3 }, { week: "W5", pain: 5.0 }, { week: "W6", pain: 4.6 },
];
const demoProgress = [
  { name: "Improving" as const, value: 14, color: COLORS.green },
  { name: "Stable" as const, value: 9, color: COLORS.blue },
  { name: "Worsening" as const, value: 5, color: COLORS.red },
  { name: "No data" as const, value: 3, color: COLORS.slate },
];
const demoContact = [
  { label: "Contacted this week", value: 11, color: COLORS.green },
  { label: "Awaiting outreach", value: 6, color: COLORS.amber },
  { label: "Overdue (>14d)", value: 4, color: COLORS.red },
];
const demoSymptoms = [
  { name: "Lower back", count: 17 }, { name: "Knee", count: 12 }, { name: "Shoulder", count: 9 },
  { name: "Neck", count: 7 }, { name: "Sleep", count: 6 }, { name: "Headache", count: 4 },
];
const demoMovers = [
  { name: "J. Carter", delta: -2.4 }, { name: "M. Singh", delta: -1.8 },
  { name: "A. Rivera", delta: -1.3 }, { name: "K. Owens", delta: 1.6 }, { name: "R. Patel", delta: 2.2 },
];

function DemoOverview({
  hidden, onToggleHidden,
}: {
  hidden: Set<InsightsCardId>; onToggleHidden: (id: InsightsCardId) => void;
}) {
  return (
    <Overview
      headerTitle="Practice overview"
      badge="DEMO DATA"
      hidden={hidden}
      onToggleHidden={onToggleHidden}
      kpis={{
        active: "31", checkins: "130",
        pain: "5.0", painSub: "↓ 1.4 vs 6w ago",
        contacted: "11",
      }}
      checkInTrend={demoCheckInTrend}
      painTrend={demoPainTrend}
      progressBuckets={demoProgress}
      contactStatus={demoContact}
      symptoms={demoSymptoms}
      topMovers={demoMovers}
    />
  );
}

// ----------------------------------------------------------------------
// Shared overview renderer (used by both Live and Demo)
// ----------------------------------------------------------------------

type OverviewProps = {
  headerTitle: string;
  badge: string | null;
  hidden: Set<InsightsCardId>;
  onToggleHidden: (id: InsightsCardId) => void;
  kpis: { active: string; checkins: string; pain: string; painSub?: string; contacted: string };
  checkInTrend: { day: string; checkins: number }[];
  painTrend: { week: string; pain: number | null }[];
  progressBuckets: { name: string; value: number; color: string }[];
  contactStatus: { label: string; value: number; color: string }[];
  symptoms: { name: string; count: number }[];
  topMovers: { name: string; delta: number }[];
};

function Overview(p: OverviewProps) {
  return (
    <section style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 style={{ fontFamily: "var(--font-hero)", fontSize: 18, fontWeight: 400 }}>
          {p.headerTitle}
        </h2>
        {p.badge && (
          <span
            style={{
              fontSize: 10, padding: "2px 8px", borderRadius: 999,
              background: "color-mix(in oklab, var(--amber) 22%, transparent)",
              border: "1px solid var(--amber)", color: "var(--amber)",
              fontFamily: "var(--font-data)", fontWeight: 700, letterSpacing: 0.4,
            }}
          >
            {p.badge}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <Kpi id="kpi-active" hidden={p.hidden} onToggleHidden={p.onToggleHidden}
          Icon={Users} label="Active clients" value={p.kpis.active} tone="blue" />
        <Kpi id="kpi-checkins" hidden={p.hidden} onToggleHidden={p.onToggleHidden}
          Icon={Activity} label="Check-ins (7d)" value={p.kpis.checkins} tone="cyan" />
        <Kpi id="kpi-pain" hidden={p.hidden} onToggleHidden={p.onToggleHidden}
          Icon={TrendingDown} label="Avg pain" value={p.kpis.pain} sub={p.kpis.painSub} tone="green" />
        <Kpi id="kpi-contacted" hidden={p.hidden} onToggleHidden={p.onToggleHidden}
          Icon={PhoneCall} label="Contacted (7d)" value={p.kpis.contacted} tone="violet" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        <Card id="card-checkins" title="Recent check-ins" Icon={Activity}
          hidden={p.hidden} onToggleHidden={p.onToggleHidden}>
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={p.checkInTrend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
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

        <Card id="card-pain" title="Average pain (6 weeks)" Icon={TrendingDown}
          hidden={p.hidden} onToggleHidden={p.onToggleHidden}>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={p.painTrend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="var(--navy-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="week" stroke="var(--white-muted)" fontSize={11} />
              <YAxis domain={[0, 10]} stroke="var(--white-muted)" fontSize={11} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line type="monotone" dataKey="pain" stroke={COLORS.green} strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card id="card-progress" title="Client progress" Icon={TrendingUp}
          hidden={p.hidden} onToggleHidden={p.onToggleHidden}>
          <ResponsiveContainer width="100%" height={170}>
            <PieChart>
              <Pie data={p.progressBuckets} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={2}>
                {p.progressBuckets.map((b) => <Cell key={b.name} fill={b.color} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <Legend items={p.progressBuckets.map(b => ({ label: b.name, value: b.value, color: b.color }))} />
        </Card>

        <Card id="card-outreach" title="Outreach status" Icon={PhoneCall}
          hidden={p.hidden} onToggleHidden={p.onToggleHidden}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
            {p.contactStatus.map((c) => {
              const total = p.contactStatus.reduce((a, b) => a + b.value, 0) || 1;
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

        <Card id="card-symptoms" title="Most prevalent symptoms" Icon={Flame}
          hidden={p.hidden} onToggleHidden={p.onToggleHidden}>
          {p.symptoms.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--white-muted)", padding: "20px 0" }}>
              No symptom keywords detected in recent check-in notes.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={p.symptoms} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--navy-border)" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke="var(--white-muted)" fontSize={11} />
                <YAxis dataKey="name" type="category" stroke="var(--white-muted)" fontSize={11} width={80} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill={COLORS.violet} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card id="card-movers" title="Biggest movers (pain Δ vs baseline)" Icon={TrendingUp}
          hidden={p.hidden} onToggleHidden={p.onToggleHidden}>
          {p.topMovers.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--white-muted)", padding: "20px 0" }}>
              Not enough check-ins yet to compute movers.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
              {p.topMovers.map((m) => {
                const improving = m.delta < 0;
                return (
                  <div key={m.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13 }}>{m.name}</span>
                    <span
                      style={{
                        fontFamily: "var(--font-data)", fontSize: 12, fontWeight: 700,
                        padding: "2px 8px", borderRadius: 999,
                        background: improving
                          ? "color-mix(in oklab, var(--green) 20%, transparent)"
                          : "color-mix(in oklab, var(--red) 20%, transparent)",
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
          )}
        </Card>
      </div>
    </section>
  );
}
