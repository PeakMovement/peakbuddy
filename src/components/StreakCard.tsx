import type { CSSProperties } from "react";
import { Flame, Lock, Trophy } from "lucide-react";
import { STREAK_MILESTONES, type StreakResult } from "@/lib/streak";

/**
 * Client-facing check-in streak card. Frequency-aware: "as_needed" clients see
 * their total check-ins instead of a streak. Visual only — real rewards are
 * handled by the rewards engine.
 */
export function StreakCard({ streak }: { streak: StreakResult | null }) {
  if (!streak) return null;

  if (streak.isAsNeeded) {
    return (
      <div style={cardStyle}>
        <div style={rowStyle}>
          <Flame size={24} color="var(--blue-accent)" aria-hidden />
          <div>
            <div style={bigNum}>{streak.total}</div>
            <div style={subLabel}>check-ins logged</div>
          </div>
        </div>
      </div>
    );
  }

  const alive = streak.current > 0;
  return (
    <div style={cardStyle}>
      <div style={{ ...rowStyle, justifyContent: "space-between" }}>
        <div style={rowStyle}>
          <Flame
            size={28}
            color={alive ? "var(--blue-accent)" : "var(--white-muted)"}
            aria-hidden
          />
          <div>
            <div style={bigNum}>{streak.current}</div>
            <div style={subLabel}>check-in streak</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={smallStat}>Best {streak.longest}</div>
          <div style={smallStat}>{streak.total} total</div>
        </div>
      </div>

      {STREAK_MILESTONES.includes(streak.current) && (
        <div style={celebrate}>
          <Trophy size={15} aria-hidden /> You hit a {streak.current} check-in milestone. Keep it going!
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {STREAK_MILESTONES.map((m) => {
          const unlocked = streak.unlockedMilestones.includes(m);
          return (
            <div
              key={m}
              style={badgeStyle(unlocked)}
              aria-label={`${m} check-in streak badge, ${unlocked ? "unlocked" : "locked"}`}
            >
              {unlocked ? m : <Lock size={12} aria-hidden />}
            </div>
          );
        })}
      </div>

      {streak.nextMilestone && alive && (
        <div style={{ ...subLabel, marginTop: 10 }}>
          {streak.nextMilestone - streak.current} more to your next badge
        </div>
      )}
    </div>
  );
}

const cardStyle: CSSProperties = {
  width: "100%",
  maxWidth: 420,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 16,
  padding: 16,
};
const rowStyle: CSSProperties = { display: "flex", alignItems: "center", gap: 10 };
const bigNum: CSSProperties = {
  fontFamily: "var(--font-data)",
  fontSize: 34,
  fontWeight: 700,
  lineHeight: 1,
  color: "var(--white)",
};
const celebrate: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginTop: 12,
  padding: "10px 12px",
  borderRadius: 10,
  background: "rgba(74,141,240,0.12)",
  border: "1px solid rgba(74,141,240,0.4)",
  color: "var(--white)",
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 13.5,
};
const subLabel: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  letterSpacing: "0.04em",
  color: "var(--white-muted)",
};
const smallStat: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  color: "var(--white-muted)",
  marginBottom: 2,
};
function badgeStyle(unlocked: boolean): CSSProperties {
  return {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "var(--font-data)",
    fontWeight: 700,
    fontSize: 14,
    color: unlocked ? "var(--white)" : "var(--white-muted)",
    background: unlocked ? "var(--blue-accent)" : "transparent",
    border: unlocked ? "1px solid var(--blue-accent)" : "1px solid rgba(255,255,255,0.12)",
  };
}
