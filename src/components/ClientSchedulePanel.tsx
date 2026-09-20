import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { Dumbbell, Plus, Trash2 } from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  deleteTrainingSession,
  getClientScheduleOverlay,
  getMyScheduleOverlay,
  upsertTrainingSession,
  type TrainingSession,
} from "@/lib/training-sessions.functions";
import {
  SESSION_TYPES,
  SESSION_TYPE_LABEL,
  type ScheduleCrossCheck,
  type SessionType,
} from "@/lib/schedule-cross-check";
import { TRAINING_SCHEDULE_CROSSCHECK } from "@/lib/feature-flags";

type Mode = "practitioner" | "client";

function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const TYPE_COLOR: Record<SessionType, string> = {
  hard: "#f87171",
  competition: "#fb7185",
  moderate: "#fbbf24",
  recovery: "#34d399",
  rest: "#94a3b8",
  other: "#4a8df0",
};

/**
 * Practitioner: log training sessions + overlay check-in symptoms.
 * Client: read-only overlay of the same data.
 * Health data stays in Buddy — this view never leaves the app.
 */
export function ClientSchedulePanel({ clientId, mode }: { clientId?: string; mode: Mode }) {
  const [enabled, setEnabled] = useState(TRAINING_SCHEDULE_CROSSCHECK);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [cross, setCross] = useState<ScheduleCrossCheck | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [sessionDate, setSessionDate] = useState(todayYmd());
  const [sessionType, setSessionType] = useState<SessionType>("moderate");
  const [title, setTitle] = useState("");
  const [intensity, setIntensity] = useState("");
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [showLoad, setShowLoad] = useState(false);

  const load = async () => {
    try {
      const overlay =
        mode === "client"
          ? await getMyScheduleOverlay()
          : await getClientScheduleOverlay({ data: { clientId: clientId! } });
      setEnabled(overlay.enabled);
      setSessions(overlay.sessions);
      setCross(overlay.crossCheck);
      setShowLoad(overlay.crossCheck.days.some((d) => d.wearableLoad !== null));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load training schedule");
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    if (!TRAINING_SCHEDULE_CROSSCHECK) {
      setLoaded(true);
      setEnabled(false);
      return;
    }
    if (mode === "practitioner" && !clientId) return;
    void load();
  }, [clientId, mode]);

  const chartRows = useMemo(() => {
    if (!cross) return [];
    return cross.days.map((d) => ({
      d: new Date(d.date + "T12:00:00").toLocaleDateString(undefined, {
        month: "numeric",
        day: "numeric",
      }),
      pain: d.pain,
      intensity: d.intensity,
      load: d.wearableLoad,
      type: d.sessionType ? SESSION_TYPE_LABEL[d.sessionType] : "",
    }));
  }, [cross]);

  const hasWearable = !!cross?.days.some((d) => d.wearableLoad !== null);

  const save = async () => {
    if (!clientId) return;
    setSaving(true);
    setErr(null);
    try {
      await upsertTrainingSession({
        data: {
          clientId,
          sessionDate,
          sessionType,
          title: title.trim(),
          intensity: intensity ? Number(intensity) : null,
          durationMinutes: duration ? Number(duration) : null,
          notes: notes.trim(),
        },
      });
      setTitle("");
      setIntensity("");
      setDuration("");
      setNotes("");
      setFormOpen(false);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save session");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!clientId) return;
    setErr(null);
    try {
      await deleteTrainingSession({ data: { id, clientId } });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not delete session");
    }
  };

  if (!loaded || !enabled) return null;

  const empty = sessions.length === 0 && (cross?.summary.overlapDays ?? 0) === 0;

  return (
    <section style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Dumbbell size={17} color="var(--blue-accent)" aria-hidden />
        <span style={eyebrow}>Symptoms × training</span>
      </div>
      <p style={sub}>
        {mode === "practitioner"
          ? "Log hard sessions, recovery and rest days, then see whether check-in scores spike around them. Wearable load is optional overlay — schedule is the source of truth."
          : "How your check-ins line up with the sessions your practitioner logged."}
      </p>

      {cross && cross.observations.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {cross.observations.map((o, i) => (
            <div key={i} style={obs}>
              {o}
            </div>
          ))}
        </div>
      )}

      {cross && cross.summary.overlapDays > 0 && (
        <div style={statRow}>
          <Stat label="Pain on hard" value={cross.summary.avgPainOnHard} />
          <Stat label="On recovery" value={cross.summary.avgPainOnRecovery} />
          <Stat label="On rest" value={cross.summary.avgPainOnRest} />
        </div>
      )}

      {chartRows.some((r) => r.pain !== null || r.intensity !== null) && (
        <div style={{ marginTop: 14, height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartRows} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="var(--navy-border)" strokeDasharray="3 3" />
              <XAxis dataKey="d" stroke="var(--white-muted)" fontSize={10} minTickGap={14} />
              <YAxis yAxisId="l" domain={[0, 10]} stroke="var(--white-muted)" fontSize={10} />
              {showLoad && hasWearable && (
                <YAxis yAxisId="r" orientation="right" stroke="var(--white-muted)" fontSize={10} />
              )}
              <Tooltip
                contentStyle={{
                  background: "var(--navy-card)",
                  border: "1px solid var(--navy-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                yAxisId="l"
                dataKey="intensity"
                name="Session intensity"
                fill="var(--blue-accent)"
                radius={[3, 3, 0, 0]}
                maxBarSize={18}
              />
              <Line
                yAxisId="l"
                type="monotone"
                dataKey="pain"
                name="Pain"
                stroke="#f87171"
                strokeWidth={2.5}
                dot={{ r: 2 }}
                connectNulls
              />
              {showLoad && hasWearable && (
                <Line
                  yAxisId="r"
                  type="monotone"
                  dataKey="load"
                  name="Wearable load"
                  stroke="#34d399"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {hasWearable && (
        <label style={{ ...sub, display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <input
            type="checkbox"
            checked={showLoad}
            onChange={(e) => setShowLoad(e.target.checked)}
            style={{ accentColor: "var(--blue-accent)" }}
          />
          Overlay wearable training load (when synced)
        </label>
      )}

      {mode === "practitioner" && (
        <>
          {!formOpen ? (
            <button type="button" onClick={() => setFormOpen(true)} style={addBtn}>
              <Plus size={16} />
              Add session
            </button>
          ) : (
            <div style={formBox}>
              <input
                type="date"
                style={inp}
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
              />
              <select
                style={inp}
                value={sessionType}
                onChange={(e) => setSessionType(e.target.value as SessionType)}
              >
                {SESSION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SESSION_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <input
                style={inp}
                placeholder="Title (optional) — e.g. Intervals"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <input
                  style={inp}
                  inputMode="numeric"
                  placeholder="Intensity 1–10"
                  value={intensity}
                  onChange={(e) => setIntensity(e.target.value.replace(/[^\d]/g, ""))}
                />
                <input
                  style={inp}
                  inputMode="numeric"
                  placeholder="Minutes"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value.replace(/[^\d]/g, ""))}
                />
              </div>
              <textarea
                style={{ ...inp, minHeight: 56, resize: "vertical" }}
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" onClick={save} disabled={saving} style={primaryBtn}>
                  {saving ? "Saving…" : "Save session"}
                </button>
                <button type="button" onClick={() => setFormOpen(false)} style={ghostBtn}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {err && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>{err}</div>}

      {sessions.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {sessions.slice(0, 12).map((s) => (
            <div key={s.id} style={row}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "var(--white)", fontFamily: "var(--font-ui)", fontSize: 13 }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: 99,
                      background: TYPE_COLOR[s.session_type] ?? "var(--blue-accent)",
                      marginRight: 8,
                    }}
                  />
                  {SESSION_TYPE_LABEL[s.session_type]}
                  {s.title ? ` · ${s.title}` : ""}
                </div>
                <div
                  style={{
                    color: "var(--white-muted)",
                    fontFamily: "var(--font-data)",
                    fontSize: 11,
                  }}
                >
                  {s.session_date}
                  {s.intensity != null ? ` · intensity ${s.intensity}` : ""}
                  {s.duration_minutes != null ? ` · ${s.duration_minutes} min` : ""}
                </div>
              </div>
              {mode === "practitioner" && (
                <button
                  type="button"
                  onClick={() => void remove(s.id)}
                  style={iconBtn}
                  aria-label="Delete session"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {empty && mode === "practitioner" && !formOpen && (
        <p style={{ ...sub, marginTop: 10 }}>
          No sessions yet. Add a hard session, recovery day or rest day to start the overlay.
        </p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div style={statCell}>
      <div
        style={{
          color: "var(--white)",
          fontFamily: "var(--font-data)",
          fontWeight: 700,
          fontSize: 16,
        }}
      >
        {value == null ? "—" : value}
      </div>
      <div
        style={{
          color: "var(--white-muted)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
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
const obs: CSSProperties = {
  background: "rgba(251,191,36,0.08)",
  border: "1px solid rgba(251,191,36,0.28)",
  borderRadius: 10,
  padding: "10px 12px",
  color: "var(--white)",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  lineHeight: 1.45,
};
const statRow: CSSProperties = {
  marginTop: 12,
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 6,
};
const statCell: CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--navy-border)",
  borderRadius: 10,
  padding: "10px 8px",
  textAlign: "center",
};
const addBtn: CSSProperties = {
  marginTop: 12,
  minHeight: 42,
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  background: "var(--blue-accent)",
  color: "var(--white)",
  border: "none",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};
const formBox: CSSProperties = {
  marginTop: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const inp: CSSProperties = {
  width: "100%",
  background: "var(--navy)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  padding: "10px 12px",
  color: "var(--white)",
  fontFamily: "var(--font-ui)",
  fontSize: 15,
};
const primaryBtn: CSSProperties = {
  flex: 1,
  minHeight: 42,
  background: "var(--blue-accent)",
  color: "var(--white)",
  border: "none",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};
const ghostBtn: CSSProperties = {
  minHeight: 42,
  padding: "0 14px",
  background: "transparent",
  color: "var(--white-muted)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  cursor: "pointer",
};
const iconBtn: CSSProperties = {
  width: 34,
  height: 34,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  color: "var(--white-muted)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  cursor: "pointer",
};
const row: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--navy-border)",
  borderRadius: 10,
  padding: "10px 12px",
};
