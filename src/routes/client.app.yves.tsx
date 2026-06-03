import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { UserCheck, AlertTriangle, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getClientId } from "@/lib/client-session";
import { fireAlertWebhook, fireContactWebhook, findRecentOpenAlert } from "@/lib/webhooks";
import {
  analyzeRealTime,
  analyzeSymptom,
  type RealTimeResult,
  type TriageResult,
  type UrgencyTier,
} from "@/lib/yves";
import type { Client, SymptomQuery } from "@/lib/types";
import { CrosshairLogo } from "@/components/CrosshairLogo";

export const Route = createFileRoute("/client/app/yves")({
  component: YvesScreen,
});

const EXAMPLES = [
  "I have sharp pain in my lower back when I bend forward",
  "My neck feels stiff after sleeping and I can't turn my head",
  "I have been getting morning headaches every day this week",
  "My energy levels have been very low for the past two weeks",
  "I haven't been sleeping well and feel extremely stressed",
  "My foot has gone numb and I'm not sure why",
  "I feel dizzy every time I stand up",
  "I have lost weight without trying and feel exhausted",
];

const URGENCY_LABEL: Record<UrgencyTier, string> = {
  emergency: "EMERGENCY",
  urgent: "URGENT",
  soon: "SOON",
  monitor: "MONITOR",
  routine: "ROUTINE",
};

const BANNER_THEME: Record<UrgencyTier, { bg: string; border: string; text: string; heading: string }> = {
  emergency: { bg: "#1a0000", border: "#7a1e1e", text: "#ffb3b3", heading: "Medical Attention Recommended" },
  urgent:    { bg: "#1a0f00", border: "#7a4e1e", text: "#ffd28a", heading: "Medical Attention Recommended" },
  soon:      { bg: "#1a1400", border: "#7a701e", text: "#f5e58a", heading: "Follow-up Recommended" },
  monitor:   { bg: "#00101a", border: "#1e4a7a", text: "#9ec9ee", heading: "Keep an Eye On This" },
  routine:   { bg: "#001a08", border: "#1e7a3a", text: "#9eebc1", heading: "Routine Symptom" },
};

const REALTIME_THEME: Record<UrgencyTier, { bg: string; border: string; text: string; message: string }> = {
  emergency: { bg: "#1a0000", border: "#7a1e1e", text: "#ffb3b3", message: "⚠ This may need emergency attention — please act immediately" },
  urgent:    { bg: "#1a0f00", border: "#7a4e1e", text: "#ffd28a", message: "This may need prompt attention before your next appointment" },
  soon:      { bg: "#1a1400", border: "#7a701e", text: "#f5e58a", message: "These symptoms suggest a follow-up soon would be advisable" },
  monitor:   { bg: "#00101a", border: "#1e4a7a", text: "#9ec9ee", message: "Symptoms noted — worth discussing with your practitioner" },
  routine:   { bg: "#001a08", border: "#1e7a3a", text: "#9eebc1", message: "" },
};

type Stage = "input" | "loading" | "result";

const CLIENT_GENERIC_ERROR =
  "Something went wrong. Please try again or contact your practitioner directly if your symptoms are urgent.";

