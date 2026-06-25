import type { CSSProperties } from "react";
import { useState } from "react";
import { BellRing } from "lucide-react";
import { sendCheckInNudge } from "@/lib/push.functions";

/** Practitioner button: push the client a check-in reminder. */
export function RequestCheckInButton({ clientId }: { clientId: string }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await sendCheckInNudge({ data: { clientId } });
      setNote(
        r.ok
          ? "Check-in request sent."
          : r.reason === "no_account"
            ? "This client has not signed in yet, so they can't be notified."
            : "Could not send the request.",
      );
    } catch {
      setNote("Could not send the request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 20 }}>
      <button type="button" onClick={send} disabled={busy} style={btn}>
        <BellRing size={16} />
        {busy ? "Sending…" : "Request check-in"}
      </button>
      {note && <div style={{ color: "var(--white-muted)", fontSize: 12, marginTop: 6 }}>{note}</div>}
    </div>
  );
}

const btn: CSSProperties = {
  minHeight: 44,
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  background: "transparent",
  color: "var(--white)",
  border: "1px solid var(--blue-accent)",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};
