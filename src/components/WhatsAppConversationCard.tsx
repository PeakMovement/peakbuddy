import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { MessageCircle, ChevronDown } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getWhatsAppTranscript, type TranscriptLine } from "@/lib/whatsapp/transcript.functions";

// The patient's WhatsApp conversation with Buddy, read-only. Silent when the
// patient has never used WhatsApp. Collapsed by default: the check-ins it
// produced already appear in the timeline, this is the words behind them.

export function WhatsAppConversationCard({ clientId }: { clientId: string }) {
  const load = useServerFn(getWhatsAppTranscript);
  const [lines, setLines] = useState<TranscriptLine[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    load({ data: { clientId } })
      .then((r) => !cancelled && setLines(r.lines))
      .catch(() => !cancelled && setLines([]));
    return () => {
      cancelled = true;
    };
  }, [clientId, load]);

  if (!lines || lines.length === 0) return null;
  const last = lines[lines.length - 1];

  return (
    <div style={card}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={header} aria-expanded={open}>
        <MessageCircle size={17} color="var(--blue-accent)" aria-hidden />
        <span style={eyebrow}>WhatsApp conversation</span>
        <span style={{ ...sub, margin: 0, marginLeft: "auto" }}>
          {new Date(last.at).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}
        </span>
        <ChevronDown
          size={16}
          color="var(--white-muted)"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}
        />
      </button>
      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginTop: 12,
            maxHeight: 420,
            overflowY: "auto",
          }}
        >
          {lines.map((l, i) => (
            <div
              key={i}
              style={{
                alignSelf: l.from === "patient" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                background: l.from === "patient" ? "rgba(74,141,240,0.18)" : "var(--navy-border)",
                borderRadius: 12,
                padding: "8px 11px",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  color: "var(--white)",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.4,
                }}
              >
                {l.text}
              </div>
              <div style={{ ...sub, fontSize: 10.5, margin: "4px 0 0", textAlign: "right" }}>
                {l.from === "patient" ? "Patient" : "Buddy"} ·{" "}
                {new Date(l.at).toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" })}
                {l.failed ? " · not delivered" : ""}
              </div>
            </div>
          ))}
        </div>
      )}
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
const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  background: "transparent",
  border: "none",
  padding: 0,
  cursor: "pointer",
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
