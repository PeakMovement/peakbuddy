import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  labAct,
  labListFeedback,
  labRunScenarios,
  labSaveFeedback,
  labScenarios,
  labStart,
} from "@/lib/testlab/testlab.functions";

export const Route = createFileRoute("/admin/app/test-lab")({
  head: () => ({ meta: [{ title: "Test Lab — Buddy Admin" }] }),
  component: TestLabPage,
});

type Line = {
  at: string;
  dir: "in" | "out" | "event" | "system";
  who: string;
  text: string;
  buttons?: Array<{ id: string; title: string }>;
  listLabel?: string;
};
type Person = { key: string; label: string; phone: string; role: string; note: string };
type Snap = {
  key: string;
  label: string;
  exists: boolean;
  archived: boolean;
  state: string | null;
  reminder: { days: number[]; time: string; frequency: string; enabled: boolean } | null;
  checkins: number;
  lastCheckin: { at: string; pain: number; sleep: number; energy: number } | null;
  openAlerts: number;
};
type ScenarioInfo = {
  id: string;
  area: string;
  title: string;
  why: string;
  feature: string | null;
  needsAi?: boolean;
  checks: string[];
};
type ScenarioResult = {
  id: string;
  title: string;
  passed: boolean;
  feature: string | null;
  checks: Array<{ label: string; pass: boolean }>;
  transcript: Line[];
  error: string | null;
};

const STORE_KEY = "buddy-test-lab-v1";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const card: React.CSSProperties = {
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 12,
  padding: "12px 14px",
};
const btn: React.CSSProperties = {
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  color: "var(--white)",
  borderRadius: 999,
  padding: "6px 12px",
  fontSize: 14,
  cursor: "pointer",
};
const primary: React.CSSProperties = {
  ...btn,
  background: "var(--accent, #3b82f6)",
  border: "none",
};

function load(): unknown {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function save(v: unknown) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch {
    /* private mode or full: the lab still works for this visit */
  }
}

