import type { CSSProperties } from "react";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { generateClientInsight } from "@/lib/data-hub-insight.functions";

const FOCUSES = ["General overview", "Pain & symptoms", "Sleep & recovery", "Training load", "Risk factors"];

/** Practitioner-facing "Generate Yves insight" panel (own clients, 3/day). */
export function YvesInsightCard({ clientId }: { clientId: string }) {
  const gen = useServerFn(generateClientInsight);
  const [focus, setFocus] = useState(FOCUSES[0]);
  const [text, setText] = useState("");
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await gen({ data: { clientId, focus } });
      setText(r.text); setAt(r.generatedAt);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not generate insight.");
    } finally { setBusy(false); }
  };

  return (
    <section style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Sparkles size={16} color="var(--cold-blue, #7aa8ff)" />
        <div style={title}>Yves insight</div>
      </div>
      <p style={sub}>An AI read of this client's recent data. Up to 3 per day.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <select value={focus} onChange={(e) => setFocus(e.target.value)} disabled={busy} style={sel}>
          {FOCUSES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button type="button" onClick={run} disabled={busy} style={btn}>
          {busy ? "Generating…" : "Generate"}
        </button>
      </div>
      {err && <div style={{ color: "var(--red, #f87171)", fontSize: 13, marginTop: 10 }}>{err}</div>}
      {text && (
        <div style={out}>
          {renderMarkdown(text)}
          {at && <div style={{ color: "var(--white-muted)", fontSize: 11, marginTop: 10 }}>Generated {new Date(at).toLocaleString()}</div>}
        </div>
      )}
    </section>
  );
}

// Minimal markdown: headings, bullets, bold, paragraphs.
function renderMarkdown(md: string) {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  lines.forEach((raw, i) => {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "$1"); // strip bold markers
    if (/^#{1,6}\s/.test(line)) {
      out.push(<div key={i} style={{ fontWeight: 700, color: "var(--white)", fontSize: 14, marginTop: 12, marginBottom: 4 }}>{line.replace(/^#{1,6}\s/, "")}</div>);
    } else if (/^\s*[-*]\s/.test(line)) {
      out.push(<div key={i} style={{ color: "var(--white)", fontSize: 13, margin: "2px 0 2px 12px" }}>• {line.replace(/^\s*[-*]\s/, "")}</div>);
    } else if (line.trim() === "") {
      out.push(<div key={i} style={{ height: 6 }} />);
    } else {
      out.push(<div key={i} style={{ color: "var(--white)", fontSize: 13, lineHeight: 1.5 }}>{line}</div>);
    }
  });
  return out;
}

const card: CSSProperties = { marginTop: 20, background: "var(--navy-card)", border: "1px solid var(--navy-border)", borderRadius: 12, padding: 16 };
const title: CSSProperties = { fontFamily: "var(--font-ui)", fontWeight: 700, color: "var(--white)", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em" };
const sub: CSSProperties = { color: "var(--white-muted)", fontSize: 12, margin: "2px 0 0" };
const sel: CSSProperties = { background: "var(--navy)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "9px 11px", color: "var(--white)", fontSize: 14 };
const btn: CSSProperties = { background: "var(--blue-accent, #4a8df0)", color: "#04111f", border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer" };
const out: CSSProperties = { marginTop: 12, background: "var(--navy)", border: "1px solid var(--navy-border)", borderRadius: 10, padding: 14 };