function YvesScreen() {
  const [client, setClient] = useState<Client | null>(null);
  const [practitionerName, setPractitionerName] = useState<string | null>(null);
  const [practiceYvesEnabled, setPracticeYvesEnabled] = useState<boolean>(true);
  const [history, setHistory] = useState<SymptomQuery[]>([]);
  const [text, setText] = useState("");
  const [stage, setStage] = useState<Stage>("input");
  const [result, setResult] = useState<TriageResult | null>(null);
  const [resultText, setResultText] = useState("");
  const [realTime, setRealTime] = useState<RealTimeResult | null>(null);
  const [contacting, setContacting] = useState(false);
  const [contacted, setContacted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exampleIdx, setExampleIdx] = useState(0);
  const [exampleVisible, setExampleVisible] = useState(true);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const debounceRef = useRef<number | null>(null);

  // Initial load — client, practitioner name, history
  useEffect(() => {
    const id = getClientId();
    if (!id) return;
    (async () => {
      const { data: c } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
      const cl = c as Client | null;
      setClient(cl);

      const [{ data: q }, profRes, pracRes] = await Promise.all([
        supabase
          .from("symptom_queries")
          .select("*")
          .eq("client_id", id)
          .order("created_at", { ascending: false })
          .limit(5)
          .then((r) => r),
        cl?.practitioner_id
          ? supabase
              .from("profiles")
              .select("full_name")
              .eq("id", cl.practitioner_id)
              .maybeSingle()
              .then((r) => r)
          : Promise.resolve({ data: null as { full_name: string } | null }),
        cl?.practitioner_id
          ? supabase
              .from("practices")
              .select("yves_enabled")
              .eq("practitioner_id", cl.practitioner_id)
              .maybeSingle()
              .then((r) => r)
          : Promise.resolve({ data: null as { yves_enabled: boolean } | null }),
      ]);
      setHistory(((q as SymptomQuery[] | null) ?? []) as SymptomQuery[]);
      setPractitionerName((profRes.data as { full_name: string } | null)?.full_name ?? null);
      const pe = (pracRes.data as { yves_enabled: boolean } | null)?.yves_enabled;
      setPracticeYvesEnabled(pe === false ? false : true);
    })();
  }, []);

  // Rotate example prompts every 4s with 0.3s fade
  useEffect(() => {
    const id = window.setInterval(() => {
      setExampleVisible(false);
      window.setTimeout(() => {
        setExampleIdx((i) => (i + 1) % EXAMPLES.length);
        setExampleVisible(true);
      }, 300);
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  // Real-time analysis on every keystroke, 300ms debounce
  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (!text.trim()) {
      setRealTime(null);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      const r = analyzeRealTime(text);
      setRealTime(r.detected ? r : null);
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [text]);

  const pName = practitionerName ?? "your practitioner";

  // Has the client been alerted in the last 24h via a red-flag symptom_query?
  const checkRecentRedFlagQuery = async (): Promise<boolean> => {
    if (!client) return false;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("symptom_queries")
      .select("id")
      .eq("client_id", client.id)
      .eq("red_flag_detected", true)
      .gte("created_at", since)
      .limit(1);
    return !!(data && data.length > 0);
  };

  const fireAlertForResult = async (triage: TriageResult, queryText: string) => {
    if (!client) return;
    const existingAlert = await findRecentOpenAlert(client.id, "yves_red_flag");
    if (existingAlert) return;

    let alertRowId: string | null = null;
    try {
      const { data, error: alertErr } = await supabase.rpc("insert_alert", {
        p_practitioner_id: client.practitioner_id,
        p_client_id: client.id,
        p_alert_type: "red_flag",
        p_message: `Red flag detected: ${queryText.slice(0, 100)}`,
        p_urgency: triage.urgency,
      });
      if (alertErr) throw alertErr;
      alertRowId = (data as string | null) ?? null;
    } catch (e) {
      console.error("[Yves] insert_alert failed:", e);
    }

    const fired = await fireAlertWebhook({
      practitionerId: client.practitioner_id,
      clientName: client.full_name,
      clientId: client.id,
      alertMessage: `Red flag in symptom query: "${queryText.slice(0, 200)}"`,
      urgency: triage.urgency,
      redFlagDetected: true,
    });

    if (fired.fired && alertRowId) {
      try {
        await supabase
          .from("alerts")
          .update({ webhook_fired: true })
          .eq("id", alertRowId);
      } catch (e) {
        console.warn("Alert webhook_fired update failed:", e);
      }
    }
  };

  const canUseYves =
    !!client?.practitioner_id && practiceYvesEnabled && client?.yves_enabled !== false;

  const accessBlockReason: string | null = !client
    ? null
    : !client.practitioner_id
      ? "Yves is unavailable. You aren't linked to a practitioner yet. Please contact your clinic."
      : !practiceYvesEnabled
        ? "Yves is currently unavailable through your practitioner. Please contact them if you'd like access."
        : client.yves_enabled === false
          ? "Your practitioner hasn't enabled Yves for your account. Reach out to them if you'd like access."
          : null;

  const submit = async () => {
    if (!client || text.trim().length < 3 || stage === "loading") return;
    if (!canUseYves) return;
    setError(null);
    setStage("loading");
    const queryText = text.trim();

    let triage: TriageResult;
    try {
      triage = await analyzeSymptom(queryText, undefined, pName, client.id);
    } catch (e) {
      console.error(e);
      setError(CLIENT_GENERIC_ERROR);
      setStage("input");
      return;
    }

    // Persist via security definer RPC (client portal has no auth.uid)
    let insertedId: string | null = null;
    try {
      const { data, error: insErr } = await supabase.rpc("insert_symptom_query", {
        p_client_id: client.id,
        p_practitioner_id: client.practitioner_id,
        p_query_text: queryText,
        p_urgency: triage.urgency,
        p_red_flag_detected: triage.red_flag_detected,
        p_suggested_next_step: triage.suggested_next_step,
        p_ai_rationale: triage.rationale,
        p_severity: triage.severity,
        p_source: triage.source,
      });
      if (insErr) throw insErr;
      insertedId = (data as string | null) ?? null;
    } catch (e) {
      console.error("[Yves] insert_symptom_query failed:", e);
      setError(CLIENT_GENERIC_ERROR);
    }

    // Duplicate prevention BEFORE alert
    if (triage.red_flag_detected) {
      try {
        const dup = await checkRecentRedFlagQuery();
        if (!dup) {
          await fireAlertForResult(triage, queryText);
        }
      } catch (e) {
        console.warn("Alert flow failed:", e);
      }
    }

    setResult(triage);
    setResultText(queryText);
    setContacted(false);
    if (insertedId) {
      setHistory((h) =>
        [
          {
            id: insertedId!,
            client_id: client.id,
            practitioner_id: client.practitioner_id,
            query_text: queryText,
            urgency: triage.urgency,
            red_flag_detected: triage.red_flag_detected,
            suggested_next_step: triage.suggested_next_step,
            ai_rationale: triage.rationale,
            severity: triage.severity,
            source: triage.source,
            created_at: new Date().toISOString(),
          } as SymptomQuery,
          ...h,
        ].slice(0, 5),
      );
    }
    setText("");
    setRealTime(null);
    setStage("result");
    if (triage.urgency === "emergency") setShowEmergencyModal(true);
  };

  const contactPractitioner = async (fromModal = false) => {
    if (!client || contacting || contacted) return;
    if (!result && !fromModal) return;
    setContacting(true);
    const dup = await checkRecentRedFlagQuery();
    // Even if duplicate, mark UI as "Notified" so the user gets feedback
    if (!dup) {
      await fireContactWebhook({
        practitionerId: client.practitioner_id,
        clientName: client.full_name,
        clientId: client.id,
        symptomDescription: result?.rationale ?? resultText ?? text.trim(),
        symptomScore: result?.severity ?? 0,
      });
    }
    setContacting(false);
    setContacted(true);
  };

  const realTimeContact = async () => {
    if (!client || contacted) return;
    setContacting(true);
    const dup = await checkRecentRedFlagQuery();
    if (!dup) {
      await fireContactWebhook({
        practitionerId: client.practitioner_id,
        clientName: client.full_name,
        clientId: client.id,
        symptomDescription: text.trim(),
        symptomScore: realTime?.severity ?? 0,
      });
    }
    setContacting(false);
    setContacted(true);
  };

  const askAnother = () => {
    setResult(null);
    setResultText("");
    setContacted(false);
    setStage("input");
  };

  const submitLabel = useMemo(() => {
    if (realTime && (realTime.urgency === "emergency" || realTime.urgency === "urgent")) {
      return "Get Emergency Guidance";
    }
    return "Analyse with Yves";
  }, [realTime]);

  // ---------- LOADING ----------
  if (stage === "loading") {
    return (
      <div
        style={{
          minHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 18,
        }}
      >
        <div style={{ animation: "buddy-pulse 1.6s ease-in-out infinite" }}>
          <CrosshairLogo />
        </div>
        <div style={{ fontFamily: "var(--font-hero)", fontSize: 20, color: "var(--white-muted)", textAlign: "center" }}>
          Yves is reviewing your symptoms…
        </div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--white-muted)" }}>
          This usually takes a few seconds
        </div>
      </div>
    );
  }

  // ---------- RESULT ----------
  if (stage === "result" && result) {
    const theme = BANNER_THEME[result.urgency];
    const showContact =
      result.should_notify_practitioner && !!client?.practitioner_id;
    const isEmergencyish = result.urgency === "emergency" || result.urgency === "urgent";
    const contactLabel = isEmergencyish
      ? `Contact ${pName} — urgent review needed`
      : `Notify ${pName} — symptoms noted`;

    return (
      <div style={{ padding: "24px 20px 32px" }}>
        {/* Banner */}
        <div
          style={{
            background: theme.bg,
            border: `1px solid ${theme.border}`,
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ fontFamily: "var(--font-hero)", fontSize: 20, color: theme.text, fontWeight: 600 }}>
              {theme.heading}
            </div>
            <span
              style={{
                fontFamily: "var(--font-data)",
                fontWeight: 700,
                fontSize: 11,
                padding: "4px 10px",
                border: `1px solid ${theme.border}`,
                borderRadius: 999,
                color: theme.text,
                whiteSpace: "nowrap",
              }}
            >
              {URGENCY_LABEL[result.urgency]}
            </span>
          </div>

          <p style={{ marginTop: 12, color: theme.text, fontSize: 15, lineHeight: 1.5 }}>
            {result.suggested_next_step}
          </p>

          {result.rationale && (
            <p
              style={{
                marginTop: 10,
                color: theme.text,
                opacity: 0.85,
                fontStyle: "italic",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {result.rationale}
            </p>
          )}

          {result.red_flags?.length > 0 && (
            <p style={{ marginTop: 10, color: theme.text, opacity: 0.85, fontSize: 12 }}>
              Yves noticed: {result.red_flags.join(", ")}
            </p>
          )}

          {result.negation_detected && (
            <p style={{ marginTop: 10, color: theme.text, opacity: 0.8, fontSize: 12, fontStyle: "italic" }}>
              It looks like you may be describing symptoms you don't have — rephrase if that's incorrect.
            </p>
          )}

          {result.attribution_detected && (
            <p style={{ marginTop: 10, color: theme.text, opacity: 0.8, fontSize: 12, fontStyle: "italic" }}>
              It looks like these symptoms may belong to someone else — rephrase if that's incorrect.
            </p>
          )}

          {result.source === "keyword_fallback" && (
            <p
              style={{
                marginTop: 12,
                padding: "8px 10px",
                background: "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                borderRadius: 8,
                color: "var(--white-muted)",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              Yves is temporarily unavailable. Your symptoms have been noted and keyword analysis is being used.
            </p>
          )}
          {import.meta.env.DEV && (
            <div
              style={{
                marginTop: 12,
                textAlign: "right",
                fontFamily: "var(--font-data)",
                fontSize: 9,
                color: theme.text,
                opacity: 0.5,
              }}
            >
              source: {result.source}
            </div>
          )}
        </div>

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              background: "var(--navy-card)",
              border: "1px solid var(--navy-border)",
              borderRadius: 8,
              color: "var(--white-muted)",
              fontFamily: "var(--font-ui)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        {resultText && (
          <div
            style={{
              marginTop: 16,
              background: "var(--navy-card)",
              border: "1px solid var(--navy-border)",
              borderRadius: 8,
              padding: 12,
              color: "var(--white-muted)",
              fontStyle: "italic",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            "{resultText}"
          </div>
        )}

        {/* Contact button */}
        {showContact && (
          <button
            type="button"
            onClick={() => contactPractitioner()}
            disabled={contacting || contacted}
            style={{
              marginTop: 16,
              width: "100%",
              minHeight: 48,
              borderRadius: 8,
              background: contacted
                ? "var(--navy-card)"
                : isEmergencyish
                  ? "#7a1e1e"
                  : "var(--blue-accent)",
              color: contacted ? "var(--white-muted)" : "var(--white)",
              border: "none",
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 15,
              opacity: contacting ? 0.6 : 1,
            }}
          >
            {contacted ? `Notified ${pName}` : contacting ? "Notifying…" : contactLabel}
          </button>
        )}

        {/* Previous queries */}
        <PreviousQueries history={history} expanded={expanded} setExpanded={setExpanded} />

        <button
          type="button"
          onClick={askAnother}
          style={{
            marginTop: 24,
            width: "100%",
            minHeight: 44,
            borderRadius: 8,
            background: "transparent",
            color: "var(--white)",
            border: "1px solid var(--navy-border)",
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          Ask another question
        </button>

        {showEmergencyModal && result.urgency === "emergency" && (
          <EmergencyModal
            practitionerName={pName}
            hasPractitioner={!!client?.practitioner_id}
            contacted={contacted}
            contacting={contacting}
            onContact={() => contactPractitioner(true)}
            onClose={() => setShowEmergencyModal(false)}
          />
        )}
      </div>
    );
  }

  // ---------- INPUT ----------
  const realTimeShow = realTime && realTime.detected && realTime.urgency !== "routine";
  const realTimeTheme = realTimeShow ? REALTIME_THEME[realTime.urgency] : null;

  return (
    <div style={{ padding: "24px 20px 32px" }}>
      <h1 style={{ fontFamily: "var(--font-hero)", fontWeight: 400, fontSize: 26, color: "var(--white)" }}>
        Ask Yves
      </h1>
      <p style={{ marginTop: 6, color: "var(--white-muted)", fontFamily: "var(--font-ui)", fontSize: 13 }}>
        Describe how you're feeling and Yves will assess what to do next
      </p>

      {/* Practitioner pill */}
      <div style={{ marginTop: 12 }}>
        {client?.practitioner_id ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 999,
              background: "var(--navy-card)",
              border: "1px solid var(--navy-border)",
              color: "var(--white-muted)",
              fontFamily: "var(--font-ui)",
              fontSize: 12,
            }}
          >
            <UserCheck size={14} />
            Your practitioner: {practitionerName ?? "—"}
          </span>
        ) : (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 999,
              background: "#1a1400",
              border: "1px solid #7a701e",
              color: "#f5e58a",
              fontFamily: "var(--font-ui)",
              fontSize: 12,
            }}
          >
            <AlertTriangle size={14} />
            No practitioner assigned — contact your clinic
          </span>
        )}
      </div>

      {accessBlockReason ? (
        <div
          style={{
            marginTop: 20,
            padding: 16,
            background: "var(--navy-card)",
            border: "1px solid var(--navy-border)",
            borderRadius: 10,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 13,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--blue-cold)",
            }}
          >
            Yves unavailable
          </div>
          <p
            style={{
              marginTop: 8,
              color: "var(--white)",
              fontFamily: "var(--font-ui)",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            {accessBlockReason}
          </p>
          <PreviousQueries history={history} expanded={expanded} setExpanded={setExpanded} />
        </div>
      ) : (
      <>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        maxLength={2000}
        placeholder="Describe your symptoms in your own words..."
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
          minHeight: 140,
        }}
      />

      {/* Rotating examples */}
      <div
        style={{
          marginTop: 10,
          padding: 10,
          background: "var(--navy-card)",
          border: "1px solid var(--navy-border)",
          borderRadius: 8,
          color: "var(--white-muted)",
          fontStyle: "italic",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          opacity: exampleVisible ? 1 : 0,
          transition: "opacity 0.3s ease",
          minHeight: 38,
        }}
      >
        e.g. {EXAMPLES[exampleIdx]}
      </div>

      {/* Real-time alert */}
      {realTimeShow && realTimeTheme && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: realTimeTheme.bg,
            border: `1px solid ${realTimeTheme.border}`,
            borderRadius: 8,
            color: realTimeTheme.text,
            fontFamily: "var(--font-ui)",
            fontSize: 13,
          }}
        >
          {realTimeTheme.message}
          {(realTime.urgency === "emergency" || realTime.urgency === "urgent") &&
            client?.practitioner_id && (
              <button
                type="button"
                onClick={realTimeContact}
                disabled={contacting || contacted}
                style={{
                  marginTop: 10,
                  width: "100%",
                  minHeight: 40,
                  borderRadius: 8,
                  background: contacted ? "transparent" : realTimeTheme.border,
                  color: contacted ? realTimeTheme.text : "var(--white)",
                  border: `1px solid ${realTimeTheme.border}`,
                  fontFamily: "var(--font-ui)",
                  fontWeight: 600,
                  fontSize: 13,
                  opacity: contacting ? 0.6 : 1,
                }}
              >
                {contacted ? "Notified" : contacting ? "Notifying…" : `Notify ${pName} now`}
              </button>
            )}
        </div>
      )}

      {error && <p style={{ color: "var(--red)", marginTop: 12, fontSize: 13 }}>{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={text.trim().length < 3 || !canUseYves}
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
          opacity: text.trim().length < 3 || !canUseYves ? 0.6 : 1,
        }}
      >
        {submitLabel}
      </button>

      <PreviousQueries history={history} expanded={expanded} setExpanded={setExpanded} />
      </>
      )}
    </div>
  );
}

