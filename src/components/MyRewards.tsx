import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Gift, MapPin } from "lucide-react";
import { listMyRewards, redeemMyReward, type IssuedReward } from "@/lib/rewards.functions";

const SEEN_KEY = "buddy.rewards.seen.v1";

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveSeen(set: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore */
  }
}

/** Read-only helper used by other surfaces to show an unseen-rewards badge. */
export function useUnseenRewardCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    (async () => {
      try {
        const rewards = await listMyRewards();
        const seen = loadSeen();
        setCount(rewards.filter((r) => !seen.has(r.id)).length);
      } catch {
        /* non-fatal */
      }
    })();
  }, []);
  return count;
}

/** Client-facing earned vouchers. Renders an empty-state if none earned. */
export function MyRewards() {
  const [rewards, setRewards] = useState<IssuedReward[] | null>(null);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [redeemed, setRedeemed] = useState<Set<string>>(new Set());
  const markUsed = async (id: string) => {
    // Optimistic — remove from the list immediately; restore only if the
    // server call actually fails.
    const prevRewards = rewards;
    setRewards((list) => (list ? list.filter((r) => r.id !== id) : list));
    setRedeemed((prev) => new Set(prev).add(id));
    try {
      await redeemMyReward({ data: { id } });
    } catch {
      setRewards(prevRewards);
      setRedeemed((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const list = await listMyRewards();
        const seen = loadSeen();
        const unseen = new Set(list.filter((r) => !seen.has(r.id)).map((r) => r.id));
        setNewIds(unseen);
        setRewards(list);
        // Mark as seen so the badge clears next visit.
        const next = new Set(seen);
        list.forEach((r) => next.add(r.id));
        // Defer marking-as-seen so an unseen-count badge reading on the same
        // render still reflects this session; it clears on the next visit.
        window.setTimeout(() => saveSeen(next), 1500);
      } catch {
        setRewards([]);
      }
    })();
  }, []);

  if (rewards === null) return null;

  if (rewards.length === 0) {
    return (
      <div style={{ marginTop: 8 }}>
        <div style={emptyStyle}>
          <Gift size={16} color="var(--white-muted)" aria-hidden />
          <span>No rewards yet. Keep checking in to earn vouchers.</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
      {rewards.map((r) => {
        const rw = r.reward;
        if (!rw) return null;
        const isNew = newIds.has(r.id);
        return (
          <div key={r.id} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Gift size={18} color="var(--blue-accent)" aria-hidden />
              <div style={{ color: "var(--white)", fontFamily: "var(--font-ui)", fontWeight: 600 }}>
                {rw.name}
              </div>
              {isNew && <span style={newBadge}>NEW</span>}
            </div>
            {rw.description && (
              <div style={{ color: "var(--white-muted)", fontSize: 12, marginTop: 6 }}>
                {rw.description}
              </div>
            )}
            <div style={codeStyle}>{rw.voucher_code}</div>
            {rw.maps_url && (
              <a href={rw.maps_url} target="_blank" rel="noreferrer" style={mapLink}>
                <MapPin size={14} />
                Get directions
              </a>
            )}
            {r.status === "redeemed" || redeemed.has(r.id) ? (
              <div style={usedTag}>Used</div>
            ) : (
              <button type="button" onClick={() => markUsed(r.id)} style={usedBtn}>
                Mark as used
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

const cardStyle: CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: 14,
};
const emptyStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "var(--navy-card)",
  border: "1px dashed var(--navy-border)",
  borderRadius: 12,
  padding: "12px 14px",
  color: "var(--white-muted)",
  fontSize: 13,
  fontFamily: "var(--font-ui)",
};
const newBadge: CSSProperties = {
  marginLeft: "auto",
  background: "var(--blue-accent)",
  color: "var(--navy-deep, #04111f)",
  fontSize: 10,
  fontWeight: 800,
  padding: "2px 8px",
  borderRadius: 999,
  letterSpacing: "0.08em",
};
const codeStyle: CSSProperties = {
  marginTop: 10,
  fontFamily: "var(--font-data)",
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: "0.12em",
  color: "var(--blue-accent)",
  background: "rgba(0,0,0,0.25)",
  borderRadius: 8,
  padding: "8px 12px",
  textAlign: "center",
};
const usedBtn: CSSProperties = {
  marginTop: 10,
  display: "block",
  width: "100%",
  minHeight: 38,
  background: "transparent",
  color: "var(--white-muted)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};
const usedTag: CSSProperties = {
  marginTop: 10,
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--green)",
};
const mapLink: CSSProperties = {
  marginTop: 10,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: "var(--white)",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  textDecoration: "none",
};
