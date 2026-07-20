import { createFileRoute } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  listAllClientsForAdmin,
  getAdminClientBundle,
  type AdminClientListItem,
  type AdminClientBundle,
} from "@/lib/admin-data-hub.functions";
import { log } from "@/lib/log";

export const Route = createFileRoute("/admin/app/data-hub")({
  head: () => ({ meta: [{ title: "Data Hub — Buddy" }] }),
  component: AdminDataHub,
});

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));
const n = (v: unknown): string => (typeof v === "number" ? String(Math.round(v * 10) / 10) : "—");
function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-ZA", { year: "2-digit", month: "short", day: "numeric" });
}
function fmtDateTime(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" });
}
function sleepHours(v: unknown): string {
  if (typeof v !== "number" || v <= 0) return "—";
  const hrs = v > 1000 ? v / 3600 : v > 60 ? v / 60 : v; // seconds | minutes | hours
  return (Math.round(hrs * 10) / 10).toString();
}
function painColor(p: unknown): string {
  const v = typeof p === "number" ? p : NaN;
  if (isNaN(v)) return "var(--white-muted)";
  if (v <= 3) return "var(--green)";
  if (v <= 6) return "var(--amber)";
  return "var(--red)";
}
function acwrColor(v: number | null): string {
  if (v === null) return "var(--white-muted)";
  if (v >= 1.5) return "var(--red)";
  if (v >= 1.3) return "var(--amber)";
  if (v < 0.8) return "var(--amber)";
  return "var(--green)";
}
function severityColor(sev: number): string {
  if (sev >= 90) return "var(--red)";
  if (sev >= 65) return "var(--amber)";
  return "var(--blue-accent)";
}
function urgencyColor(u: unknown): string {
  switch (String(u)) {
    case "emergency": return "var(--red)";
    case "urgent": return "var(--red)";
    case "soon": return "var(--amber)";
    case "monitor": return "var(--blue-accent)";
    default: return "var(--white-muted)";
  }
}

