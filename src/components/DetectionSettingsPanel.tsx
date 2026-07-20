import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getDetectionSettings, updateDetectionThresholds, updateAlertingSettings,
  runThresholdCalibration, runEscalationSweep, type DetectionSettings,
} from "@/lib/detection.functions";
import type { Thresholds } from "@/lib/load-metrics";
import type { CalibrationReport } from "@/lib/calibration";

const NUM = (v: string, fb: number) => { const n = parseFloat(v); return isNaN(n) ? fb : n; };

export function DetectionSettingsPanel() {
  const [st, setSt] = useState<DetectionSettings | null>(null);
  const [th, setTh] = useState<Thresholds | null>(null);
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useServerFn(getDetectionSettings);
  const saveTh = useServerFn(updateDetectionThresholds);
  const saveAlert = useServerFn(updateAlertingSettings);
  const runCal = useServerFn(runThresholdCalibration);
  const runEsc = useServerFn(runEscalationSweep);

  useEffect(() => {
    (async () => {
      try { const d = await load(); setSt(d); setTh(d.thresholds); setReport(d.suggestions ?? null); }
      catch { /* not super admin / not ready */ }
    })();
  }, [load]);

  if (!st || !th) return null;

  const edit = (metric: keyof Thresholds, key: string, v: number) =>
    setTh({ ...th, [metric]: { ...th[metric], [key]: v } });

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 2500); };

  const saveThresholds = async () => {
    setBusy("th"); try { await saveTh({ data: th }); flash("Thresholds saved."); } catch (e) { flash(e instanceof Error ? e.message : "Save failed"); } finally { setBusy(null); }
  };
  const saveAlerting = async (patch: Record<string, unknown>) => {
    setBusy("al"); try { await saveAlert({ data: patch }); setSt({ ...st, ...mapPatch(st, patch) }); flash("Saved."); } catch (e) { flash(e instanceof Error ? e.message : "Save failed"); } finally { setBusy(null); }
  };
  const calibrate = async () => { setBusy("cal"); try { const r = await runCal(); setReport(r); flash("Calibration updated."); } catch (e) { flash(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); } };
  const escalate = async () => { setBusy("esc"); try { const r = await runEsc(); flash(r.skipped ? "Escalation is off — nothing sent." : `Escalated ${r.escalated} alert(s).`); } catch (e) { flash(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); } };

  const pairs: [keyof Thresholds, string][] = [["acwr", "ACWR"], ["monotony", "Monotony"], ["strain", "Strain"], ["fatigue", "Fatigue"], ["hrv", "HRV drop %"], ["sleep", "Sleep (low)"]];

  return (
    <section style={{ marginTop: 32 }}>
      <div style={title}>Detection & alerting</div>
      <p style={sub}>Tune the load/injury thresholds used on the Data Hub, review calibration from practitioner feedback, and control escalation. These do not change the client app.</p>

      {/* Thresholds */}
      <div style={card}>
        <div style={cardTitle}>Thresholds (elevated / critical)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          {pairs.map(([m, label]) => (
            <div key={m}>
              <div style={lbl}>{label}</div>
              <div style={{ display: "flex", gap: 6 }}>
                <input style={inp} type="number" step="0.1" value={(th[m] as Record<string, number>).elevated} onChange={(e) => edit(m, "elevated", NUM(e.target.value, (th[m] as Record<string, number>).elevated))} />
                <input style={inp} type="number" step="0.1" value={(th[m] as Record<string, number>).critical} onChange={(e) => edit(m, "critical", NUM(e.target.value, (th[m] as Record<string, number>).critical))} />
              </div>
            </div>
          ))}
        </div>
        <button style={primary} disabled={busy === "th"} onClick={saveThresholds}>{busy === "th" ? "Saving…" : "Save thresholds"}</button>
      </div>

      {/* Calibration / learning loop */}
      <div style={card}>
        <div style={cardTitle}>Calibration from practitioner feedback</div>
        <p style={sub}>Reads confirmed / false-alarm outcomes on alerts and reports per-category precision, so you can see which way to tune. Applying a change stays your decision.</p>
        <button style={ghost} disabled={busy === "cal"} onClick={calibrate}>{busy === "cal" ? "Running…" : "Run calibration now"}</button>
        {st.calibratedAt && <span style={{ ...muted, marginLeft: 10 }}>last run {new Date(st.calibratedAt).toLocaleString()}</span>}
        {report && report.categories.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {report.categories.map((c) => (
              <div key={c.category} style={row}>
                <span style={{ color: "var(--white)", textTransform: "capitalize" }}>{c.category}</span>
                <span style={{ color: "var(--white-muted)", fontSize: 12 }}>
                  {c.confirmed}/{c.n} real · {(c.precision * 100).toFixed(0)}% · <b style={{ color: c.suggestion === "raise" ? "var(--red)" : c.suggestion === "lower" ? "var(--green)" : "var(--white-muted)" }}>{c.suggestion}</b>
                </span>
              </div>
            ))}
          </div>
        )}
        {report && report.categories.length === 0 && <div style={{ ...muted, marginTop: 8 }}>No graded alerts yet.</div>}
      </div>

      {/* Escalation */}
      <div style={card}>
        <div style={cardTitle}>Escalation (off by default)</div>
        <label style={toggle}>
          <span style={{ color: "var(--white)" }}>Re-notify unacknowledged alerts</span>
          <input type="checkbox" checked={st.escalation.enabled} onChange={(e) => saveAlerting({ escalationEnabled: e.target.checked })} style={{ width: 22, height: 22, accentColor: "var(--blue-accent)" }} />
        </label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div><div style={lbl}>After (minutes)</div><input style={inp} type="number" defaultValue={st.escalation.afterMinutes} onBlur={(e) => saveAlerting({ escalationAfterMinutes: NUM(e.target.value, st.escalation.afterMinutes) })} /></div>
          <div><div style={lbl}>Min urgency</div>
            <select style={{ ...inp, minWidth: 120 }} value={st.escalation.minUrgency} onChange={(e) => saveAlerting({ escalationMinUrgency: e.target.value })}>
              {["soon", "urgent", "emergency"].map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <button style={ghost} disabled={busy === "esc"} onClick={escalate}>{busy === "esc" ? "Running…" : "Run escalation sweep now"}</button>
        <div style={muted}>While off, the sweep is a no-op — no practitioner is contacted.</div>
      </div>

      {msg && <div style={{ color: "var(--white-muted)", fontSize: 12, marginTop: 8 }}>{msg}</div>}
    </section>
  );
}