function TestLabPage() {
  const [tab, setTab] = useState<"chat" | "scenarios" | "notes">("chat");
  return (
    <div style={{ padding: 16, color: "var(--white)", maxWidth: 1100 }}>
      <h1 style={{ fontSize: 26, margin: "8px 0 4px" }}>Test Lab</h1>
      <p style={{ color: "var(--white-muted)", marginTop: 0 }}>
        Talk to the real Buddy as a made-up patient or practitioner. Nothing here reaches WhatsApp,
        real patients, push or email. Replies use the real AI.
      </p>
      <div style={{ display: "flex", gap: 8, margin: "12px 0", flexWrap: "wrap" }}>
        {(["chat", "scenarios", "notes"] as const).map((t) => (
          <button key={t} style={tab === t ? primary : btn} onClick={() => setTab(t)}>
            {t === "chat" ? "Chat" : t === "scenarios" ? "Scenarios" : "Your notes"}
          </button>
        ))}
      </div>
      {tab === "chat" && <ChatTab />}
      {tab === "scenarios" && <ScenariosTab />}
      {tab === "notes" && <NotesTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ChatTab() {
  const [state, setState] = useState<any>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [snapshot, setSnapshot] = useState<Snap[]>([]);
  const [who, setWho] = useState("sam");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdictNote, setVerdictNote] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await labStart();
      setState(r.state);
      setPeople(r.people as Person[]);
      setSnapshot(r.snapshot as Snap[]);
      save({ state: r.state, people: r.people, snapshot: r.snapshot });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the lab");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const kept = load() as { state: any; people: Person[]; snapshot: Snap[] } | null;
    if (kept?.state) {
      setState(kept.state);
      setPeople(kept.people ?? []);
      setSnapshot(kept.snapshot ?? []);
    } else void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state?.transcript?.length, who]);

  const act = async (action: any) => {
    if (!state || busy) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const r = await labAct({ data: { state, action } });
      setState(r.state);
      setSnapshot(r.snapshot as Snap[]);
      save({ state: r.state, people, snapshot: r.snapshot });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    void act({ kind: "send", from: who, text: t });
  };

  const lines: Line[] = useMemo(
    () =>
      ((state?.transcript ?? []) as Line[]).filter(
        (l) => l.who === who || l.dir === "system" || l.dir === "event",
      ),
    [state, who],
  );
  const lastButtons = [...lines].reverse().find((l) => l.dir === "out")?.buttons;
  const person = people.find((p) => p.key === who);

  const verdict = async (v: "right" | "wrong") => {
    if (!state) return;
    const r = await labSaveFeedback({
      data: {
        scenarioId: null,
        verdict: v,
        note: verdictNote.trim() || null,
        transcript: lines.slice(-60),
      },
    });
    setSaved(r.ok ? "Saved. Claude can read this." : r.error);
    if (r.ok) setVerdictNote("");
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
        {people.map((p) => (
          <button
            key={p.key}
            style={who === p.key ? primary : btn}
            onClick={() => setWho(p.key)}
            title={p.note}
          >
            {p.role === "practitioner" ? "🩺 " : ""}
            {p.label}
          </button>
        ))}
      </div>
      {person && <div style={{ color: "var(--white-muted)", fontSize: 14 }}>{person.note}</div>}

      <div style={{ ...card, minHeight: 300, maxHeight: "55vh", overflowY: "auto" }}>
        {lines.map((l, i) => (
          <Bubble key={i} line={l} />
        ))}
        {busy && (
          <div style={{ color: "var(--white-muted)", fontSize: 13 }}>Buddy is thinking…</div>
        )}
        <div ref={endRef} />
      </div>

      {lastButtons && lastButtons.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {lastButtons.map((b) => (
            <button
              key={b.id}
              style={btn}
              disabled={busy}
              onClick={() => act({ kind: "send", from: who, replyId: b.id, replyTitle: b.title })}
            >
              {b.title}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={`Message Buddy as ${person?.label ?? who}`}
          style={{
            flex: 1,
            background: "var(--navy-card)",
            border: "1px solid var(--navy-border)",
            color: "var(--white)",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 16,
          }}
        />
        <button style={primary} disabled={busy} onClick={send}>
          Send
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ color: "var(--white-muted)", fontSize: 14 }}>Skip ahead:</span>
        {(
          [
            ["1h", "+1 hour"],
            ["2h", "+2 hours"],
            ["reminder", "To 6pm reminders"],
            ["evening", "To 7:30pm report"],
            ["morning", "To 8am"],
            ["1d", "+1 day"],
            ["7d", "+7 days"],
          ] as const
        ).map(([j, label]) => (
          <button
            key={j}
            style={btn}
            disabled={busy}
            onClick={() => act({ kind: "advance", jump: j })}
          >
            {label}
          </button>
        ))}
        <button style={btn} disabled={busy} onClick={start}>
          Reset practice
        </button>
      </div>

      <div style={card}>
        <strong>Was that right?</strong>
        <textarea
          value={verdictNote}
          onChange={(e) => setVerdictNote(e.target.value)}
          placeholder="Optional: what should Buddy have done?"
          rows={2}
          style={{
            width: "100%",
            marginTop: 8,
            background: "transparent",
            color: "var(--white)",
            border: "1px solid var(--navy-border)",
            borderRadius: 8,
            padding: 8,
          }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button style={btn} onClick={() => verdict("right")}>
            👍 Looks right
          </button>
          <button style={btn} onClick={() => verdict("wrong")}>
            👎 Wrong
          </button>
          {saved && <span style={{ color: "var(--white-muted)", fontSize: 14 }}>{saved}</span>}
        </div>
      </div>

      {error && <p style={{ color: "var(--red)" }}>{error}</p>}

      <div style={{ display: "grid", gap: 8 }}>
        <strong>What Buddy holds now</strong>
        {snapshot.map((s) => (
          <div key={s.key} style={{ ...card, fontSize: 14 }}>
            <strong>{s.label}</strong>
            {!s.exists ? (
              <span style={{ color: "var(--white-muted)" }}> · no profile</span>
            ) : (
              <div style={{ color: "var(--white-muted)" }}>
                {s.archived ? "Archived · " : ""}
                {s.checkins} check-ins
                {s.lastCheckin
                  ? ` · last pain ${s.lastCheckin.pain}, sleep ${s.lastCheckin.sleep}, energy ${s.lastCheckin.energy}`
                  : ""}
                {s.reminder
                  ? ` · reminders ${s.reminder.enabled ? "" : "off "}${(s.reminder.days ?? []).map((d) => DAYS[d]).join(" ")} at ${String(s.reminder.time).slice(0, 5)}`
                  : " · no reminders"}
                {s.openAlerts
                  ? ` · ${s.openAlerts} open alert${s.openAlerts === 1 ? "" : "s"}`
                  : ""}
                {s.state ? ` · chat: ${s.state}` : ""}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Bubble({ line }: { line: Line }) {
  if (line.dir === "system" || line.dir === "event") {
    return (
      <div
        style={{
          fontSize: 12,
          color: line.dir === "event" ? "var(--amber, #f59e0b)" : "var(--white-muted)",
          margin: "6px 0",
          textAlign: "center",
        }}
      >
        {line.text}
      </div>
    );
  }
  const mine = line.dir === "in";
  return (
    <div
      style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start", margin: "6px 0" }}
    >
      <div
        style={{
          maxWidth: "80%",
          whiteSpace: "pre-wrap",
          background: mine ? "var(--accent, #3b82f6)" : "rgba(255,255,255,0.08)",
          borderRadius: 12,
          padding: "8px 10px",
          fontSize: 15,
        }}
      >
        {line.text}
        {line.buttons && line.buttons.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
            {line.listLabel ? `${line.listLabel}: ` : ""}
            {line.buttons.map((b) => b.title).join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ScenariosTab() {
  const [list, setList] = useState<ScenarioInfo[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, ScenarioResult>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});

  useEffect(() => {
    labScenarios()
      .then((l) => setList(l as ScenarioInfo[]))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load scenarios"));
  }, []);

  const run = async (ids: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const out = (await labRunScenarios({ data: { ids } })) as ScenarioResult[];
      setResults((r) => ({ ...r, ...Object.fromEntries(out.map((x) => [x.id, x])) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setBusy(false);
    }
  };

  const verdict = async (id: string, v: "right" | "wrong") => {
    const r = await labSaveFeedback({
      data: {
        scenarioId: id,
        verdict: v,
        note: notes[id]?.trim() || null,
        transcript: (results[id]?.transcript ?? []).slice(-60),
      },
    });
    setSaved((s) => ({ ...s, [id]: r.ok ? "Saved" : r.error }));
  };

  const areas = [...new Set(list.map((s) => s.area))];
  const done = Object.values(results);
  const passCount = done.filter((r) => r.passed).length;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button style={primary} disabled={busy} onClick={() => run(list.map((s) => s.id))}>
          Run all
        </button>
        <button style={btn} disabled={busy || !picked.size} onClick={() => run([...picked])}>
          Run ticked ({picked.size})
        </button>
        {busy && (
          <span style={{ color: "var(--white-muted)" }}>Running… each takes a few seconds.</span>
        )}
        {done.length > 0 && !busy && (
          <span>
            {passCount} of {done.length} passed
          </span>
        )}
      </div>
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {areas.map((area) => (
        <div key={area} style={{ display: "grid", gap: 8 }}>
          <strong>{area}</strong>
          {list
            .filter((s) => s.area === area)
            .map((s) => {
              const r = results[s.id];
              return (
                <div key={s.id} style={card}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <input
                      type="checkbox"
                      checked={picked.has(s.id)}
                      onChange={(e) =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (e.target.checked) n.add(s.id);
                          else n.delete(s.id);
                          return n;
                        })
                      }
                      style={{ marginTop: 4 }}
                    />
                    <div style={{ flex: 1 }}>
                      <div>
                        {r ? (r.passed ? "✅ " : "❌ ") : ""}
                        <strong>{s.title}</strong>
                        {s.needsAi && (
                          <span style={{ color: "var(--white-muted)", fontSize: 12 }}>
                            {" "}
                            · uses the AI
                          </span>
                        )}
                        {s.feature && (
                          <span style={{ color: "var(--white-muted)", fontSize: 12 }}>
                            {" "}
                            · new: {s.feature}
                          </span>
                        )}
                      </div>
                      <div style={{ color: "var(--white-muted)", fontSize: 14 }}>{s.why}</div>
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 14 }}>
                        {(
                          r?.checks ??
                          s.checks.map((label) => ({ label, pass: null as boolean | null }))
                        ).map((c, i) => (
                          <li key={i}>
                            {c.pass === null ? "" : c.pass ? "✓ " : "✗ "}
                            {c.label}
                          </li>
                        ))}
                      </ul>
                      {r && (
                        <>
                          <button
                            style={{ ...btn, marginTop: 8 }}
                            onClick={() => setOpen(open === s.id ? null : s.id)}
                          >
                            {open === s.id ? "Hide conversation" : "Show conversation"}
                          </button>
                          {open === s.id && (
                            <div style={{ ...card, marginTop: 8 }}>
                              {r.transcript.map((l, i) => (
                                <div key={i} style={{ fontSize: 13, margin: "4px 0" }}>
                                  <span style={{ color: "var(--white-muted)" }}>
                                    {l.dir === "in"
                                      ? `${l.who} →`
                                      : l.dir === "out"
                                        ? `Buddy → ${l.who}`
                                        : "·"}
                                  </span>{" "}
                                  <span style={{ whiteSpace: "pre-wrap" }}>{l.text}</span>
                                  {l.buttons?.length ? (
                                    <span style={{ color: "var(--white-muted)" }}>
                                      {" "}
                                      [{l.buttons.map((b) => b.title).join(" | ")}]
                                    </span>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                            <input
                              value={notes[s.id] ?? ""}
                              onChange={(e) => setNotes((n) => ({ ...n, [s.id]: e.target.value }))}
                              placeholder="Note for Claude (optional)"
                              style={{
                                flex: 1,
                                minWidth: 180,
                                background: "transparent",
                                color: "var(--white)",
                                border: "1px solid var(--navy-border)",
                                borderRadius: 8,
                                padding: "6px 8px",
                              }}
                            />
                            <button style={btn} onClick={() => verdict(s.id, "right")}>
                              👍
                            </button>
                            <button style={btn} onClick={() => verdict(s.id, "wrong")}>
                              👎
                            </button>
                            {saved[s.id] && (
                              <span style={{ color: "var(--white-muted)", fontSize: 13 }}>
                                {saved[s.id]}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function NotesTab() {
  const [rows, setRows] = useState<
    Array<{
      id: number;
      created_at: string;
      scenario_id: string | null;
      verdict: string;
      note: string | null;
    }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    labListFeedback()
      .then(setRows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load notes"));
  }, []);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <p style={{ color: "var(--white-muted)", margin: 0 }}>
        Everything you've marked. Claude reads these when you say "check my Test Lab notes".
      </p>
      {error && <p style={{ color: "var(--red)" }}>{error}</p>}
      {rows.length === 0 && !error && <p style={{ color: "var(--white-muted)" }}>Nothing yet.</p>}
      {rows.map((r) => (
        <div key={r.id} style={card}>
          {r.verdict === "right" ? "👍" : r.verdict === "wrong" ? "👎" : "📝"}{" "}
          <strong>{r.scenario_id ?? "Chat"}</strong>
          <span style={{ color: "var(--white-muted)", fontSize: 13 }}>
            {" "}
            · {new Date(r.created_at).toLocaleString("en-ZA")}
          </span>
          {r.note && <div style={{ marginTop: 4 }}>{r.note}</div>}
        </div>
      ))}
    </div>
  );
}