function AdminDataHub() {
  const [clients, setClients] = useState<AdminClientListItem[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [bundle, setBundle] = useState<AdminClientBundle | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingBundle, setLoadingBundle] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const listFn = useServerFn(listAllClientsForAdmin);
  const bundleFn = useServerFn(getAdminClientBundle);

  useEffect(() => {
    (async () => {
      try {
        setClients(await listFn());
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load clients");
      } finally {
        setLoadingList(false);
      }
    })();
  }, [listFn]);

  useEffect(() => {
    if (!selected) { setBundle(null); return; }
    setLoadingBundle(true);
    setErr(null);
    (async () => {
      try {
        setBundle(await bundleFn({ data: { clientId: selected } }));
      } catch (e) {
        log.error(e);
        setErr(e instanceof Error ? e.message : "Failed to load client data");
        setBundle(null);
      } finally {
        setLoadingBundle(false);
      }
    })();
  }, [selected, bundleFn]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selected) ?? null,
    [clients, selected],
  );

  return (
    <div style={{ padding: "20px 16px 24px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
        <h1 style={h1}>Data Hub</h1>
        <p style={{ color: "var(--white-muted)", fontSize: 13, margin: 0 }}>
          One place to inspect any client's symptom, physical and wearable data.
        </p>
      </div>

      {/* Top-left client picker */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <label style={{ color: "var(--white-muted)", fontSize: 12, fontFamily: "var(--font-ui)", fontWeight: 600 }}>
          Client
        </label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={loadingList}
          style={selectStyle}
        >
          <option value="">{loadingList ? "Loading clients…" : `Select a client (${clients.length})`}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.full_name}{c.practitioner_name ? ` · ${c.practitioner_name}` : ""}
            </option>
          ))}
        </select>
        {loadingBundle && <span style={{ color: "var(--white-muted)", fontSize: 12 }}>Loading data…</span>}
      </div>

      {err && <div style={{ ...card, borderColor: "var(--red)", color: "var(--red)" }}>{err}</div>}

      {!selected && !err && (
        <div style={{ ...card, color: "var(--white-muted)", fontSize: 14 }}>
          Choose a client above to pull their full data profile.
        </div>
      )}

      {bundle && selectedClient && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Overview */}
          <section style={card}>
            <div style={sectionTitle}>Overview</div>
            <div style={grid2}>
              <Field label="Name" value={bundle.client.full_name} />
              <Field label="Practitioner" value={s(bundle.client.practitioner_name)} />
              <Field label="Email" value={s(bundle.client.email)} />
              <Field label="Phone" value={s(bundle.client.phone)} />
              <Field label="Primary complaint" value={s(bundle.client.primary_complaint)} />
              <Field label="Check-in frequency" value={s(bundle.client.check_in_frequency)} />
              <Field label="Timezone" value={s(bundle.client.timezone)} />
              <Field label="Program status" value={s(bundle.client.program_status)} />
              <Field label="Joined" value={fmtDate(bundle.client.created_at)} />
              <Field label="First login" value={fmtDate(bundle.client.first_login_at)} />
              <Field label="Yves enabled" value={bundle.client.yves_enabled ? "Yes" : "No"} />
              <Field label="AI consent" value={bundle.client.yves_ai_consent ? "Yes" : "No"} />
              <Field label="Passive monitoring" value={bundle.client.passive_monitoring_enabled ? "On" : "Off"} />
            </div>
            {bundle.client.notes && bundle.client.notes !== "—" && (
              <div style={{ marginTop: 10, color: "var(--white-muted)", fontSize: 13 }}>
                <span style={fieldLabel}>Notes</span> {bundle.client.notes}
              </div>
            )}
          </section>

          {/* Wearable connection */}
          <section style={card}>
            <div style={sectionTitle}>Wearable connection</div>
            {bundle.wearables.length === 0 ? (
              <div style={muted}>No wearable connected.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {bundle.wearables.map((w) => (
                  <div key={w.provider} style={listRow}>
                    <div style={{ textTransform: "capitalize", color: "var(--white)", fontWeight: 600 }}>{w.provider}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 12, color: "var(--white-muted)" }}>updated {fmtDate(w.updated_at)}</span>
                      <span style={{
                        ...pill,
                        background: w.connected ? "rgba(34,197,94,0.15)" : "rgba(255,255,255,0.06)",
                        color: w.connected ? "var(--green)" : "var(--white-muted)",
                      }}>{w.connected ? "Connected" : s(w.status)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Physical data — wearable sessions */}
          <section style={card}>
            <div style={sectionTitle}>Physical data · wearable sessions <Count n={bundle.wearableSessions.length} /></div>
            {bundle.wearableSessions.length === 0 ? (
              <div style={muted}>No wearable sessions recorded.</div>
            ) : (
              <ScrollTable head={["Date", "Source", "Rest HR", "HRV", "Sleep score", "Sleep (h)", "Steps", "Readiness", "Stress", "SpO2"]}>
                {bundle.wearableSessions.slice(0, 30).map((r: Row, i) => (
                  <tr key={i}>
                    <Td>{fmtDate(r.date)}</Td>
                    <Td>{s(r.source)}</Td>
                    <Td>{n(r.resting_hr)}</Td>
                    <Td>{n(r.hrv_avg)}</Td>
                    <Td>{n(r.sleep_score)}</Td>
                    <Td>{sleepHours(r.total_sleep_duration)}</Td>
                    <Td>{n(r.total_steps)}</Td>
                    <Td>{n(r.readiness_score)}</Td>
                    <Td>{n(r.stress_avg)}</Td>
                    <Td>{n(r.spo2_avg)}</Td>
                  </tr>
                ))}
              </ScrollTable>
            )}
          </section>

          {/* Risk + baseline + patterns */}
          <section style={card}>
            <div style={sectionTitle}>Risk & patterns</div>
            <div style={grid2}>
              <Field label="Latest risk score" value={bundle.riskScores[0] ? `${s((bundle.riskScores[0] as Row).risk_score)}/100 (${s((bundle.riskScores[0] as Row).trend)})` : "—"} />
              <Field label="Baseline sample size" value={bundle.baseline ? s(bundle.baseline.sample_size) : "—"} />
            </div>
            {bundle.riskScores.length > 0 && (
              <ScrollTable head={["Date", "Score", "Trend", "Summary"]}>
                {bundle.riskScores.slice(0, 20).map((r: Row, i) => (
                  <tr key={i}>
                    <Td>{fmtDate(r.score_date)}</Td>
                    <Td>{s(r.risk_score)}</Td>
                    <Td>{s(r.trend)}</Td>
                    <Td>{s(r.summary)}</Td>
                  </tr>
                ))}
              </ScrollTable>
            )}
            {bundle.patterns.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ ...fieldLabel, marginBottom: 6 }}>Detected patterns</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {bundle.patterns.map((p: Row, i) => (
                    <div key={i} style={listRow}>
                      <span style={{ color: "var(--white)" }}>{s(p.metric)} · {s(p.pattern_type)}</span>
                      <span style={{ color: "var(--white-muted)", fontSize: 12 }}>
                        avg {n(p.avg_value)} · conf {n(p.confidence)} · n={s(p.sample_size)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Training load & injury-risk cross-check — only when a wearable is connected */}
          {bundle.wearables.some((w) => w.connected) && (
            <section style={card}>
              <div style={sectionTitle}>
                Training load & injury-risk cross-check
                <span style={{ ...pill, background: "rgba(255,255,255,0.06)", color: "var(--white-muted)" }}>
                  {bundle.loadInsight.maturity.level} · {bundle.loadInsight.maturity.dataDays}d
                </span>
              </div>

              {!bundle.loadInsight.available ? (
                <div style={muted}>{bundle.loadInsight.reason}</div>
              ) : (
                <>
                  {/* Risk drivers */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12, alignItems: "center" }}>
                    <span style={{ ...pill, border: "1px solid var(--navy-border)", color: bundle.loadInsight.drivers.riskLevel === "high" ? "var(--red)" : bundle.loadInsight.drivers.riskLevel === "moderate" ? "var(--amber)" : "var(--green)" }}>
                      {bundle.loadInsight.drivers.riskLevel} risk
                    </span>
                    {bundle.loadInsight.drivers.primary && (
                      <span style={{ color: severityColor(bundle.loadInsight.drivers.primary.severity), fontSize: 13, fontWeight: 600 }}>
                        Primary: {bundle.loadInsight.drivers.primary.reason}
                      </span>
                    )}
                    {bundle.loadInsight.drivers.secondary && (
                      <span style={{ color: "var(--white-muted)", fontSize: 12 }}>
                        · then {bundle.loadInsight.drivers.secondary.reason}
                      </span>
                    )}
                    {!bundle.loadInsight.drivers.primary && (
                      <span style={{ color: "var(--white-muted)", fontSize: 13 }}>No elevated load drivers.</span>
                    )}
                  </div>

                  {/* Metrics */}
                  <div style={grid2}>
                    <Metric label="ACWR (7d:28d)" value={bundle.loadInsight.metrics.acwr === null ? "building" : String(bundle.loadInsight.metrics.acwr)} color={acwrColor(bundle.loadInsight.metrics.acwr)} hint="sweet spot 0.8–1.3 · danger ≥1.5" />
                    <Metric label="Acute / chronic load" value={`${s(bundle.loadInsight.metrics.acuteLoad)} / ${s(bundle.loadInsight.metrics.chronicLoad)}`} />
                    <Metric label="Monotony" value={bundle.loadInsight.metrics.monotony === null ? "building" : String(bundle.loadInsight.metrics.monotony)} hint="≥2.0 elevated" />
                    <Metric label="Weekly strain" value={s(bundle.loadInsight.metrics.strain)} hint="≥2500 elevated" />
                    <Metric label="Fatigue index" value={s(bundle.loadInsight.metrics.fatigueIndex)} hint="0–100" />
                    <Metric label="HRV vs baseline" value={bundle.loadInsight.metrics.hrvDeviationPct === null ? "—" : `${bundle.loadInsight.metrics.hrvDeviationPct}% down`} color={typeof bundle.loadInsight.metrics.hrvDeviationPct === "number" && bundle.loadInsight.metrics.hrvDeviationPct >= 20 ? "var(--amber)" : "var(--white)"} />
                    <Metric label="Sleep score (7d)" value={s(bundle.loadInsight.metrics.recentSleepScore)} />
                    <Metric label="Load source" value={String(bundle.loadInsight.loadMethod ?? "—").replace("_", " ")} />
                  </div>
                  {bundle.loadInsight.metrics.acwr === null && (
                    <div style={{ ...muted, marginTop: 8 }}>
                      Load ratios need 14+ days of wearable history before they are trustworthy — showing what is available so far.
                    </div>
                  )}

                  {/* Symptom vs training cross-check */}
                  <div style={{ marginTop: 14 }}>
                    <div style={{ ...fieldLabel, marginBottom: 6 }}>Symptom vs training (last 14 days)</div>
                    {bundle.loadInsight.crossCheck.observation && (
                      <div style={{ color: "var(--amber)", fontSize: 13, marginBottom: 8 }}>⚠ {bundle.loadInsight.crossCheck.observation}</div>
                    )}
                    <ScrollTable head={["Date", "Load", "Pain", "Flag"]}>
                      {bundle.loadInsight.crossCheck.days.map((d, i) => (
                        <tr key={i}>
                          <Td>{fmtDate(d.date)}</Td>
                          <Td>{d.load === null ? "—" : String(d.load)}</Td>
                          <Td><span style={{ color: painColor(d.pain), fontWeight: 700 }}>{d.pain === null ? "—" : String(d.pain)}</span></Td>
                          <Td>{d.flagged ? "🚩" : ""}</Td>
                        </tr>
                      ))}
                    </ScrollTable>
                  </div>
                </>
              )}
            </section>
          )}

          {/* Symptom data — check-ins */}
          <section style={card}>
            <div style={sectionTitle}>Symptom data · check-ins <Count n={bundle.checkIns.length} /></div>
            {bundle.checkIns.length === 0 ? (
              <div style={muted}>No check-ins yet.</div>
            ) : (
              <ScrollTable head={["When", "Pain", "Sleep", "Stress", "Energy", "Mood", "Flag", "Notes"]}>
                {bundle.checkIns.slice(0, 40).map((r: Row, i) => (
                  <tr key={i}>
                    <Td>{fmtDateTime(r.created_at)}</Td>
                    <Td><span style={{ color: painColor(r.pain_level), fontWeight: 700 }}>{s(r.pain_level)}</span></Td>
                    <Td>{s(r.sleep_quality)}</Td>
                    <Td>{s(r.stress_level)}</Td>
                    <Td>{s(r.energy_level)}</Td>
                    <Td>{s(r.mood)}</Td>
                    <Td>{r.flagged ? "🚩" : ""}</Td>
                    <Td>{s(r.notes)}</Td>
                  </tr>
                ))}
              </ScrollTable>
            )}
          </section>

          {/* Symptom data — Yves queries */}
          <section style={card}>
            <div style={sectionTitle}>Symptom data · Yves queries <Count n={bundle.symptomQueries.length} /></div>
            {bundle.symptomQueries.length === 0 ? (
              <div style={muted}>No Yves queries.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {bundle.symptomQueries.slice(0, 20).map((r: Row, i) => (
                  <div key={i} style={{ ...listItem, flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: "var(--white)", fontSize: 14 }}>{s(r.query_text)}</span>
                      <span style={{ ...pill, color: urgencyColor(r.urgency), border: "1px solid var(--navy-border)", whiteSpace: "nowrap" }}>
                        {s(r.urgency)}{typeof r.severity === "number" ? ` · ${r.severity}/10` : ""}{r.red_flag_detected ? " · 🚩" : ""}
                      </span>
                    </div>
                    {r.ai_rationale && <div style={{ color: "var(--white-muted)", fontSize: 12 }}>{s(r.ai_rationale)}</div>}
                    <div style={{ color: "var(--white-muted)", fontSize: 11 }}>{fmtDateTime(r.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Symptom data — alerts */}
          <section style={card}>
            <div style={sectionTitle}>Alerts <Count n={bundle.alerts.length} /></div>
            {bundle.alerts.length === 0 ? (
              <div style={muted}>No alerts.</div>
            ) : (
              <ScrollTable head={["When", "Type", "Urgency", "Read", "Message"]}>
                {bundle.alerts.slice(0, 25).map((r: Row, i) => (
                  <tr key={i}>
                    <Td>{fmtDateTime(r.created_at)}</Td>
                    <Td>{s(r.alert_type)}</Td>
                    <Td><span style={{ color: urgencyColor(r.urgency) }}>{s(r.urgency)}</span></Td>
                    <Td>{r.is_read ? "✓" : "—"}</Td>
                    <Td>{s(r.message)}</Td>
                  </tr>
                ))}
              </ScrollTable>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

// ── small presentational helpers ────────────────────────────────────────────
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={fieldLabel}>{label}</div>
      <div style={{ color: "var(--white)", fontSize: 14, fontFamily: "var(--font-ui)" }}>{value}</div>
    </div>
  );
}
function Metric({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div>
      <div style={fieldLabel}>{label}</div>
      <div style={{ color: color ?? "var(--white)", fontSize: 16, fontWeight: 700, fontFamily: "var(--font-ui)" }}>{value}</div>
      {hint && <div style={{ color: "var(--white-muted)", fontSize: 10 }}>{hint}</div>}
    </div>
  );
}
function Count({ n }: { n: number }) {
  return <span style={{ color: "var(--white-muted)", fontWeight: 400, fontSize: 12 }}>({n})</span>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ padding: "8px 10px", borderBottom: "1px solid var(--navy-border)", color: "var(--white)", fontSize: 12, whiteSpace: "nowrap", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{children}</td>;
}
function ScrollTable({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10, overflowX: "auto", maxHeight: 420, overflowY: "auto", border: "1px solid var(--navy-border)", borderRadius: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} style={{ position: "sticky", top: 0, background: "var(--navy-card)", padding: "8px 10px", textAlign: "left", color: "var(--white-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid var(--navy-border)", whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

// ── styles ──────────────────────────────────────────────────────────────────
const h1: CSSProperties = { fontFamily: "var(--font-display, var(--font-ui))", color: "var(--white)", fontSize: 24, fontWeight: 700, margin: 0 };
const card: CSSProperties = { background: "var(--navy-card)", border: "1px solid var(--navy-border)", borderRadius: 12, padding: 16 };
const sectionTitle: CSSProperties = { fontFamily: "var(--font-ui)", fontWeight: 700, color: "var(--white)", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, display: "flex", gap: 6, alignItems: "baseline" };
const grid2: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 };
const fieldLabel: CSSProperties = { color: "var(--white-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "var(--font-ui)", fontWeight: 600 };
const selectStyle: CSSProperties = { flex: "1 1 280px", maxWidth: 420, background: "var(--navy)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "10px 12px", color: "var(--white)", fontFamily: "var(--font-ui)", fontSize: 15 };
const listRow: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "var(--navy)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "10px 12px" };
const listItem: CSSProperties = { display: "flex", background: "var(--navy)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "10px 12px" };
const pill: CSSProperties = { fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999, letterSpacing: "0.04em" };
const muted: CSSProperties = { color: "var(--white-muted)", fontSize: 13 };
