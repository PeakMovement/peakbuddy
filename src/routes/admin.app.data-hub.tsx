import { createFileRoute } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  ComposedChart, XAxis, YAxis, Tooltip, CartesianGrid, Cell, Legend,
} from "recharts";
import {
  listAllClientsForAdmin, getAdminClientBundle,
  type AdminClientListItem, type AdminClientBundle,
} from "@/lib/admin-data-hub.functions";
import { log } from "@/lib/log";

export const Route = createFileRoute("/admin/app/data-hub")({
  head: () => ({ meta: [{ title: "Data Hub — Buddy" }] }),
  component: AdminDataHub,
});

type Row = Record<string, unknown>;
const C = { red: "#f87171", green: "#34d399", amber: "#fbbf24", blue: "#4a8df0", muted: "#b8c5db", card: "#243a6b", border: "#3658a3", white: "#f0ece4" };
const num = (v: unknown): number | null => (typeof v === "number" && !isNaN(v) ? v : null);
const s = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));
function shortDate(v: unknown): string {
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v ?? "") : d.toLocaleDateString("en-ZA", { month: "short", day: "numeric" });
}
function fmtDateTime(v: unknown): string {
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v ?? "—") : d.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
}
function painColor(p: number | null): string {
  if (p === null) return C.muted;
  if (p <= 3) return C.green;
  if (p <= 6) return C.amber;
  return C.red;
}
function urgencyColor(u: unknown): string {
  const v = String(u);
  if (v === "emergency" || v === "urgent") return C.red;
  if (v === "soon") return C.amber;
  if (v === "monitor") return C.blue;
  return C.muted;
}

type SectionKey =
  | "overview" | "symptoms" | "risk" | "wearable" | "load" | "history"
  | "predictors" | "rhythms" | "vitals" | "patterns" | "yves" | "alerts";

const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "symptoms", label: "Symptom trend" },
  { key: "risk", label: "Risk score" },
  { key: "wearable", label: "Wearable connection" },
  { key: "load", label: "Training load" },
  { key: "history", label: "Load history" },
  { key: "predictors", label: "Predictors" },
  { key: "rhythms", label: "Rhythms" },
  { key: "vitals", label: "Vitals" },
  { key: "patterns", label: "Patterns" },
  { key: "yves", label: "Yves queries" },
  { key: "alerts", label: "Alerts" },
];
const VIS_STORAGE_KEY = "admin.dataHub.visibleSections.v1";

