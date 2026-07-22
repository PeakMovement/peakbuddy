import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getGradingMode,
  setGradingMode,
  getAdminGradingQueue,
  getInsightGradingQueue,
  setInsightGrade,
  listYvesMemoryVersionsForFilter,
  type GradingMode,
  type AdminQueueRow,
  type InsightGradingRow,
} from "@/lib/grading.functions";
import { setAlertOutcome } from "@/lib/alert-outcome.functions";
import { log } from "@/lib/log";

export const Route = createFileRoute("/admin/app/grading")({
  head: () => ({ meta: [{ title: "Yves Grading — Buddy" }] }),
  component: AdminGrading,
});

type Outcome = "confirmed" | "false_alarm" | "already_aware";
const OUTCOME_LABEL: Record<Outcome, string> = {
  confirmed: "Real concern",
  false_alarm: "False alarm",
  already_aware: "Already aware",
};

const MODE_OPTIONS: { value: GradingMode; label: string }[] = [
  { value: "super_admin_only", label: "Only me (super admin)" },
  { value: "practitioner", label: "Practitioners" },
  { value: "sampled", label: "Sampled audit" },
];

function AdminGrading() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<GradingMode>("super_admin_only");
  const [queue, setQueue] = useState<AdminQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);

  // Insight grading state
  const [insightQueue, setInsightQueue] = useState<InsightGradingRow[]>([]);
  const [insightLoading, setInsightLoading] = useState(true);
  const [versions, setVersions] = useState<Array<{ version: number; note: string | null }>>([]);
  const [versionFilter, setVersionFilter] = useState<number | null>(null);
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null);
  const [poorFor, setPoorFor] = useState<InsightGradingRow | null>(null);
  const [poorNote, setPoorNote] = useState("");

  const getModeFn = useServerFn(getGradingMode);
  const setModeFn = useServerFn(setGradingMode);
  const getQueueFn = useServerFn(getAdminGradingQueue);
  const setOutcomeFn = useServerFn(setAlertOutcome);
  const getInsightQueueFn = useServerFn(getInsightGradingQueue);
  const setInsightGradeFn = useServerFn(setInsightGrade);
  const listVersionsFn = useServerFn(listYvesMemoryVersionsForFilter);

  const refresh = async () => {
    try {
      const [m, q, v] = await Promise.all([getModeFn(), getQueueFn(), listVersionsFn()]);
      setMode(m.mode);
      setQueue(q);
      setVersions(v.map((x) => ({ version: x.version, note: x.note })));
    } catch (e) {
      log.error(e);
    } finally {
      setLoading(false);
    }
  };

  const refreshInsights = async (version: number | null) => {
    setInsightLoading(true);
    try {
      const rows = await getInsightQueueFn({ data: { memoryVersion: version } });
      setInsightQueue(rows);
    } catch (e) {
      log.error(e);
    } finally {
      setInsightLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);
  useEffect(() => { refreshInsights(versionFilter); }, [versionFilter]);

  const changeMode = async (next: GradingMode) => {
    setSavingMode(true);
    const prev = mode;
    setMode(next);
    try {
      await setModeFn({ data: { mode: next } });
    } catch (e) {
      log.error(e);
      setMode(prev);
    } finally {
      setSavingMode(false);
    }
  };

  const grade = async (alertId: string, outcome: Outcome) => {
    setQueue((q) => q.filter((r) => r.id !== alertId));
    try {
      await setOutcomeFn({ data: { alertId, outcome } });
    } catch (e) {
      log.error(e);
      refresh();
    }
  };

  const gradeInsight = async (row: InsightGradingRow, grade: "good" | "poor", note?: string) => {
    setInsightQueue((q) => q.filter((r) => r.id !== row.id));
    try {
      await setInsightGradeFn({ data: { insightId: row.id, grade, note } });
    } catch (e) {
      log.error(e);
      refreshInsights(versionFilter);
    }
  };

  const openPoor = (row: InsightGradingRow) => {
    setPoorFor(row);
    setPoorNote("");
  };

  const submitPoor = async (sendToTeach: boolean) => {
    if (!poorFor) return;
    const row = poorFor;
    const note = poorNote.trim() || undefined;
    setPoorFor(null);
    await gradeInsight(row, "poor", note);
    if (sendToTeach) {
      const params = new URLSearchParams({
        mode: "client",
        clientId: row.client_id,
        fromInsight: row.id,
      });
      if (row.focus) params.set("focus", row.focus);
      navigate({ to: "/admin/app/yves-teach", search: Object.fromEntries(params) as never });
    }
  };


  return (
    <div style={{ padding: "20px 16px 32px" }}>
      <h1
        style={{
          fontFamily: "var(--font-hero)",
          fontWeight: 400,
          fontSize: 28,
          color: "var(--white)",
        }}
      >
        Yves grading
      </h1>

      <div
        style={{
          marginTop: 16,
          background: "var(--navy-card)",
          border: "1px solid var(--navy-border)",
          borderRadius: 12,
          padding: 16,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 700,
            color: "var(--white)",
            fontSize: 14,
          }}
        >
          Who grades alerts
        </div>
        <div
          style={{
            marginTop: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {MODE_OPTIONS.map((opt) => {
            const active = mode === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={savingMode}
                onClick={() => changeMode(opt.value)}
                style={{
                  minHeight: 44,
                  padding: "10px 12px",
                  textAlign: "left",
                  background: active ? "var(--blue-accent)" : "transparent",
                  color: active ? "var(--white)" : "var(--white-muted)",
                  border: `1px solid ${active ? "var(--blue-accent)" : "var(--navy-border)"}`,
                  borderRadius: 8,
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: savingMode ? "default" : "pointer",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 10,
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            color: "var(--white-muted)",
            lineHeight: 1.5,
          }}
        >
          Controls who grades Yves alerts. Keeping it to yourself early gives consistent
          quality. Switch to practitioners once volume grows.
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 700,
            color: "var(--white)",
            fontSize: 14,
          }}
        >
          Grading queue
        </div>
        <div
          style={{
            marginTop: 4,
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            color: "var(--white-muted)",
          }}
        >
          {loading
            ? "Loading"
            : queue.length === 0
              ? "No alerts waiting for review."
              : `${queue.length} alert${queue.length === 1 ? "" : "s"} waiting for review`}
        </div>

        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {queue.map((r) => (
            <div
              key={r.id}
              style={{
                background: "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-ui)",
                  fontWeight: 700,
                  color: "var(--white)",
                  fontSize: 14,
                }}
              >
                {r.client_first_name}
              </div>
              <div
                style={{
                  marginTop: 2,
                  fontFamily: "var(--font-ui)",
                  fontSize: 11,
                  color: "var(--white-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                {r.practice_name} · {r.practitioner_name}
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  color: "var(--white-muted)",
                }}
              >
                {r.message}
              </div>
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {(["confirmed", "false_alarm", "already_aware"] as Outcome[]).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => grade(r.id, opt)}
                    style={{
                      flex: "1 1 0",
                      minHeight: 44,
                      padding: "10px 12px",
                      background: "transparent",
                      color: "var(--white-muted)",
                      border: "1px solid var(--navy-border)",
                      borderRadius: 8,
                      fontFamily: "var(--font-ui)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {OUTCOME_LABEL[opt]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Insight grading */}
      <div style={{ marginTop: 32 }}>
        <div style={{ fontFamily: "var(--font-ui)", fontWeight: 700, color: "var(--white)", fontSize: 14 }}>
          Insight grading
        </div>
        <div style={{ marginTop: 4, fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--white-muted)" }}>
          Grade Yves insights and tie them to the memory version that produced them.
        </div>

        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--white-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Memory version
          </span>
          <select
            value={versionFilter ?? ""}
            onChange={(e) => setVersionFilter(e.target.value ? Number(e.target.value) : null)}
            style={{
              minHeight: 36, padding: "6px 10px",
              background: "var(--navy-card)", color: "var(--white)",
              border: "1px solid var(--navy-border)", borderRadius: 8,
              fontFamily: "var(--font-ui)", fontSize: 12,
            }}
          >
            <option value="">All versions</option>
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}{v.note ? ` — ${v.note.slice(0, 40)}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: 8, fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--white-muted)" }}>
          {insightLoading
            ? "Loading"
            : insightQueue.length === 0
              ? "No insights waiting for review."
              : `${insightQueue.length} insight${insightQueue.length === 1 ? "" : "s"} waiting for review`}
        </div>

        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {insightQueue.map((r) => {
            const expanded = expandedInsight === r.id;
            return (
              <div key={r.id} style={{
                background: "var(--navy-card)", border: "1px solid var(--navy-border)",
                borderRadius: 12, padding: 14,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <div style={{ fontFamily: "var(--font-ui)", fontWeight: 700, color: "var(--white)", fontSize: 14 }}>
                    {r.client_first_name}
                    {r.focus ? <span style={{ marginLeft: 8, color: "var(--white-muted)", fontWeight: 500, fontSize: 12 }}>· {r.focus}</span> : null}
                  </div>
                  <div style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--white-muted)" }}>
                    Memory v{r.memory_version ?? "—"}
                  </div>
                </div>
                <div style={{
                  marginTop: 8, fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--white-muted)",
                  whiteSpace: "pre-wrap",
                }}>
                  {expanded ? r.response_full : r.response_preview}
                  {!expanded && r.response_full.length > r.response_preview.length ? "…" : ""}
                </div>
                {r.response_full.length > r.response_preview.length && (
                  <button type="button" onClick={() => setExpandedInsight(expanded ? null : r.id)}
                    style={{
                      marginTop: 6, background: "transparent", color: "var(--blue-accent)",
                      border: "none", padding: 0, cursor: "pointer",
                      fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600,
                    }}>
                    {expanded ? "Show less" : "Show full response"}
                  </button>
                )}
                <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" onClick={() => gradeInsight(r, "good")}
                    style={insightBtn("var(--navy-border)")}>Good</button>
                  <button type="button" onClick={() => openPoor(r)}
                    style={insightBtn("#f87171", "#f87171")}>Poor</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {poorFor && (
        <div onClick={() => setPoorFor(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 16,
          }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: "var(--navy-card)", border: "1px solid var(--navy-border)",
            borderRadius: 12, padding: 16, width: "min(520px, 100%)",
          }}>
            <div style={{ fontFamily: "var(--font-ui)", fontWeight: 700, color: "var(--white)", fontSize: 15 }}>
              Mark insight as poor
            </div>
            <div style={{ marginTop: 6, fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--white-muted)" }}>
              Optional note on what Yves got wrong. You can send this to the Teach Yves console prefilled with the client
              {poorFor.focus ? ` and focus "${poorFor.focus}"` : ""} to turn it into a memory rule.
            </div>
            <textarea
              value={poorNote}
              onChange={(e) => setPoorNote(e.target.value)}
              rows={4}
              placeholder="Why was this insight poor?"
              style={{
                width: "100%", marginTop: 10, padding: 10, borderRadius: 8,
                background: "#1a2949", color: "var(--white)", border: "1px solid var(--navy-border)",
                fontFamily: "var(--font-ui)", fontSize: 13, resize: "vertical", minHeight: 90,
              }}
            />
            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" onClick={() => setPoorFor(null)} style={insightBtn("var(--navy-border)")}>
                Cancel
              </button>
              <button type="button" onClick={() => submitPoor(false)} style={insightBtn("var(--navy-border)")}>
                Save grade only
              </button>
              <button type="button" onClick={() => submitPoor(true)} style={insightBtn("var(--blue-accent)", "var(--white)", "var(--blue-accent)")}>
                Save & Send to Teach Yves
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function insightBtn(border: string, color = "var(--white-muted)", bg = "transparent"): React.CSSProperties {
  return {
    flex: "0 0 auto", minHeight: 40, padding: "8px 14px",
    background: bg, color, border: `1px solid ${border}`, borderRadius: 8,
    fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, cursor: "pointer",
  };
}
