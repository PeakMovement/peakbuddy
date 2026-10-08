import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessageCircle, ChevronDown } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getWhatsAppTranscript, type TranscriptLine } from "@/lib/whatsapp/transcript.functions";

// The patient's WhatsApp conversation with Buddy, read-only. Silent when the
// patient has never used WhatsApp. Collapsed by default: the check-ins it
// produced already appear in the timeline, this is the words behind them.
// Loads the newest 100 messages; "Load earlier" pages back from there.

export function WhatsAppConversationCard({ clientId }: { clientId: string }) {
  const load = useServerFn(getWhatsAppTranscript);
  const [lines, setLines] = useState<TranscriptLine[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [earlierBusy, setEarlierBusy] = useState(false);
  const [earlierError, setEarlierError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // After prepending older messages, keep the view anchored where it was.
  const anchorRef = useRef<number | null>(null);

  const loadNewest = useCallback(() => {
    let cancelled = false;
    setFailed(false);
    load({ data: { clientId } })
      .then((r) => {
        if (cancelled) return;
        setLines(r.lines);
        setNextBefore(r.nextBefore);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, load]);

  useEffect(() => loadNewest(), [loadNewest]);

  // Opening the card jumps to the latest message.
  useLayoutEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && anchorRef.current !== null) {
      el.scrollTop = el.scrollHeight - anchorRef.current;
      anchorRef.current = null;
    }
  }, [lines]);

  const loadEarlier = async () => {
    if (!nextBefore || earlierBusy) return;
    setEarlierBusy(true);
    setEarlierError(false);
    try {
      const r = await load({ data: { clientId, before: nextBefore } });
      const el = scrollRef.current;
      if (el) anchorRef.current = el.scrollHeight - el.scrollTop;
      setLines((prev) => [...r.lines, ...(prev ?? [])]);
      setNextBefore(r.nextBefore);
    } catch {
      setEarlierError(true);
    } finally {
      setEarlierBusy(false);
    }
  };

  if (failed) {
    return (
      <div style={card} role="alert">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MessageCircle size={17} color="var(--blue-accent)" aria-hidden />
          <span style={eyebrow}>WhatsApp conversation</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <span style={{ ...sub, margin: 0, flex: 1 }}>Couldn't load the conversation.</span>
          <button type="button" onClick={() => loadNewest()} style={retryBtn}>
            Retry
          </button>
        </div>
      </div>
    );
  }
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
          ref={scrollRef}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginTop: 12,
            maxHeight: 420,
            overflowY: "auto",
          }}
        >
          {nextBefore && (
            <button
              type="button"
              onClick={() => void loadEarlier()}
              disabled={earlierBusy}
              style={{
                ...retryBtn,
                alignSelf: "center",
                opacity: earlierBusy ? 0.6 : 1,
                cursor: earlierBusy ? "wait" : "pointer",
              }}
            >
              {earlierBusy
                ? "Loading…"
                : earlierError
                  ? "Couldn't load. Tap to retry"
                  : "Load earlier"}
            </button>
          )}
          {lines.map((l, i) => (
            <div
              key={`${l.at}-${l.from}-${i}`}
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

const retryBtn: CSSProperties = {
  minHeight: 36,
  padding: "0 14px",
  background: "transparent",
  color: "var(--blue-accent)",
  border: "1px solid var(--navy-border)",
  borderRadius: 999,
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  flexShrink: 0,
};
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