function mapPatch(st: DetectionSettings, patch: Record<string, unknown>): Partial<DetectionSettings> {
  const esc = { ...st.escalation };
  if (patch.escalationEnabled !== undefined) esc.enabled = patch.escalationEnabled as boolean;
  if (patch.escalationAfterMinutes !== undefined) esc.afterMinutes = patch.escalationAfterMinutes as number;
  if (patch.escalationMinUrgency !== undefined) esc.minUrgency = patch.escalationMinUrgency as string;
  return { escalation: esc, autoCalibrate: patch.autoCalibrate !== undefined ? (patch.autoCalibrate as boolean) : st.autoCalibrate };
}

const title: CSSProperties = { fontWeight: 700, color: "var(--white)", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em" };
const sub: CSSProperties = { color: "var(--white-muted)", fontSize: 12, marginTop: 4 };
const card: CSSProperties = { marginTop: 12, background: "var(--navy-card)", border: "1px solid var(--navy-border)", borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 10 };
const cardTitle: CSSProperties = { color: "var(--white)", fontWeight: 600, fontSize: 14 };
const lbl: CSSProperties = { color: "var(--white-muted)", fontSize: 11, marginBottom: 3 };
const inp: CSSProperties = { width: "100%", background: "var(--navy)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "8px 10px", color: "var(--white)", fontSize: 14 };
const primary: CSSProperties = { minHeight: 42, background: "var(--blue-accent)", color: "var(--white)", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: "pointer" };
const ghost: CSSProperties = { minHeight: 40, padding: "0 14px", background: "transparent", color: "var(--white)", border: "1px solid var(--navy-border)", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer" };
const toggle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--navy)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "10px 12px" };
const row: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--navy)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "8px 12px" };
const muted: CSSProperties = { color: "var(--white-muted)", fontSize: 12 };
