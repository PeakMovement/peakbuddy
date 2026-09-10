import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRightLeft } from "lucide-react";
import { getMyPractice, transferClient } from "@/lib/practice-members.functions";

/**
 * "Transfer to a colleague" — moves this client to another practitioner in the
 * same practice. Renders nothing for individual practices / practices with no
 * other members. On success, calls onTransferred so the parent can refresh.
 */
export function TransferClientButton({
  clientId,
  currentPractitionerId,
  onTransferred,
}: {
  clientId: string;
  currentPractitionerId?: string | null;
  onTransferred?: () => void;
}) {
  const load = useServerFn(getMyPractice);
  const transfer = useServerFn(transferClient);
  const [colleagues, setColleagues] = useState<{ userId: string; name: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((r) => {
        if (cancelled || !r || !r.inPractice || r.practiceType !== "group") return;
        // Owner gets the full roster; a member only sees names via the roster if
        // they're the owner. For members, the picker is still useful once the
        // owner list is available; here we only show colleagues the server returned.
        const list = (r.members ?? [])
          .filter((m) => m.userId !== currentPractitionerId)
          .map((m) => ({ userId: m.userId, name: m.name }));
        setColleagues(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [load, currentPractitionerId]);

  if (colleagues.length === 0) return null;

  const doTransfer = async (toUserId: string, name: string) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await transfer({ data: { clientId, toUserId } });
      if (r.ok) {
        setMsg(`Transferred to ${name}.`);
        setOpen(false);
        onTransferred?.();
      } else {
        setMsg(r.error);
      }
    } catch {
      setMsg("Couldn't transfer this client. Try again.");
    }
    setBusy(false);
  };

  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={btn} aria-expanded={open}>
        <ArrowRightLeft size={15} aria-hidden /> Transfer to a colleague
      </button>
      {open && (
        <div style={panel}>
          {colleagues.map((c) => (
            <button
              key={c.userId}
              type="button"
              disabled={busy}
              onClick={() => doTransfer(c.userId, c.name)}
              style={row}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      {msg && <div style={{ ...note, color: msg.startsWith("Transferred") ? "var(--green)" : "var(--red)" }}>{msg}</div>}
    </div>
  );
}

export default TransferClientButton;

const btn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  background: "transparent",
  border: "1px solid var(--navy-border)",
  color: "var(--blue-accent)",
  borderRadius: 10,
  padding: "8px 12px",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const panel: CSSProperties = {
  marginTop: 8,
  border: "1px solid var(--navy-border)",
  borderRadius: 10,
  overflow: "hidden",
  background: "var(--navy)",
};
const row: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  color: "var(--white)",
  fontFamily: "var(--font-ui)",
  fontSize: 14,
  cursor: "pointer",
};
const note: CSSProperties = { marginTop: 8, fontFamily: "var(--font-ui)", fontSize: 13 };
