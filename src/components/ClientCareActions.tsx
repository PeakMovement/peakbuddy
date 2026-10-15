import { useState, type CSSProperties } from "react";
import { prepareClientCopy, setClientEpisode } from "@/lib/care-actions.functions";

/**
 * Discharge, reopen, and a copy of the record. Nothing is sent until the
 * physio confirms on this page.
 */
export function ClientCareActions({
  clientId,
  clientName,
  dischargedAt,
}: {
  clientId: string;
  clientName: string;
  dischargedAt?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [discharged, setDischarged] = useState(Boolean(dischargedAt));

  const discharge = async () => {
    const next = !discharged;
    const question = next
      ? `Stop reminders for ${clientName}? Their chart stays. If their WhatsApp window is open, they get one fixed line that check-ins are paused.`
      : `Open the episode again for ${clientName}? Messages can resume. Nothing is sent to them from this.`;
    if (!window.confirm(question)) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await setClientEpisode({ data: { clientId, discharged: next } });
      if (!r.ok) {
        setNote(r.reason === "off" ? "Discharge is not switched on yet." : "Could not save that.");
        return;
      }
      setDischarged(next);
      setNote(
        next
          ? r.told === "sent"
            ? "Reminders are off. They were told check-ins are paused."
            : r.told === "quiet"
              ? "Reminders are off. Nothing was sent, because their WhatsApp window is closed."
              : r.told === "failed"
                ? "Reminders are off. The pause note did not send."
                : "The episode is open again. Nothing was sent."
          : "The episode is open again. Nothing was sent.",
      );
    } catch {
      setNote("Could not save that.");
    } finally {
      setBusy(false);
    }
  };

  const prepare = async (send: boolean) => {
    if (send && !window.confirm(`Send ${clientName} a one-time link to their copy? You have reviewed it.`)) {
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const r = await prepareClientCopy({ data: { clientId, send } });
      if (!r.ok) {
        setNote(
          r.reason === "off"
            ? "Sending the copy is not switched on yet. Nothing was sent."
            : "Could not prepare the copy.",
        );
        return;
      }
      if (!r.sent) {
        const blob = new Blob([JSON.stringify(r.bundle, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "buddy-record.json";
        a.click();
        URL.revokeObjectURL(url);
        setNote(`Copy downloaded for you to review (${r.counts}). Nothing was sent.`);
        return;
      }
      setNote(r.note);
    } catch {
      setNote("Could not prepare the copy.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" disabled={busy} onClick={discharge} style={btn}>
          {discharged ? "Open the episode again" : "Discharge"}
        </button>
        <button type="button" disabled={busy} onClick={() => prepare(false)} style={btn}>
          Prepare a copy
        </button>
        <button type="button" disabled={busy} onClick={() => prepare(true)} style={btn}>
          Send the copy
        </button>
      </div>
      {discharged && (
        <div style={{ color: "var(--white-muted)", fontSize: 12 }}>
          Episode closed. Check-in reminders are off. The chart is still here.
        </div>
      )}
      {note && <div style={{ color: "var(--white-muted)", fontSize: 12 }}>{note}</div>}
    </div>
  );
}

const btn: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--white-muted)",
  background: "transparent",
  color: "var(--white)",
  cursor: "pointer",
};
