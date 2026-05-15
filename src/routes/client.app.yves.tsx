import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  getClientId,
  RED_FLAG_TERMS_YVES,
  containsRedFlag,
} from "@/lib/client-session";
import { fireAlertWebhook, fireContactWebhook, findRecentOpenAlert } from "@/lib/webhooks";
import type { Client, SymptomQuery, Urgency } from "@/lib/types";

export const Route = createFileRoute("/client/app/yves")({
  component: YvesScreen,
});

const URGENCY_COLOR: Record<Urgency, string> = {
  emergency: "var(--red)",
  urgent: "var(--red)",
  soon: "var(--amber)",
  monitor: "var(--blue-cold)",
  routine: "var(--green)",
};

function YvesScreen() {
  const [client, setClient] = useState<Client | null>(null);
  const [history, setHistory] = useState<SymptomQuery[]>([]);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SymptomQuery | null>(null);
  const [contacting, setContacting] = useState(false);
  const [contacted, setContacted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = getClientId();
    if (!id) return;
    (async () => {
      const [{ data: c }, { data: q }] = await Promise.all([
        supabase.from("clients").select("*").eq("id", id).maybeSingle(),
        supabase
          .from("symptom_queries")
          .select("*")
          .eq("client_id", id)
          .order("created_at", { ascending: false }),
      ]);
      setClient(c as Client | null);
      setHistory((q as SymptomQuery[]) ?? []);
    })();
  }, []);

  const analyse = async () => {
    if (!client || text.trim().length < 3) return;
    setError(null);
    setSubmitting(true);

    const redFlag = containsRedFlag(text, RED_FLAG_TERMS_YVES);
    const urgency: Urgency = redFlag ? "emergency" : "monitor";
    const next = redFlag
      ? "Call 112 or go to your nearest emergency department immediately."
      : "Monitor your symptoms and contact your practitioner if they worsen.";

    const { data: inserted, error: insErr } = await supabase
      .from("symptom_queries")
      .insert({
        client_id: client.id,
        practitioner_id: client.practitioner_id,
        query_text: text.trim(),
        urgency,
        red_flag_detected: redFlag,
        suggested_next_step: next,
        ai_rationale: "Keyword screening only.",
        severity: redFlag ? 5 : 1,
        source: "keyword_only",
      })
      .select("*")
      .maybeSingle();

    if (insErr || !inserted) {
      setSubmitting(false);
      setError(insErr?.message ?? "Could not submit. Try again.");
      return;
    }

    if (redFlag) {
      const existing = await findRecentOpenAlert(client.id, "yves_red_flag");

      if (!existing) {
        const { data: alertRow } = await supabase
          .from("alerts")
          .insert({
            practitioner_id: client.practitioner_id,
            client_id: client.id,
            alert_type: "yves_red_flag",
            urgency: "urgent",
            message: `Red flag in symptom query: "${text.trim().slice(0, 200)}"`,
          })
          .select("id")
          .maybeSingle();

        const result = await fireAlertWebhook({
          practitionerId: client.practitioner_id,
          clientName: client.full_name,
          clientId: client.id,
          alertMessage: `Red flag in symptom query: "${text.trim().slice(0, 200)}"`,
          urgency,
          redFlagDetected: true,
        });

        if (result.fired && alertRow?.id) {
          await supabase
            .from("alerts")
            .update({ webhook_fired: true })
            .eq("id", (alertRow as { id: string }).id);
        }
      } else {
        console.log("[Buddy] Duplicate alert suppressed for client:", client.id);
      }
    }

    setResult(inserted as SymptomQuery);
    setHistory((h) => [inserted as SymptomQuery, ...h]);
    setText("");
    setSubmitting(false);
  };

  return (
    <div style={{ padding: "24px 20px 32px" }}>
      <h1 style={{ fontFamily: "var(--font-hero)", fontWeight: 400, fontSize: 26, color: "var(--white)" }}>
        Tell Yves how you're feeling
      </h1>
      <p style={{ marginTop: 8, color: "var(--white-muted)", fontSize: 14 }}>
        Describe your symptoms and Yves will help assess what to do next.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        maxLength={2000}
        placeholder="e.g. I have had a sharp pain in my lower back for 3 days that gets worse when I sit..."
        style={{
          width: "100%",
          marginTop: 16,
          background: "var(--navy-card)",
          border: "1px solid var(--navy-border)",
          color: "var(--white)",
          borderRadius: 8,
          padding: 12,
          fontFamily: "var(--font-ui)",
          fontSize: 14,
          resize: "vertical",
          outline: "none",
        }}
      />

      {error && <p style={{ color: "var(--red)", marginTop: 12, fontSize: 13 }}>{error}</p>}

      <button
        type="button"
        onClick={analyse}
        disabled={submitting || text.trim().length < 3}
        style={{
          marginTop: 16,
          width: "100%",
          minHeight: 48,
          borderRadius: 8,
          background: "var(--blue-accent)",
          color: "var(--white)",
          border: "none",
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: 16,
          opacity: submitting || text.trim().length < 3 ? 0.6 : 1,
        }}
      >
        {submitting ? "Analysing…" : "Analyse"}
      </button>

      {result && (
        <div
          style={{
            marginTop: 24,
            background: "var(--navy-card)",
            border: "1px solid var(--navy-border)",
            borderLeft: `4px solid ${URGENCY_COLOR[result.urgency as Urgency] ?? "var(--blue-cold)"}`,
            borderRadius: 12,
            padding: 16,
          }}
        >
          <UrgencyBadge urgency={result.urgency as Urgency} />
          <p style={{ marginTop: 12, color: "var(--white)", fontSize: 15, lineHeight: 1.5 }}>
            {result.suggested_next_step}
          </p>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2
            style={{
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 12,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--white-muted)",
              marginBottom: 12,
            }}
          >
            Previous queries
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map((q) => (
              <div
                key={q.id}
                style={{
                  background: "var(--navy-card)",
                  border: "1px solid var(--navy-border)",
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-data)", fontSize: 11, color: "var(--white-muted)" }}>
                    {new Date(q.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </div>
                  <div
                    style={{
                      color: "var(--white)",
                      fontSize: 13,
                      marginTop: 4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {q.query_text}
                  </div>
                </div>
                <UrgencyBadge urgency={q.urgency as Urgency} small />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UrgencyBadge({ urgency, small = false }: { urgency: Urgency; small?: boolean }) {
  return (
    <span
      style={{
        background: URGENCY_COLOR[urgency],
        color: "var(--white)",
        fontSize: small ? 10 : 11,
        padding: small ? "3px 8px" : "4px 10px",
        borderRadius: 999,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {urgency}
    </span>
  );
}
