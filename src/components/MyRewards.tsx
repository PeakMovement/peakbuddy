import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Gift, MapPin } from "lucide-react";
import { listMyRewards, type IssuedReward } from "@/lib/rewards.functions";

/** Client-facing earned vouchers (Stage 3). Renders nothing if none earned. */
export function MyRewards() {
  const [rewards, setRewards] = useState<IssuedReward[]>([]);

  useEffect(() => {
    (async () => {
      try {
        setRewards(await listMyRewards());
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  if (rewards.length === 0) return null;

  return (
    <div style={{ width: "100%", maxWidth: 420, marginTop: 16 }}>
      <div style={titleStyle}>Your rewards</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        {rewards.map((r) => {
          const rw = r.reward;
          if (!rw) return null;
          return (
            <div key={r.id} style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Gift size={18} color="var(--blue-accent)" aria-hidden />
                <div style={{ color: "var(--white)", fontFamily: "var(--font-ui)", fontWeight: 600 }}>
                  {rw.name}
                </div>
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
            </div>
          );
        })}
      </div>
    </div>
  );
}

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--white-muted)",
};
const cardStyle: CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 14,
  padding: 14,
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
