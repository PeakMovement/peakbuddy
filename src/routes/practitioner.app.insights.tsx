import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Sparkles, Send, X, AlertTriangle, Users, TrendingUp, TrendingDown, PhoneCall, Activity, Flame } from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  listMyDrafts,
  updateDraftStatus,
  type PractitionerDraft,
} from "@/lib/practitioner-drafts.functions";
import { log } from "@/lib/log";
import { InsightsOverview } from "@/components/InsightsOverview";

export const Route = createFileRoute("/practitioner/app/insights")({
  head: () => ({ meta: [{ title: "Insights — Buddy" }] }),
  component: Insights,
});

function Insights() {
  const [items, setItems] = useState<PractitionerDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await listMyDrafts();
      setItems(rows);
    } catch (e) {
      log.error(e);
      setError("Could not load insights.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const act = async (id: string, status: "sent" | "dismissed") => {
    setBusy(id);
    setError(null);
    try {
      await updateDraftStatus({ data: { id, status } });
      setItems((p) => p.filter((d) => d.id !== id));
    } catch (e) {
      log.error(e);
      setError("Action failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ padding: "24px 20px 32px", color: "var(--white)" }}>
      <h1 style={{ fontFamily: "var(--font-hero)", fontSize: 24, fontWeight: 400 }}>Insights</h1>
      <p style={{ marginTop: 6, color: "var(--white-muted)", fontSize: 13 }}>
        Drafted notes from nightly passive monitoring. Review, send to your records, or dismiss.
      </p>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 14,
            padding: 12,
            background: "color-mix(in oklab, var(--red) 18%, transparent)",
            border: "1px solid var(--red)",
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ marginTop: 20, color: "var(--white-muted)" }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ marginTop: 24, color: "var(--white-muted)" }}>
          No drafts right now. New insights appear here after the nightly risk run.
        </p>
      ) : (
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((d) => (
            <div
              key={d.id}
              style={{
                background: "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <strong style={{ fontSize: 15 }}>{d.client_name}</strong>
                {d.risk_score !== null && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: d.risk_score >= 60 ? "var(--red)" : "var(--navy)",
                      color: "var(--white)",
                      fontFamily: "var(--font-data)",
                    }}
                  >
                    <AlertTriangle size={12} /> Risk {d.risk_score}
                  </span>
                )}
              </div>
              <div
                style={{
                  marginTop: 10,
                  padding: 12,
                  background: "var(--navy)",
                  borderRadius: 10,
                  border: "1px solid var(--navy-border)",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Sparkles size={14} /> {d.draft_title}
                </div>
                <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45, color: "var(--white-muted)" }}>
                  {d.draft_body}
                </p>
                {d.suggested_action?.program_name && (
                  <p style={{ marginTop: 8, fontSize: 12, color: "var(--blue-accent)" }}>
                    Suggested program: {d.suggested_action.program_name}
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  onClick={() => act(d.id, "dismissed")}
                  disabled={busy === d.id}
                  style={{
                    flex: 1, minHeight: 44, borderRadius: 8,
                    background: "transparent",
                    border: "1px solid var(--navy-border)",
                    color: "var(--white)",
                    fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 14,
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                    cursor: "pointer", opacity: busy === d.id ? 0.5 : 1,
                  }}
                >
                  <X size={16} /> Dismiss
                </button>
                <button
                  onClick={() => act(d.id, "sent")}
                  disabled={busy === d.id}
                  style={{
                    flex: 2, minHeight: 44, borderRadius: 8,
                    background: "var(--blue-accent)",
                    border: "none", color: "var(--white)",
                    fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 14,
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                    cursor: "pointer", opacity: busy === d.id ? 0.5 : 1,
                  }}
                >
                  <Send size={16} /> Mark actioned
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