function AdminDataHub() {
  const [clients, setClients] = useState<AdminClientListItem[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [bundle, setBundle] = useState<AdminClientBundle | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingBundle, setLoadingBundle] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<SectionKey, boolean>>(() => {
    const base = Object.fromEntries(SECTIONS.map((s) => [s.key, true])) as Record<SectionKey, boolean>;
    if (typeof window === "undefined") return base;
    try {
      const saved = JSON.parse(window.localStorage.getItem(VIS_STORAGE_KEY) || "{}");
      return { ...base, ...saved };
    } catch { return base; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(VIS_STORAGE_KEY, JSON.stringify(visible)); } catch { /* ignore */ }
  }, [visible]);
  const toggle = (k: SectionKey) => setVisible((v) => ({ ...v, [k]: !v[k] }));
  const showAll = () => setVisible(Object.fromEntries(SECTIONS.map((s) => [s.key, true])) as Record<SectionKey, boolean>);
  const listFn = useServerFn(listAllClientsForAdmin);
  const bundleFn = useServerFn(getAdminClientBundle);


  useEffect(() => {
    (async () => {
      try { setClients(await listFn()); }
      catch (e) { setErr(e instanceof Error ? e.message : "Failed to load clients"); }
      finally { setLoadingList(false); }
    })();
  }, [listFn]);

  useEffect(() => {
    if (!selected) { setBundle(null); return; }
    setLoadingBundle(true); setErr(null);
    (async () => {
      try { setBundle(await bundleFn({ data: { clientId: selected } })); }
      catch (e) { log.error(e); setErr(e instanceof Error ? e.message : "Failed to load data"); setBundle(null); }
      finally { setLoadingBundle(false); }
    })();
  }, [selected, bundleFn]);

  const b = bundle;
  // ── chart series (chronological) ──
  const symptomSeries = useMemo(() => {
    if (!b) return [];
    return [...b.checkIns].reverse().map((r: Row) => ({
      d: shortDate(r.created_at), pain: num(r.pain_level), sleep: num(r.sleep_quality),
      stress: num(r.stress_level), energy: num(r.energy_level),
    }));
  }, [b]);
  const riskSeries = useMemo(() => {
    if (!b) return [];
    return [...b.riskScores].reverse().map((r: Row) => ({ d: shortDate(r.score_date), score: num(r.risk_score) }));
  }, [b]);
  const crossSeries = useMemo(() => {
    if (!b) return [];
    return [...b.loadInsight.crossCheck.days].reverse().map((x) => ({ d: shortDate(x.date), load: x.load, pain: x.pain }));
  }, [b]);
  const vitals = useMemo(() => {
    const mk = (field: string) => (b ? [...b.wearableSessions].reverse().map((r: Row) => ({ d: shortDate(r.date), v: num(r[field]) })).filter((p) => p.v !== null) : []);
    return { hrv: mk("hrv_avg"), rhr: mk("resting_hr"), sleep: mk("sleep_score"), steps: mk("total_steps") };
  }, [b]);
  const driverBars = useMemo(() => {
    if (!b) return [];
    return b.loadInsight.drivers.all.map((d) => ({ name: d.label, severity: d.severity }));
  }, [b]);
  const predictorBars = useMemo(() => {
    if (!b) return [];
    return b.correlation.predictors.map((p) => ({ name: `${p.label} (+${p.bestLag}d)`, r: p.r, abs: Math.abs(p.r), dir: p.direction }));
  }, [b]);
  const historySeries = useMemo(() => (b ? b.insightHistory.map((h) => ({ d: shortDate(h.date), acwr: h.acwr, fatigue: h.fatigue })) : []), [b]);

  return (
    <div style={{ padding: "20px 16px 24px" }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={h1}>Data Hub</h1>
        <p style={{ color: "var(--white-muted)", fontSize: 13, margin: "4px 0 0" }}>
          Visual profile of any client's symptom, physical and wearable data.
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <label style={{ color: "var(--white-muted)", fontSize: 12, fontWeight: 600 }}>Client</label>
        <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={loadingList} style={selectStyle}>
          <option value="">{loadingList ? "Loading clients…" : `Select a client (${clients.length})`}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.full_name}{c.practitioner_name ? ` · ${c.practitioner_name}` : ""}</option>
          ))}
        </select>
        {loadingBundle && <span style={{ color: "var(--white-muted)", fontSize: 12 }}>Loading…</span>}
      </div>

      {err && <div style={{ ...card, borderColor: "var(--red)", color: "var(--red)" }}>{err}</div>}
      {!selected && !err && <div style={{ ...card, color: "var(--white-muted)" }}>Choose a client above to see their visual data profile.</div>}

      {b && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Section visibility filter */}
          <div style={{ ...card, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={fieldLabel}>Show / hide sections</span>
              <button
                onClick={showAll}
                style={{ background: "transparent", border: "1px solid var(--navy-border)", color: "var(--white-muted)", borderRadius: 999, padding: "4px 10px", fontSize: 11, cursor: "pointer" }}
              >
                Show all
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SECTIONS.map((s) => {
                const on = visible[s.key];
                return (
                  <button
                    key={s.key}
                    onClick={() => toggle(s.key)}
                    style={{
                      ...pill,
                      cursor: "pointer",
                      border: `1px solid ${on ? "var(--blue-cold)" : "var(--navy-border)"}`,
                      background: on ? "rgba(74,141,240,0.18)" : "transparent",
                      color: on ? "var(--white)" : "var(--white-muted)",
                    }}
                    aria-pressed={on}
                  >
                    {on ? "✓ " : ""}{s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Overview */}
          {visible.overview && (

          <section style={card}>
            <div style={sectionTitle}>Overview</div>
            <div style={grid}>
              <Field label="Name" value={b.client.full_name} />
              <Field label="Practitioner" value={s(b.client.practitioner_name)} />
              <Field label="Primary complaint" value={s(b.client.primary_complaint)} />
              <Field label="Check-in frequency" value={s(b.client.check_in_frequency)} />
              <Field label="Program status" value={s(b.client.program_status)} />
              <Field label="Joined" value={shortDate(b.client.created_at)} />
              <Field label="Yves / AI consent" value={`${b.client.yves_enabled ? "on" : "off"} / ${b.client.yves_ai_consent ? "yes" : "no"}`} />
              <Field label="Passive monitoring" value={b.client.passive_monitoring_enabled ? "on" : "off"} />
            </div>
          </section>
          )}

          {/* Symptom trend */}
          {visible.symptoms && (
          <ChartCard title="Symptom & wellbeing trend" subtitle="Daily check-ins" empty={symptomSeries.length < 2 ? "Not enough check-ins yet to chart a trend." : null}>

            <ChartBox height={240}>
              <LineChart data={symptomSeries} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                <XAxis dataKey="d" stroke={C.muted} fontSize={10} minTickGap={18} />
                <YAxis domain={[0, 10]} stroke={C.muted} fontSize={10} />
                <Tooltip contentStyle={tip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="pain" name="Pain" stroke={C.red} strokeWidth={2.5} dot={false} connectNulls />
                <Line type="monotone" dataKey="sleep" name="Sleep" stroke={C.green} strokeWidth={1.5} dot={false} connectNulls />
                <Line type="monotone" dataKey="stress" name="Stress" stroke={C.amber} strokeWidth={1.5} dot={false} connectNulls />
                <Line type="monotone" dataKey="energy" name="Energy" stroke={C.blue} strokeWidth={1.5} dot={false} connectNulls />
              </LineChart>
            </ChartBox>
          </ChartCard>
          )}

          {/* Risk trend */}
          {visible.risk && (
          <ChartCard title="Predictive risk score" subtitle="0–100, higher = more concern" empty={riskSeries.length < 2 ? "No risk history yet (needs a wearable baseline + a few check-ins)." : null}>

            <ChartBox height={200}>
              <AreaChart data={riskSeries} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
                <defs><linearGradient id="riskG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.blue} stopOpacity={0.5} /><stop offset="100%" stopColor={C.blue} stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                <XAxis dataKey="d" stroke={C.muted} fontSize={10} minTickGap={18} />
                <YAxis domain={[0, 100]} stroke={C.muted} fontSize={10} />
                <Tooltip contentStyle={tip} />
                <Area type="monotone" dataKey="score" name="Risk" stroke={C.blue} strokeWidth={2} fill="url(#riskG)" connectNulls />
              </AreaChart>
            </ChartBox>
          </ChartCard>
          )}

          {/* Wearable connection */}
          {visible.wearable && (
          <section style={card}>
            <div style={sectionTitle}>Wearable connection</div>

            {b.wearables.length === 0 ? (
              <div style={muted}>No wearable connected.</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {b.wearables.map((w) => (
                  <span key={w.provider} style={{ ...pill, textTransform: "capitalize",
                    background: w.connected ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.06)",
                    color: w.connected ? "var(--green)" : "var(--white-muted)" }}>
                    {w.provider} · {w.connected ? "connected" : s(w.status)}
                  </span>
                ))}
              </div>
            )}
          </section>
          )}

          {/* Training load & injury-risk — only when a wearable is connected */}
          {visible.load && b.wearables.some((w) => w.connected) && (

            <section style={card}>
              <div style={sectionTitle}>
                Training load & injury-risk cross-check
                <span style={{ ...pill, background: "rgba(255,255,255,0.06)", color: "var(--white-muted)" }}>
                  {b.loadInsight.maturity.level} · {b.loadInsight.maturity.dataDays}d
                </span>
              </div>
              {!b.loadInsight.available ? (
                <div style={muted}>Not applicable — {b.loadInsight.reason}</div>
              ) : (
                <>
                  {/* Gauges */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 14, justifyContent: "flex-start" }}>
                    <Gauge label="ACWR" value={b.loadInsight.metrics.acwr} display={b.loadInsight.metrics.acwr === null ? "—" : b.loadInsight.metrics.acwr.toFixed(2)}
                      pct={b.loadInsight.metrics.acwr === null ? 0 : Math.min(b.loadInsight.metrics.acwr / 2, 1) * 100}
                      color={acwrColor(b.loadInsight.metrics.acwr)} note={b.loadInsight.metrics.acwr === null ? "building" : "sweet spot 0.8–1.3"} />
                    <Gauge label="Fatigue" value={b.loadInsight.metrics.fatigueIndex} display={s(b.loadInsight.metrics.fatigueIndex)}
                      pct={b.loadInsight.metrics.fatigueIndex ?? 0} color={bandHigh(b.loadInsight.metrics.fatigueIndex, 80, 70, 50)} note="0–100" />
                    <Gauge label="HRV drop" value={b.loadInsight.metrics.hrvDeviationPct} display={b.loadInsight.metrics.hrvDeviationPct === null ? "—" : `${b.loadInsight.metrics.hrvDeviationPct}%`}
                      pct={b.loadInsight.metrics.hrvDeviationPct === null ? 0 : Math.max(0, Math.min(b.loadInsight.metrics.hrvDeviationPct, 100))}
                      color={bandHigh(b.loadInsight.metrics.hrvDeviationPct, 30, 20, 10)} note="vs baseline" />
                    <Gauge label="Sleep" value={b.loadInsight.metrics.recentSleepScore} display={s(b.loadInsight.metrics.recentSleepScore)}
                      pct={b.loadInsight.metrics.recentSleepScore ?? 0} color={bandLow(b.loadInsight.metrics.recentSleepScore, 50, 60, 70)} note="7-day avg" />
                    <Gauge label="Monotony" value={b.loadInsight.metrics.monotony} display={b.loadInsight.metrics.monotony === null ? "—" : String(b.loadInsight.metrics.monotony)}
                      pct={b.loadInsight.metrics.monotony === null ? 0 : Math.min(b.loadInsight.metrics.monotony / 2.5, 1) * 100}
                      color={bandHigh(b.loadInsight.metrics.monotony, 2.5, 2.0, 1.5)} note={b.loadInsight.metrics.monotony === null ? "building" : "≥2 elevated"} />
                  </div>
                  {b.loadInsight.metrics.acwr === null && (
                    <div style={{ ...muted, marginTop: 8 }}>Load ratios need 14+ days of wearable history — showing what is available so far.</div>
                  )}

                  {/* Risk drivers */}
                  {driverBars.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ ...fieldLabel, marginBottom: 6 }}>What is driving the risk</div>
                      <ChartBox height={Math.max(90, driverBars.length * 34)}>
                        <BarChart data={driverBars} layout="vertical" margin={{ top: 0, right: 16, left: 10, bottom: 0 }}>
                          <XAxis type="number" domain={[0, 100]} stroke={C.muted} fontSize={10} />
                          <YAxis type="category" dataKey="name" stroke={C.muted} fontSize={10} width={140} />
                          <Tooltip contentStyle={tip} />
                          <Bar dataKey="severity" radius={[0, 4, 4, 0]}>
                            {driverBars.map((d, i) => (<Cell key={i} fill={d.severity >= 90 ? C.red : d.severity >= 65 ? C.amber : C.blue} />))}
                          </Bar>
                        </BarChart>
                      </ChartBox>
                    </div>
                  )}

                  {/* Cross-check: load vs pain */}
                  <div style={{ marginTop: 14 }}>
                    <div style={{ ...fieldLabel, marginBottom: 6 }}>Symptoms vs training load (last 14 days)</div>
                    {b.loadInsight.crossCheck.observation && (
                      <div style={{ color: "var(--amber)", fontSize: 13, marginBottom: 6 }}>⚠ {b.loadInsight.crossCheck.observation}</div>
                    )}
                    <ChartBox height={220}>
                      <ComposedChart data={crossSeries} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                        <XAxis dataKey="d" stroke={C.muted} fontSize={10} minTickGap={14} />
                        <YAxis yAxisId="l" stroke={C.muted} fontSize={10} />
                        <YAxis yAxisId="r" orientation="right" domain={[0, 10]} stroke={C.muted} fontSize={10} />
                        <Tooltip contentStyle={tip} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar yAxisId="l" dataKey="load" name="Training load" fill={C.blue} radius={[3, 3, 0, 0]} maxBarSize={22} />
                        <Line yAxisId="r" type="monotone" dataKey="pain" name="Pain" stroke={C.red} strokeWidth={2.5} dot={{ r: 2 }} connectNulls />
                      </ComposedChart>
                    </ChartBox>
                  </div>
                </>
              )}
            </section>
          )}

          {/* Load history (persisted daily snapshots) */}
          {visible.history && b.wearables.some((w) => w.connected) && historySeries.length >= 2 && (

            <ChartCard title="Load & fatigue history" subtitle="from daily snapshots" empty={null}>
              <ChartBox height={200}>
                <LineChart data={historySeries} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={C.border} strokeDasharray="3 3" />
                  <XAxis dataKey="d" stroke={C.muted} fontSize={10} minTickGap={18} />
                  <YAxis yAxisId="f" domain={[0, 100]} stroke={C.muted} fontSize={10} />
                  <YAxis yAxisId="a" orientation="right" domain={[0, 2]} stroke={C.muted} fontSize={10} />
                  <Tooltip contentStyle={tip} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="f" type="monotone" dataKey="fatigue" name="Fatigue" stroke={C.amber} strokeWidth={2} dot={false} connectNulls />
                  <Line yAxisId="a" type="monotone" dataKey="acwr" name="ACWR" stroke={C.blue} strokeWidth={2} dot={false} connectNulls />
                </LineChart>
              </ChartBox>
            </ChartCard>
          )}

          {/* Symptom predictors — per-client cross-reference (experimental) */}
          {visible.predictors && b.wearables.some((w) => w.connected) && (

            <section style={card}>
              <div style={sectionTitle}>
                Symptom predictors
                <span style={countS}>experimental · which health metrics track this client's pain</span>
              </div>
              {!b.correlation.available ? (
                <div style={muted}>Not applicable — {b.correlation.reason}</div>
              ) : (
                <>
                  {b.correlation.headline && (
                    <div style={{ color: "var(--white)", fontSize: 14, marginBottom: 10 }}>{b.correlation.headline}</div>
                  )}
                  <ChartBox height={Math.max(90, predictorBars.length * 34)}>
                    <BarChart data={predictorBars} layout="vertical" margin={{ top: 0, right: 16, left: 10, bottom: 0 }}>
                      <XAxis type="number" domain={[-1, 1]} stroke={C.muted} fontSize={10} ticks={[-1, -0.5, 0, 0.5, 1]} />
                      <YAxis type="category" dataKey="name" stroke={C.muted} fontSize={10} width={150} />
                      <Tooltip contentStyle={tip} formatter={(v) => [v as number, "correlation r"]} />
                      <Bar dataKey="r" radius={[3, 3, 3, 3]}>
                        {predictorBars.map((p, i) => (<Cell key={i} fill={p.dir === "worse" ? C.red : C.green} />))}
                      </Bar>
                    </BarChart>
                  </ChartBox>
                  <div style={{ ...muted, fontSize: 11, marginTop: 6 }}>
                    Red = higher metric tracks with more pain · green = with less pain. Positive lag means pain follows the metric by that many days. Association only, not proof of cause — for accuracy testing.
                  </div>
                </>
              )}
            </section>
          )}

          {/* Rhythms & patterns */}
          {b.wearables.some((w) => w.connected) && (
            <section style={card}>
              <div style={sectionTitle}>Rhythms & patterns</div>
              {b.rhythms.notes.length === 0 && b.rhythms.sleepWeekday === null && b.rhythms.hrvTrend.direction === "unknown" ? (
                <div style={muted}>Not applicable — not enough wearable history to detect rhythms yet.</div>
              ) : (
                <>
                  {b.rhythms.notes.length > 0 && (
                    <ul style={{ margin: "0 0 12px", paddingLeft: 18, color: "var(--white)", fontSize: 13 }}>
                      {b.rhythms.notes.map((nte, i) => (<li key={i} style={{ marginBottom: 4 }}>{nte}</li>))}
                    </ul>
                  )}
                  <div style={grid}>
                    <Field label="Sleep · weekday" value={s(b.rhythms.sleepWeekday)} />
                    <Field label="Sleep · weekend" value={s(b.rhythms.sleepWeekend)} />
                    <Field label="HRV trend (14d)" value={b.rhythms.hrvTrend.direction} />
                    <Field label="Resting HR trend" value={b.rhythms.rhrTrend.direction} />
                    <Field label="Active days / week" value={s(b.rhythms.trainingConsistency.daysActivePerWeek)} />
                    <Field label="Load week-on-week" value={b.rhythms.trainingConsistency.weekOverWeekChangePct === null ? "—" : `${b.rhythms.trainingConsistency.weekOverWeekChangePct}%`} />
                  </div>
                </>
              )}
            </section>
          )}

          {/* Physical vitals mini-charts — only when a wearable is connected */}
          {b.wearables.some((w) => w.connected) && (
            <section style={card}>
              <div style={sectionTitle}>Physical vitals</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <VitalChart title="HRV" data={vitals.hrv} color={C.blue} />
                <VitalChart title="Resting HR" data={vitals.rhr} color={C.red} />
                <VitalChart title="Sleep score" data={vitals.sleep} color={C.green} />
                <VitalChart title="Steps" data={vitals.steps} color={C.amber} />
              </div>
            </section>
          )}

          {/* Detected patterns */}
          {b.patterns.length > 0 && (
            <section style={card}>
              <div style={sectionTitle}>Detected patterns</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {b.patterns.map((p: Row, i) => (
                  <div key={i} style={listRow}>
                    <span style={{ color: "var(--white)" }}>{s(p.metric)} · {s(p.pattern_type)}</span>
                    <span style={{ color: "var(--white-muted)", fontSize: 12 }}>avg {s(p.avg_value)} · conf {s(p.confidence)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Yves queries */}
          <section style={card}>
            <div style={sectionTitle}>Yves symptom queries <span style={countS}>({b.symptomQueries.length})</span></div>
            {b.symptomQueries.length === 0 ? <div style={muted}>No Yves queries.</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {b.symptomQueries.slice(0, 15).map((r: Row, i) => (
                  <div key={i} style={{ ...listRow, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: "var(--white)", fontSize: 14 }}>{s(r.query_text)}</span>
                      <span style={{ ...pill, color: urgencyColor(r.urgency), border: "1px solid var(--navy-border)", whiteSpace: "nowrap" }}>
                        {s(r.urgency)}{typeof r.severity === "number" ? ` · ${r.severity}/10` : ""}{r.red_flag_detected ? " · 🚩" : ""}
                      </span>
                    </div>
                    {r.ai_rationale ? <div style={{ color: "var(--white-muted)", fontSize: 12 }}>{s(r.ai_rationale)}</div> : null}
                    <div style={{ color: "var(--white-muted)", fontSize: 11 }}>{fmtDateTime(r.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Alerts */}
          <section style={card}>
            <div style={sectionTitle}>Alerts <span style={countS}>({b.alerts.length})</span></div>
            {b.alerts.length === 0 ? <div style={muted}>No alerts.</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {b.alerts.slice(0, 20).map((r: Row, i) => (
                  <div key={i} style={listRow}>
                    <span style={{ color: "var(--white)", fontSize: 13 }}>{s(r.message)}</span>
                    <span style={{ display: "flex", gap: 8, alignItems: "center", whiteSpace: "nowrap" }}>
                      <span style={{ color: urgencyColor(r.urgency), fontSize: 12, fontWeight: 600 }}>{s(r.urgency)}</span>
                      <span style={{ color: "var(--white-muted)", fontSize: 11 }}>{shortDate(r.created_at)}</span>
                      {r.is_read ? <span style={{ color: "var(--green)", fontSize: 11 }}>✓</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ── chart band-color helpers ──
function acwrColor(v: number | null): string {
  if (v === null) return C.muted;
  if (v >= 1.5) return C.red;
  if (v >= 1.3 || v < 0.8) return C.amber;
  return C.green;
}
function bandHigh(v: number | null, crit: number, elev: number, mod: number): string {
  if (v === null) return C.muted;
  if (v >= crit) return C.red;
  if (v >= elev) return C.amber;
  if (v >= mod) return C.blue;
  return C.green;
}
function bandLow(v: number | null, crit: number, elev: number, mod: number): string {
  if (v === null) return C.muted;
  if (v <= crit) return C.red;
  if (v <= elev) return C.amber;
  if (v <= mod) return C.blue;
  return C.green;
}

// ── presentational components ──
function ChartBox({ children, height }: { children: ReactNode; height: number }) {
  return <div style={{ width: "100%", height }}><ResponsiveContainer width="100%" height="100%">{children as any}</ResponsiveContainer></div>;
}
function ChartCard({ title, subtitle, empty, children }: { title: string; subtitle?: string; empty: string | null; children: ReactNode }) {
  return (
    <section style={card}>
      <div style={sectionTitle}>{title}{subtitle ? <span style={countS}>{subtitle}</span> : null}</div>
      {empty ? <div style={muted}>Not applicable — {empty}</div> : children}
    </section>
  );
}
function VitalChart({ title, data, color }: { title: string; data: { d: string; v: number | null }[]; color: string }) {
  const latest = data.length ? data[data.length - 1].v : null;
  return (
    <div style={{ background: "var(--navy)", border: "1px solid var(--navy-border)", borderRadius: 10, padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={fieldLabel}>{title}</span>
        <span style={{ color: "var(--white)", fontWeight: 700, fontSize: 15 }}>{latest === null ? "—" : latest}</span>
      </div>
      {data.length === 0 ? (
        <div style={{ ...muted, fontSize: 11, marginTop: 8, fontStyle: "italic" }}>
          Data cannot be displayed — not supported by this wearable.
        </div>
      ) : data.length < 2 ? (
        <div style={{ ...muted, fontSize: 11, marginTop: 8 }}>Only one reading so far — building history.</div>
      ) : (
        <div style={{ width: "100%", height: 90, marginTop: 6 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="d" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Tooltip contentStyle={tip} />
              <Line type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
function Gauge({ label, value, display, pct, color, note }: { label: string; value: number | null; display: string; pct: number; color: string; note?: string }) {
  const size = 92, stroke = 9, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const offset = c - (Math.min(Math.max(pct, 0), 100) / 100) * c;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 100 }}>
      <div style={{ position: "relative", width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--navy-border)" strokeWidth={stroke} fill="none" />
          <circle cx={size / 2} cy={size / 2} r={r} stroke={value === null ? "var(--navy-border)" : color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--white)", fontWeight: 700, fontSize: 18 }}>{display}</div>
      </div>
      <div style={{ color: "var(--white)", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      {note ? <div style={{ color: "var(--white-muted)", fontSize: 10 }}>{note}</div> : null}
    </div>
  );
}
function Field({ label, value }: { label: string; value: string }) {
  return (<div><div style={fieldLabel}>{label}</div><div style={{ color: "var(--white)", fontSize: 14 }}>{value}</div></div>);
}

// ── styles ──
const h1: CSSProperties = { color: "var(--white)", fontSize: 24, fontWeight: 700, margin: 0 };
const card: CSSProperties = { background: "var(--navy-card)", border: "1px solid var(--navy-border)", borderRadius: 12, padding: 16 };
const sectionTitle: CSSProperties = { fontWeight: 700, color: "var(--white)", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 };
const fieldLabel: CSSProperties = { color: "var(--white-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 };
const selectStyle: CSSProperties = { flex: "1 1 280px", maxWidth: 420, background: "var(--navy)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "10px 12px", color: "var(--white)", fontSize: 15 };
const listRow: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "var(--navy)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "10px 12px" };
const pill: CSSProperties = { fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999 };
const muted: CSSProperties = { color: "var(--white-muted)", fontSize: 13 };
const countS: CSSProperties = { color: "var(--white-muted)", fontWeight: 400, fontSize: 12 };
const tip: CSSProperties = { background: "var(--navy-card)", border: "1px solid var(--navy-border)", borderRadius: 8, color: "var(--white)", fontSize: 12 };
