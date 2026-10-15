import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adherenceVersusCompliance, wearableAssociationSentence } from "@/lib/capabilities";
import { getClientCapabilityPanel, type ClientPanel } from "@/lib/capability-views.functions";
import { buildLoadInsight, type CheckInDay, type WearableDay } from "@/lib/load-metrics";

type Check = CheckInDay & {
  exercise_adherence?: "all" | "most" | "some" | "none" | null;
};

/**
 * Practitioner client page only. Risk is a change from this patient's baseline.
 * Wearable text is an association. Recovery is this practice's own history.
 */
export function ClientBetweenSessions({
  clientId,
  checkins,
  sessions,
}: {
  clientId: string;
  checkins: Check[];
  sessions: WearableDay[];
}) {
  const loadPanel = useServerFn(getClientCapabilityPanel);
  const [panel, setPanel] = useState<ClientPanel | null>(null);

  useEffect(() => {
    let live = true;
    loadPanel({ data: { clientId } })
      .then((next) => {
        if (live) setPanel(next);
      })
      .catch(() => {
        if (live) setPanel(null);
      });
    return () => {
      live = false;
    };
  }, [clientId, loadPanel]);

  const adherence = adherenceVersusCompliance({
    expectedCheckins: Math.max(checkins.length, 1),
    answered: checkins.length,
    adherence: checkins.map((c) => c.exercise_adherence ?? null),
  });
  const pains = checkins.map((c) => c.pain_level).filter((n): n is number => typeof n === "number");
  const loadInsight = buildLoadInsight(sessions, checkins, sessions.length > 0);
  const association = wearableAssociationSentence({
    acuteChronicRatio: loadInsight.metrics.acwr,
    sleepScore: sessions.find((s) => typeof s.sleep_score === "number")?.sleep_score ?? null,
    painNow: pains[0] ?? null,
    painPrev: pains[1] ?? null,
  });

  return (
    <section
      style={{
        marginTop: 16,
        padding: 14,
        borderRadius: 12,
        border: "1px solid var(--navy-border)",
        background: "var(--navy-card)",
        display: "grid",
        gap: 8,
        fontSize: 14,
        lineHeight: 1.45,
      }}
    >
      <strong>Between sessions</strong>
      <p style={{ margin: 0 }}>{panel?.risk?.headline ?? "No nightly risk score yet."}</p>
      {panel?.risk?.detail ? <p style={{ margin: 0 }}>{panel.risk.detail}</p> : null}
      <p style={{ margin: 0 }}>
        Check-in replies: {adherence.compliancePct == null ? "n/a" : `${adherence.compliancePct}%`}.{" "}
        {adherence.adherenceLabel} {adherence.caveat}
      </p>
      {association ? <p style={{ margin: 0 }}>{association}</p> : null}
      {panel?.recovery ? <p style={{ margin: 0 }}>{panel.recovery}</p> : null}
      {panel?.goal ? <p style={{ margin: 0 }}>Goal: {panel.goal}</p> : null}
      {panel?.media?.length ? (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {panel.media.map((m) => (
            <li key={m.id}>
              {m.kind}
              {m.caption ? `: ${m.caption}` : ""} ({m.created_at.slice(0, 10)})
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
