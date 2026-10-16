import { useEffect, useState, type CSSProperties } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  forgetPatientMemory,
  listPatientMemory,
  setBuddyPaused,
} from "@/lib/conversation-layer.functions";

export function BuddyThreadCard({ clientId }: { clientId: string }) {
  const load = useServerFn(listPatientMemory);
  const forget = useServerFn(forgetPatientMemory);
  const pause = useServerFn(setBuddyPaused);
  const [facts, setFacts] = useState<Array<{ id: string; fact: string }>>([]);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = () => {
    load({ data: { clientId } })
      .then((r) => {
        if (!r.ok) {
          setReady(true);
          return;
        }
        setFacts(r.facts);
        setPaused(r.paused);
        setReady(true);
      })
      .catch(() => setReady(true));
  };

  useEffect(() => {
    refresh();
    // clientId is the only input that should reload the card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const onForget = async (memoryId?: string) => {
    const result = await forget({ data: { clientId, memoryId } });
    setNote(result.ok ? "Removed." : "Could not remove that.");
    refresh();
  };

  const onPause = async (next: boolean) => {
    const result = await pause({ data: { clientId, paused: next } });
    if (!result.ok) {
      setNote("Could not update the chat.");
      return;
    }
    setPaused(result.paused);
    setNote(next ? "Buddy is paused on this chat." : "Buddy will pick this chat up again.");
  };

  if (!ready) return null;

  return (
    <section
      style={{
        marginTop: 12,
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--white-muted)",
        }}
      >
        Buddy memory
      </div>
      <p style={{ color: "var(--white-muted)", fontSize: 13, lineHeight: 1.5, margin: "8px 0 0" }}>
        Everyday notes Buddy stored for this chat. Health details are not kept here.
      </p>
      {facts.length === 0 ? (
        <p style={{ color: "var(--white)", fontSize: 14, marginTop: 10 }}>Nothing stored.</p>
      ) : (
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "var(--white)" }}>
          {facts.map((fact) => (
            <li key={fact.id} style={{ marginBottom: 8 }}>
              {fact.fact}{" "}
              <button type="button" onClick={() => onForget(fact.id)} style={linkBtn}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {facts.length > 0 ? (
          <button type="button" onClick={() => onForget()} style={btn}>
            Clear memory
          </button>
        ) : null}
        <button type="button" onClick={() => onPause(!paused)} style={btn}>
          {paused ? "Hand back to Buddy" : "Pause Buddy"}
        </button>
      </div>
      {note ? <p style={{ color: "var(--white-muted)", fontSize: 13, marginTop: 8 }}>{note}</p> : null}
    </section>
  );
}

const btn: CSSProperties = {
  background: "transparent",
  color: "var(--white)",
  border: "1px solid var(--navy-border)",
  borderRadius: 999,
  padding: "8px 12px",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  cursor: "pointer",
};

const linkBtn: CSSProperties = {
  background: "transparent",
  color: "var(--blue-accent)",
  border: "none",
  padding: 0,
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
};
