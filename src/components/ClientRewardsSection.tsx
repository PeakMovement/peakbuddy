import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import {
  approveClientReward,
  listClientRewards,
  type IssuedReward,
} from "@/lib/rewards.functions";

/**
 * Practitioner-facing rewards panel on the client detail screen.
 * "Approve reward" issues a random active reward (Stage 2 rules).
 */
export function ClientRewardsSection({ clientId }: { clientId: string }) {
  const [rewards, setRewards] = useState<IssuedReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      setRewards(await listClientRewards({ data: { clientId } }));
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [clientId]);

  const approve = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const issued = await approveClientReward({ data: { clientId } });
      setMsg(`Reward issued: ${issued.reward?.name ?? "voucher"}`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not issue reward");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ marginTop: 28 }}>
      <div style={titleStyle}>Rewards</div>
      <p style={{ color: "var(--white-muted)", fontSize: 12, marginTop: 4 }}>
        Confirm this client completed their advised check-ins to issue a reward voucher.
      </p>
      <button type="button" onClick={approve} disabled={busy} style={approveBtn}>
        <Gift size={16} />
        {busy ? "Issuing…" : "Approve reward"}
      </button>
      {msg && <div style={{ color: "var(--green)", fontSize: 13, marginTop: 8 }}>{msg}</div>}
      {err && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>{err}</div>}

      {!loading && rewards.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {rewards.map((r) => (
            <div key={r.id} style={rowStyle}>
              <span style={{ color: "var(--white)", fontFamily: "var(--font-ui)", fontSize: 13 }}>
                {r.reward?.name ?? "Voucher"}
              </span>
              <span
                style={{ color: "var(--white-muted)", fontFamily: "var(--font-data)", fontSize: 12 }}
              >
                {new Date(r.earned_at).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 700,
  color: "var(--white)",
  fontSize: 14,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};
const approveBtn: CSSProperties = {
  marginTop: 12,
  minHeight: 46,
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  background: "var(--blue-accent)",
  color: "var(--white)",
  border: "none",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 15,
  cursor: "pointer",
};
const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  padding: "10px 12px",
};
