import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ThumbsUp, MessageSquareWarning, Send, Sparkles } from "lucide-react";
import { listAllClientsForAdmin, type AdminClientListItem } from "@/lib/admin-data-hub.functions";
import {
  askYves,
  markYvesFeedbackPositive,
  getYvesMemoryPanel,
  proposeYvesRule,
  YVES_TEACH_FOCUSES,
} from "@/lib/yves-teach.functions";
import { publishYvesRule, rejectYvesRule, rollbackYvesMemory } from "@/lib/yves-memory.functions";

export const Route = createFileRoute("/admin/app/yves-teach")({
  head: () => ({ meta: [{ title: "Teach Yves — Buddy" }] }),
  component: TeachYves,
});

type Mode = "client" | "scenario";
type Turn = {
  id: string;
  role: "admin" | "yves";
  text: string;
  feedbackId?: string | null;
  memoryVersion?: number;
  liked?: boolean;
};

const C = {
  card: "#243a6b",
  border: "#3658a3",
  muted: "#b8c5db",
  white: "#f0ece4",
  blue: "#4a8df0",
  green: "#34d399",
  amber: "#fbbf24",
  red: "#f87171",
};

function newSessionId() {
  return `teach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function TeachYves() {
  const listFn = useServerFn(listAllClientsForAdmin);
  const askFn = useServerFn(askYves);
  const likeFn = useServerFn(markYvesFeedbackPositive);
  const memFn = useServerFn(getYvesMemoryPanel);

  const [clients, setClients] = useState<AdminClientListItem[]>([]);
  const [mode, setMode] = useState<Mode>("client");
  const [clientId, setClientId] = useState<string>("");
  const [scenarioText, setScenarioText] = useState<string>("");
  const [focus, setFocus] = useState<string>(YVES_TEACH_FOCUSES[0]);
  const [question, setQuestion] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const sessionIdRef = useRef<string>(newSessionId());

  // Right column
  const [tab, setTab] = useState<"published" | "staging" | "versions">("published");
  const [panel, setPanel] = useState<Awaited<ReturnType<typeof getYvesMemoryPanel>> | null>(null);
  const [panelBusy, setPanelBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try { setClients(await listFn()); } catch { /* ignore */ }
    })();
  }, [listFn]);

  useEffect(() => {
    (async () => {
      setPanelBusy(true);
      try { setPanel(await memFn()); } catch { /* ignore */ }
      finally { setPanelBusy(false); }
    })();
  }, [memFn]);

  const canSend = useMemo(() => {
    if (busy || !question.trim()) return false;
    if (mode === "client") return !!clientId;
    return !!scenarioText.trim();
  }, [busy, question, mode, clientId, scenarioText]);

  async function send() {
    if (!canSend) return;
    const q = question.trim();
    const localId = `t-${Date.now()}`;
    setTurns((prev) => [...prev, { id: localId, role: "admin", text: q }]);
    setQuestion("");
    setBusy(true);
    setErr(null);
    try {
      const r = await askFn({
        data: {
          mode,
          clientId: mode === "client" ? clientId : null,
          scenarioText: mode === "scenario" ? scenarioText : null,
          focus,
          question: q,
          sessionId: sessionIdRef.current,
        },
      });
      setTurns((prev) => [
        ...prev,
        {
          id: `y-${Date.now()}`,
          role: "yves",
          text: r.answer,
          feedbackId: r.feedbackId,
          memoryVersion: r.memoryVersion,
        },
      ]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to reach Yves");
    } finally { setBusy(false); }
  }

  async function like(t: Turn) {
    if (!t.feedbackId || t.liked) return;
    setTurns((prev) => prev.map((x) => (x.id === t.id ? { ...x, liked: true } : x)));
    try { await likeFn({ data: { feedbackId: t.feedbackId } }); }
    catch { setTurns((prev) => prev.map((x) => (x.id === t.id ? { ...x, liked: false } : x))); }
  }

  // Correction dialog state
  const proposeFn = useServerFn(proposeYvesRule);
  const [correctFor, setCorrectFor] = useState<Turn | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [correctBusy, setCorrectBusy] = useState(false);
  const [correctMsg, setCorrectMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);

  function correct(t: Turn) {
    if (!t.feedbackId) return;
    setCorrectFor(t);
    setCorrectionText("");
    setCorrectMsg(null);
  }

  async function submitCorrection() {
    if (!correctFor?.feedbackId || !correctionText.trim()) return;
    setCorrectBusy(true);
    setCorrectMsg(null);
    try {
      const r = await proposeFn({
        data: { feedbackId: correctFor.feedbackId, correction: correctionText.trim(), focus },
      });
      if (r.ok) {
        setCorrectMsg({ tone: "ok", text: `Staged as candidate rule${r.conflictIds?.length ? ` (${r.conflictIds.length} conflict${r.conflictIds.length === 1 ? "" : "s"} flagged)` : ""}.` });
        try { setPanel(await memFn()); setTab("staging"); } catch { /* ignore */ }
      } else {
        setCorrectMsg({ tone: "warn", text: r.reason ?? "Blocked." });
      }
    } catch (e) {
      setCorrectMsg({ tone: "err", text: e instanceof Error ? e.message : "Failed to propose rule." });
    } finally {
      setCorrectBusy(false);
    }
  }

  // Publish / Reject / Rollback wiring
  type StagingRow = NonNullable<typeof panel>["staging"][number];
  const publishFn = useServerFn(publishYvesRule);
  const rejectFn = useServerFn(rejectYvesRule);
  const rollbackFn = useServerFn(rollbackYvesMemory);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [panelMsg, setPanelMsg] = useState<{ tone: "ok" | "warn" | "err"; text: string } | null>(null);
  const [editRow, setEditRow] = useState<StagingRow | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; rule_text: string; rationale: string; scope: string; rule_type: string }>({
    title: "", rule_text: "", rationale: "", scope: "", rule_type: "reasoning",
  });
  const [editSupersedesId, setEditSupersedesId] = useState<string>("");
  const [reviewNote, setReviewNote] = useState<string>("");

  async function refreshPanel() {
    setPanelBusy(true);
    try { setPanel(await memFn()); }
    catch { /* ignore */ }
    finally { setPanelBusy(false); }
  }

  async function approveRow(r: StagingRow, edits?: { title?: string; rule_text?: string; rationale?: string; scope?: string; rule_type?: string }, supersedesId?: string | null, note?: string) {
    setRowBusyId(r.id);
    setPanelMsg(null);
    try {
      const res = await publishFn({ data: { stagingId: r.id, edits, supersedesId: supersedesId ?? null, reviewNote: note } });
      setPanelMsg({ tone: "ok", text: `Published (v${res.version})${res.supersededId ? ` — superseded ${res.supersededId.slice(0, 8)}…` : ""}` });
      await refreshPanel();
      setTab("published");
      setEditRow(null);
    } catch (e) {
      setPanelMsg({ tone: "err", text: e instanceof Error ? e.message : "Publish failed." });
    } finally { setRowBusyId(null); }
  }

  async function rejectRow(r: StagingRow) {
    const note = window.prompt("Optional note for rejection:", "") ?? undefined;
    setRowBusyId(r.id);
    setPanelMsg(null);
    try {
      await rejectFn({ data: { stagingId: r.id, reviewNote: note?.trim() || undefined } });
      setPanelMsg({ tone: "ok", text: "Rejected." });
      await refreshPanel();
    } catch (e) {
      setPanelMsg({ tone: "err", text: e instanceof Error ? e.message : "Reject failed." });
    } finally { setRowBusyId(null); }
  }

  function openEdit(r: StagingRow) {
    setEditRow(r);
    setEditDraft({
      title: r.title,
      rule_text: r.rule_text,
      rationale: r.rationale ?? "",
      scope: r.scope,
      rule_type: r.rule_type,
    });
    setEditSupersedesId(r.conflict_flags[0] ?? "");
    setReviewNote("");
    setPanelMsg(null);
  }

  async function rollback(versionNumber: number) {
    if (!window.confirm(`Roll back live memory to version ${versionNumber}? This deactivates current active rules and restores the snapshot.`)) return;
    setRowBusyId(`v-${versionNumber}`);
    setPanelMsg(null);
    try {
      const res = await rollbackFn({ data: { versionNumber } });
      setPanelMsg({ tone: "ok", text: `Rolled back — restored ${res.restoredCount} rule(s), new version v${res.newVersion}.` });
      await refreshPanel();
      setTab("published");
    } catch (e) {
      setPanelMsg({ tone: "err", text: e instanceof Error ? e.message : "Rollback failed." });
    } finally { setRowBusyId(null); }
  }

  function resetSession() {
    sessionIdRef.current = newSessionId();
    setTurns([]);
    setErr(null);
  }

  return (
    <div style={{ padding: 20, color: C.white, fontFamily: "var(--font-ui)" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Sparkles size={22} color={C.blue} />
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Teach Yves</h1>
          <div style={{ color: C.muted, fontSize: 13 }}>
            Test questions against real clients or scenarios. Positive answers train future memory candidates.
          </div>
        </div>
        <button onClick={resetSession}
          style={{ marginLeft: "auto", background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}>
          New session
        </button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 380px)", gap: 16 }}>
        {/* LEFT: conversation */}
        <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", minHeight: 560 }}>
          {/* Controls */}
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 6, background: "rgba(0,0,0,0.2)", padding: 4, borderRadius: 8 }}>
              {(["client", "scenario"] as Mode[]).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  style={{
                    padding: "6px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                    background: mode === m ? C.blue : "transparent",
                    color: mode === m ? C.white : C.muted, fontWeight: 600, fontSize: 12,
                  }}>
                  {m === "client" ? "Test against a client" : "Scenario"}
                </button>
              ))}
            </div>
            {mode === "client" ? (
              <select value={clientId} onChange={(e) => setClientId(e.target.value)}
                style={inputStyle}>
                <option value="">Select a client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}{c.practitioner_name ? ` — ${c.practitioner_name}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div style={{ color: C.muted, fontSize: 12 }}>Scenario mode — no live data.</div>
            )}
            <select value={focus} onChange={(e) => setFocus(e.target.value)} style={inputStyle}>
              {YVES_TEACH_FOCUSES.map((f) => (<option key={f} value={f}>{f}</option>))}
            </select>
          </div>

          {mode === "scenario" && (
            <textarea
              value={scenarioText}
              onChange={(e) => setScenarioText(e.target.value)}
              placeholder="Describe the scenario Yves should reason about (no real patient data)…"
              rows={3}
              style={{ ...inputStyle, marginTop: 10, resize: "vertical", minHeight: 70 }}
            />
          )}

          {/* Thread */}
          <div style={{ marginTop: 14, flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingRight: 4 }}>
            {turns.length === 0 && (
              <div style={{ color: C.muted, fontSize: 13, textAlign: "center", padding: 24 }}>
                Ask a clinical question. Yves will answer using {mode === "client" ? "the selected client's real live data" : "your scenario"} and its core memory.
              </div>
            )}
            {turns.map((t) => (
              <div key={t.id}
                style={{
                  alignSelf: t.role === "admin" ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  background: t.role === "admin" ? C.blue : "rgba(0,0,0,0.25)",
                  color: C.white,
                  border: t.role === "yves" ? `1px solid ${C.border}` : "none",
                  padding: "10px 12px", borderRadius: 10, fontSize: 13, lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                }}>
                {t.text}
                {t.role === "yves" && (
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: C.muted }}>
                    <span>Memory v{t.memoryVersion ?? 0}</span>
                    <span style={{ flex: 1 }} />
                    <button onClick={() => like(t)} disabled={!t.feedbackId || t.liked}
                      title="Positive example"
                      style={pillBtn(t.liked ? C.green : C.muted)}>
                      <ThumbsUp size={12} /> {t.liked ? "Logged" : "Good"}
                    </button>
                    <button onClick={() => correct(t)} disabled={!t.feedbackId}
                      title="Correct this answer"
                      style={pillBtn(C.amber)}>
                      <MessageSquareWarning size={12} /> Correct this
                    </button>
                  </div>
                )}
              </div>
            ))}
            {busy && <div style={{ color: C.muted, fontSize: 12 }}>Yves is thinking…</div>}
            {err && <div style={{ color: C.red, fontSize: 12 }}>{err}</div>}
          </div>

          {/* Composer */}
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask Yves a test question…"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button onClick={send} disabled={!canSend}
              style={{
                background: canSend ? C.blue : "rgba(74,141,240,0.4)",
                color: C.white, border: "none", borderRadius: 8, padding: "0 14px",
                cursor: canSend ? "pointer" : "not-allowed", display: "flex", alignItems: "center", gap: 6, fontWeight: 600,
              }}>
              <Send size={14} /> Send
            </button>
          </div>
        </section>

        {/* RIGHT: memory */}
        <aside style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 12, minHeight: 560 }}>
          <div style={{ display: "flex", gap: 4, background: "rgba(0,0,0,0.2)", padding: 4, borderRadius: 8, marginBottom: 10 }}>
            {(["published", "staging", "versions"] as const).map((k) => (
              <button key={k} onClick={() => setTab(k)}
                style={{
                  flex: 1, padding: "6px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                  background: tab === k ? C.blue : "transparent",
                  color: tab === k ? C.white : C.muted, fontWeight: 600, fontSize: 12, textTransform: "capitalize",
                }}>{k}</button>
            ))}
          </div>

          {panelMsg && (
            <div style={{
              marginBottom: 10, padding: 8, borderRadius: 6, fontSize: 11,
              background: "rgba(0,0,0,0.25)",
              border: `1px solid ${panelMsg.tone === "ok" ? C.green : panelMsg.tone === "warn" ? C.amber : C.red}`,
              color: panelMsg.tone === "ok" ? C.green : panelMsg.tone === "warn" ? C.amber : C.red,
            }}>{panelMsg.text}</div>
          )}

          {panelBusy && <div style={{ color: C.muted, fontSize: 12 }}>Loading memory…</div>}
          {!panelBusy && panel && tab === "published" && (
            <div style={memListStyle}>
              {panel.published.length === 0 && <Empty label="No active rules yet." />}
              {panel.published.map((r) => (
                <MemoryCard key={r.id}
                  badge={`${r.scope} · ${r.rule_type}`} title={r.title} body={r.rule_text}
                  meta={`Updated ${new Date(r.updated_at).toLocaleDateString("en-ZA")}`} />
              ))}
            </div>
          )}
          {!panelBusy && panel && tab === "staging" && (
            <div style={memListStyle}>
              {panel.staging.length === 0 && <Empty label="No candidate rules." />}
              {panel.staging.map((r) => {
                const conflictTitles = r.conflict_flags
                  .map((id) => panel.published.find((p) => p.id === id)?.title)
                  .filter((t): t is string => Boolean(t));
                const hasConflict = r.conflict_flags.length > 0;
                return (
                  <div key={r.id}
                    style={{ background: "rgba(0,0,0,0.2)", border: `1px solid ${hasConflict ? C.amber : C.border}`, borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: hasConflict ? C.amber : C.muted }}>
                      {r.scope} · {r.rule_type} · {r.status}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginTop: 2 }}>{r.title}</div>
                    <div style={{ color: C.white, fontSize: 12, marginTop: 4, whiteSpace: "pre-wrap" }}>{r.rule_text}</div>
                    {r.rationale && (
                      <div style={{ color: C.muted, fontSize: 11, marginTop: 6, fontStyle: "italic" }}>Why: {r.rationale}</div>
                    )}
                    {hasConflict && (
                      <div style={{ color: C.amber, fontSize: 11, marginTop: 6 }}>
                        Conflicts with: {conflictTitles.length ? conflictTitles.join("; ") : `${r.conflict_flags.length} rule(s)`}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                      <button onClick={() => approveRow(r, undefined, r.conflict_flags[0] ?? null)}
                        disabled={rowBusyId === r.id || r.status !== "pending"}
                        style={pillBtn(r.status === "pending" ? C.green : C.muted)}>
                        {rowBusyId === r.id ? "…" : "Approve"}
                      </button>
                      <button onClick={() => openEdit(r)}
                        disabled={rowBusyId === r.id || r.status !== "pending"}
                        style={pillBtn(C.blue)}>Edit</button>
                      <button onClick={() => rejectRow(r)}
                        disabled={rowBusyId === r.id || r.status !== "pending"}
                        style={pillBtn(C.red)}>Reject</button>
                      <span style={{ flex: 1 }} />
                      <span style={{ color: C.muted, fontSize: 11 }}>{new Date(r.created_at).toLocaleDateString("en-ZA")}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!panelBusy && panel && tab === "versions" && (
            <div style={memListStyle}>
              {panel.versions.length === 0 && <Empty label="No snapshots yet." />}
              {panel.versions.map((v) => (
                <div key={v.id} style={{ background: "rgba(0,0,0,0.2)", border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 700 }}>v{v.version_number}</div>
                    <button onClick={() => rollback(v.version_number)}
                      disabled={rowBusyId === `v-${v.version_number}`}
                      style={{ background: "transparent", color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: rowBusyId === `v-${v.version_number}` ? "not-allowed" : "pointer" }}>
                      {rowBusyId === `v-${v.version_number}` ? "Restoring…" : "Rollback"}
                    </button>
                  </div>
                  {v.note && <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>{v.note}</div>}
                  <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>
                    {new Date(v.created_at).toLocaleString("en-ZA")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {correctFor && (
        <div
          onClick={() => !correctBusy && setCorrectFor(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 }}
        >
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, width: "min(560px, 100%)", maxHeight: "90vh", overflowY: "auto" }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Correct Yves</h2>
            <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
              Write how Yves should have answered, or the rule it should follow. Yves will draft a reusable, generalised rule from it. No client names, ids, dates, or one-off values.
            </div>
            <textarea
              value={correctionText}
              onChange={(e) => setCorrectionText(e.target.value)}
              rows={6}
              placeholder="e.g. When HRV drops >15% below baseline for 3+ nights, flag as recovery risk before recommending training…"
              style={{ ...inputStyle, width: "100%", marginTop: 10, resize: "vertical", minHeight: 120 }}
            />
            {correctMsg && (
              <div style={{
                marginTop: 10, padding: 10, borderRadius: 8, fontSize: 12,
                background: "rgba(0,0,0,0.25)",
                border: `1px solid ${correctMsg.tone === "ok" ? C.green : correctMsg.tone === "warn" ? C.amber : C.red}`,
                color: correctMsg.tone === "ok" ? C.green : correctMsg.tone === "warn" ? C.amber : C.red,
              }}>
                {correctMsg.text}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
              <button onClick={() => setCorrectFor(null)} disabled={correctBusy}
                style={{ background: "transparent", color: C.muted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", cursor: correctBusy ? "not-allowed" : "pointer" }}>
                Close
              </button>
              <button onClick={submitCorrection} disabled={correctBusy || !correctionText.trim()}
                style={{
                  background: correctBusy || !correctionText.trim() ? "rgba(74,141,240,0.4)" : C.blue,
                  color: C.white, border: "none", borderRadius: 8, padding: "8px 14px",
                  cursor: correctBusy || !correctionText.trim() ? "not-allowed" : "pointer", fontWeight: 600,
                }}>
                {correctBusy ? "Drafting…" : "Propose rule"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.25)",
  color: "#f0ece4",
  border: "1px solid #3658a3",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  outline: "none",
  minHeight: 36,
};

const memListStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 8,
  maxHeight: 480, overflowY: "auto", paddingRight: 4,
};

function pillBtn(color: string): React.CSSProperties {
  return {
    background: "transparent", color, border: `1px solid ${color}`, borderRadius: 999,
    padding: "3px 8px", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer",
  };
}

function Empty({ label }: { label: string }) {
  return <div style={{ color: C.muted, fontSize: 12, textAlign: "center", padding: 16 }}>{label}</div>;
}

function MemoryCard({ badge, title, body, meta, tone }: { badge: string; title: string; body: string; meta: string; tone?: string }) {
  return (
    <div style={{ background: "rgba(0,0,0,0.2)", border: `1px solid ${tone ?? C.border}`, borderRadius: 8, padding: 10 }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: tone ?? C.muted }}>{badge}</div>
      <div style={{ fontWeight: 700, fontSize: 13, marginTop: 2 }}>{title}</div>
      <div style={{ color: C.white, fontSize: 12, marginTop: 4, whiteSpace: "pre-wrap" }}>{body}</div>
      <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>{meta}</div>
    </div>
  );
}
