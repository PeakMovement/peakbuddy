import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BellOff } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabase";
import type { Alert, Client } from "@/lib/types";
import { SkeletonList, ErrorCard, EmptyState } from "@/components/UIStates";
import { log } from "@/lib/log";
import { setAlertOutcome, getYvesAccuracy } from "@/lib/alert-outcome.functions";
import { getGradingMode, type GradingMode } from "@/lib/grading.functions";

type Outcome = "confirmed" | "false_alarm" | "already_aware";
const OUTCOME_LABEL: Record<Outcome, string> = {
  confirmed: "Real concern",
  false_alarm: "False alarm",
  already_aware: "Already aware",
};


export const Route = createFileRoute("/practitioner/app/alerts")({
  head: () => ({ meta: [{ title: "Alerts — Buddy" }] }),
  component: Alerts,
});

type Filter = "all" | "unread" | "red_flag";

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function urgencyStyle(u: string): React.CSSProperties {
  switch (u) {
    case "emergency":
      return { background: "var(--red)", color: "var(--white)", border: "1px solid var(--red)" };
    case "urgent":
      return { background: "transparent", color: "var(--red)", border: "1px solid var(--red)" };
    case "soon":
      return { background: "transparent", color: "var(--amber)", border: "1px solid var(--amber)" };
    case "monitor":
      return {
        background: "transparent",
        color: "var(--blue-cold)",
        border: "1px solid var(--blue-cold)",
      };
    default:
      return {
        background: "transparent",
        color: "var(--white-muted)",
        border: "1px solid var(--navy-border)",
      };
  }
}