function PreviousQueries({
  history,
  expanded,
  setExpanded,
}: {
  history: SymptomQuery[];
  expanded: string | null;
  setExpanded: (id: string | null) => void;
}) {
  if (history.length === 0) return null;
  return (
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
        {history.slice(0, 5).map((q) => {
          const u = (q.urgency as UrgencyTier) ?? "routine";
          const theme = BANNER_THEME[u];
          const isOpen = expanded === q.id;
          return (
            <button
              key={q.id}
              type="button"
              onClick={() => setExpanded(isOpen ? null : q.id)}
              style={{
                background: "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                borderRadius: 8,
                padding: 12,
                textAlign: "left",
                color: "var(--white)",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontFamily: "var(--font-data)", fontSize: 11, color: "var(--white-muted)" }}>
                  {new Date(q.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-data)",
                    fontWeight: 700,
                    fontSize: 10,
                    padding: "3px 8px",
                    border: `1px solid ${theme.border}`,
                    color: theme.text,
                    borderRadius: 999,
                  }}
                >
                  {URGENCY_LABEL[u]}
                </span>
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: "var(--white)",
                  overflow: isOpen ? "visible" : "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: isOpen ? "normal" : "nowrap",
                }}
              >
                {q.query_text}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmergencyModal({
  practitionerName,
  hasPractitioner,
  contacted,
  contacting,
  onContact,
  onClose,
}: {
  practitionerName: string;
  hasPractitioner: boolean;
  contacted: boolean;
  contacting: boolean;
  onContact: () => void;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 100,
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          background: "var(--white)",
          color: "#111",
          borderRadius: 14,
          padding: 24,
          maxWidth: 380,
          width: "100%",
          position: "relative",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            background: "transparent",
            border: "none",
            color: "#666",
            cursor: "pointer",
          }}
        >
          <X size={20} />
        </button>

        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 999,
              background: "#fde2e2",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AlertTriangle size={26} color="#a61b1b" />
          </div>
        </div>

        <h2
          style={{
            fontFamily: "var(--font-hero)",
            fontWeight: 600,
            fontSize: 22,
            color: "#a61b1b",
            textAlign: "center",
            margin: 0,
          }}
        >
          Urgent Symptoms Detected
        </h2>
        <p
          style={{
            marginTop: 10,
            fontFamily: "var(--font-ui)",
            fontSize: 14,
            color: "#333",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          The symptoms you've described may require immediate attention. Please act now.
        </p>

        <a
          href="tel:112"
          style={{
            marginTop: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            minHeight: 48,
            borderRadius: 8,
            background: "#a61b1b",
            color: "#fff",
            fontFamily: "var(--font-ui)",
            fontWeight: 700,
            fontSize: 16,
            textDecoration: "none",
          }}
        >
          Call 112 — Emergency
        </a>

        {hasPractitioner && (
          <button
            type="button"
            onClick={onContact}
            disabled={contacting || contacted}
            style={{
              marginTop: 10,
              width: "100%",
              minHeight: 44,
              borderRadius: 8,
              background: contacted ? "#eee" : "transparent",
              color: "#111",
              border: "1px solid #ccc",
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 14,
              opacity: contacting ? 0.6 : 1,
            }}
          >
            {contacted ? `Notified ${practitionerName}` : contacting ? "Notifying…" : `Notify ${practitionerName}`}
          </button>
        )}
      </div>
    </div>
  );
}