function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [clients, setClients] = useState<Record<string, Client>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<{
    confirmed: number;
    false_alarm: number;
    already_aware: number;
  } | null>(null);
  const [gradingMode, setGradingModeState] = useState<GradingMode>("super_admin_only");
  const setOutcomeFn = useServerFn(setAlertOutcome);
  const getAccuracyFn = useServerFn(getYvesAccuracy);
  const getModeFn = useServerFn(getGradingMode);

  const refreshAccuracy = async () => {
    try {
      setAccuracy(await getAccuracyFn());
    } catch (e) {
      log.error(e);
    }
  };

  const submitOutcome = async (id: string, outcome: Outcome | null) => {
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === id
          ? ({
              ...a,
              outcome,
              outcome_at: outcome ? new Date().toISOString() : null,
            } as Alert)
          : a,
      ),
    );
    try {
      await setOutcomeFn({ data: { alertId: id, outcome } });
      refreshAccuracy();
    } catch (e) {
      log.error(e);
    }
  };


  const load = async () => {
    setError(null);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const [{ data: a, error: aErr }, { data: c, error: cErr }] = await Promise.all([
        supabase
          .from("alerts")
          .select("*")
          .eq("practitioner_id", u.user.id)
          .order("created_at", { ascending: false }),
        supabase.from("clients").select("*").eq("practitioner_id", u.user.id),
      ]);
      if (aErr || cErr) throw aErr || cErr;
      setAlerts((a as Alert[]) ?? []);
      const map: Record<string, Client> = {};
      ((c as Client[]) ?? []).forEach((cl) => (map[cl.id] = cl));
      setClients(map);
    } catch (e) {
      log.error(e);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    refreshAccuracy();
    (async () => {
      try {
        const r = await getModeFn();
        setGradingModeState(r.mode);
      } catch (e) {
        log.error(e);
      }
    })();
  }, []);


  const filtered = useMemo(() => {
    const sorted = [...alerts].sort((a, b) => {
      if (a.is_read !== b.is_read) return a.is_read ? 1 : -1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    if (filter === "unread") return sorted.filter((a) => !a.is_read);
    if (filter === "red_flag")
      return sorted.filter((a) => a.urgency === "emergency" || a.urgency === "urgent");
    return sorted;
  }, [alerts, filter]);

  const markResolved = async (id: string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, is_read: true } : a)));
    await supabase.from("alerts").update({ is_read: true }).eq("id", id);
  };

  const submitAssessment = async (id: string, assessment: "correct" | "over" | "under") => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? ({ ...a, practitioner_assessment: assessment } as Alert) : a)),
    );
    await supabase.from("alerts").update({ practitioner_assessment: assessment }).eq("id", id);
  };

  const categoryLabel = (cat: string | null | undefined) => {
    if (!cat) return null;
    return cat.replace(/_/g, " ");
  };

  const patternLabel = (p: string | null | undefined) => {
    if (!p) return null;
    switch (p) {
      case "rising_pain":
        return "Rising pain trend";
      case "recurring_category":
        return "Recurring red flag";
      case "repeated_moderate":
        return "Repeated moderate symptoms";
      default:
        return p.replace(/_/g, " ");
    }
  };

  return (
    <div style={{ padding: "20px 16px 32px" }}>
      <h1
        style={{
          fontFamily: "var(--font-hero)",
          fontWeight: 400,
          fontSize: 28,
          color: "var(--white)",
        }}
      >
        Alerts
      </h1>

      <div
        style={{
          marginTop: 12,
          padding: "10px 12px",
          borderRadius: 10,
          background: "var(--navy-card)",
          border: "1px solid var(--navy-border)",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          color: "var(--white-muted)",
        }}
      >
        {(() => {
          if (!accuracy) return "Yves accuracy: loading";
          const denom = accuracy.confirmed + accuracy.false_alarm;
          if (denom === 0) return "Yves accuracy: not enough data yet";
          const pct = Math.round((accuracy.confirmed / denom) * 100);
          return `Yves accuracy: ${pct}% confirmed`;
        })()}
      </div>


      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        {(["all", "unread", "red_flag"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            style={{
              flex: 1,
              padding: "8px 4px",
              borderRadius: 8,
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              background: filter === f ? "var(--blue-accent)" : "transparent",
              color: filter === f ? "var(--white)" : "var(--white-muted)",
              border: `1px solid ${filter === f ? "var(--blue-accent)" : "var(--navy-border)"}`,
              textTransform: "capitalize",
            }}
          >
            {f === "red_flag" ? "Red Flag" : f}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ marginTop: 24 }}>
          <SkeletonList count={3} height={96} />
        </div>
      ) : error ? (
        <div style={{ marginTop: 24 }}>
          <ErrorCard message={error} onRetry={load} />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ marginTop: 24 }}>
          <EmptyState Icon={BellOff} title="No alerts" subtitle="Your clients are all clear." />
        </div>
      ) : (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((a) => {
            const client = clients[a.client_id];
            return (
              <div
                key={a.id}
                style={{
                  background: "var(--navy-card)",
                  border: "1px solid var(--navy-border)",
                  borderRadius: 12,
                  padding: 14,
                  opacity: a.is_read ? 0.55 : 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontWeight: 700,
                        color: "var(--white)",
                      }}
                    >
                      {client?.full_name ?? "Unknown client"}
                    </div>
                    <div style={{ marginTop: 4, color: "var(--white-muted)", fontSize: 13 }}>
                      {a.message}
                    </div>
                    {(categoryLabel(a.red_flag_category) || patternLabel(a.pattern)) && (
                      <div
                        style={{
                          marginTop: 6,
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 6,
                        }}
                      >
                        {categoryLabel(a.red_flag_category) && (
                          <span
                            style={{
                              fontSize: 10,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: "var(--navy-deep, rgba(0,0,0,0.25))",
                              color: "var(--white-muted)",
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              fontFamily: "var(--font-ui)",
                            }}
                          >
                            {categoryLabel(a.red_flag_category)}
                          </span>
                        )}
                        {patternLabel(a.pattern) && (
                          <span
                            style={{
                              fontSize: 10,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: "var(--amber, #f9a825)",
                              color: "var(--navy)",
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                              fontFamily: "var(--font-ui)",
                              fontWeight: 700,
                            }}
                          >
                            {patternLabel(a.pattern)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <span
                    style={{
                      ...urgencyStyle(a.urgency),
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                      fontFamily: "var(--font-ui)",
                    }}
                  >
                    {a.urgency}
                  </span>
                </div>
                <div
                  style={{
                    marginTop: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-data)",
                      fontSize: 11,
                      color: "var(--white-muted)",
                    }}
                  >
                    {timeAgo(a.created_at)} ago
                  </span>
                  {!a.is_read && (
                    <button
                      type="button"
                      onClick={() => markResolved(a.id)}
                      style={{
                        background: "transparent",
                        color: "var(--blue-accent)",
                        border: "1px solid var(--blue-accent)",
                        padding: "6px 12px",
                        borderRadius: 6,
                        fontFamily: "var(--font-ui)",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      Mark resolved
                    </button>
                  )}
                </div>
                {a.is_read && (
                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: "1px solid var(--navy-border)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: 11, color: "var(--white-muted)" }}>
                      Was this alert right?
                    </span>
                    {(["correct", "over", "under"] as const).map((opt) => {
                      const active = a.practitioner_assessment === opt;
                      const label =
                        opt === "correct"
                          ? "Spot on"
                          : opt === "over"
                            ? "Too alarming"
                            : "Should have been higher";
                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => submitAssessment(a.id, opt)}
                          style={{
                            background: active ? "var(--blue-accent)" : "transparent",
                            color: active ? "var(--white)" : "var(--white-muted)",
                            border: `1px solid ${active ? "var(--blue-accent)" : "var(--navy-border)"}`,
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontFamily: "var(--font-ui)",
                            cursor: "pointer",
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 10,
                    borderTop: "1px solid var(--navy-border)",
                  }}
                >
                  {a.outcome ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        fontFamily: "var(--font-ui)",
                        fontSize: 12,
                        color: "var(--white-muted)",
                      }}
                    >
                      <span>Marked as {OUTCOME_LABEL[a.outcome]}. Thanks.</span>
                      <button
                        type="button"
                        onClick={() => submitOutcome(a.id, null)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "var(--blue-accent)",
                          fontFamily: "var(--font-ui)",
                          fontSize: 12,
                          cursor: "pointer",
                          padding: 0,
                          textDecoration: "underline",
                        }}
                      >
                        change
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {(["confirmed", "false_alarm", "already_aware"] as Outcome[]).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => submitOutcome(a.id, opt)}
                          style={{
                            flex: "1 1 0",
                            minHeight: 44,
                            padding: "10px 12px",
                            background: "transparent",
                            color: "var(--white-muted)",
                            border: "1px solid var(--navy-border)",
                            borderRadius: 8,
                            fontFamily: "var(--font-ui)",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          {OUTCOME_LABEL[opt]}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

            );
          })}
        </div>
      )}
    </div>
  );
}
