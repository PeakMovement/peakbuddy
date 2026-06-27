import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { UserCheck, AlertTriangle, X, ThumbsUp, ThumbsDown, ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getClientId } from "@/lib/client-session";
import { fireAlertWebhook, findRecentOpenAlert } from "@/lib/webhooks";
import { notifyAssignedPractitioner } from "@/lib/notify-practitioner.functions";
import {
  analyzeRealTime,
  analyzeSymptom,
  type RealTimeResult,
  type TriageResult,
  type UrgencyTier,
} from "@/lib/yves";
import { getClientYvesAccess } from "@/lib/yves-access.functions";
import { setYvesAiConsent } from "@/lib/yves-consent.functions";
import { setPatientFeedback } from "@/lib/patient-feedback.functions";
import type { Client, SymptomQuery } from "@/lib/types";
import { CrosshairLogo } from "@/components/CrosshairLogo";
import { log } from "@/lib/log";

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

const BANNER_THEME: Record<
  UrgencyTier,
  { bg: string; border: string; text: string; heading: string }
> = {
  emergency: {
    bg: "#1a0000",
    border: "#7a1e1e",
    text: "#ffb3b3",
    heading: "Medical Attention Recommended",
  },
  urgent: {
    bg: "#1a0f00",
    border: "#7a4e1e",
    text: "#ffd28a",
    heading: "Medical Attention Recommended",
  },
  soon: { bg: "#1a1400", border: "#7a701e", text: "#f5e58a", heading: "Follow-up Recommended" },
  monitor: { bg: "#00101a", border: "#1e4a7a", text: "#9ec9ee", heading: "Keep an Eye On This" },
  routine: { bg: "#001a08", border: "#1e7a3a", text: "#9eebc1", heading: "Routine Symptom" },
};

const REALTIME_THEME: Record<
  UrgencyTier,
  { bg: string; border: string; text: string; message: string }
> = {
  emergency: {
    bg: "#1a0000",
    border: "#7a1e1e",
    text: "#ffb3b3",
    message: "⚠ This may need emergency attention — please act immediately",
  },
  urgent: {
    bg: "#1a0f00",
    border: "#7a4e1e",
    text: "#ffd28a",
    message: "This may need prompt attention before your next appointment",
  },
  soon: {
    bg: "#1a1400",
    border: "#7a701e",
    text: "#f5e58a",
    message: "These symptoms suggest a follow-up soon would be advisable",
  },
  monitor: {
    bg: "#00101a",
    border: "#1e4a7a",
    text: "#9ec9ee",
    message: "Symptoms noted — worth discussing with your practitioner",
  },
  routine: { bg: "#001a08", border: "#1e7a3a", text: "#9eebc1", message: "" },
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
  const [lastQueryId, setLastQueryId] = useState<string | null>(null);
  const [feedbackUnderstood, setFeedbackUnderstood] = useState<boolean | null>(null);
  const [feedbackHelpful, setFeedbackHelpful] = useState<boolean | null>(null);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [realTime, setRealTime] = useState<RealTimeResult | null>(null);
  const [contacting, setContacting] = useState(false);
  const [contacted, setContacted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exampleIdx, setExampleIdx] = useState(0);
  const [exampleVisible, setExampleVisible] = useState(true);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consentSaving, setConsentSaving] = useState(false);
  const saveConsent = useServerFn(setYvesAiConsent);

  const debounceRef = useRef<number | null>(null);

  // Initial load — client, practitioner name, history
  useEffect(() => {
    const id = getClientId();
    if (!id) return;
    (async () => {
      const { data: c } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
      const cl = c as Client | null;
      setClient(cl);

      const [{ data: q }, profRes, accessRes] = await Promise.all([
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
        getClientYvesAccess({ data: { clientId: id } }).catch(() => ({
          practiceYvesEnabled: true,
          clientYvesEnabled: true,
          practitionerId: null as string | null,
        })),
      ]);
      setHistory(((q as SymptomQuery[] | null) ?? []) as SymptomQuery[]);
      setPractitionerName((profRes.data as { full_name: string } | null)?.full_name ?? null);
      setPracticeYvesEnabled(accessRes.practiceYvesEnabled);
      if (
        cl &&
        cl.practitioner_id &&
        accessRes.practiceYvesEnabled &&
        cl.yves_enabled !== false &&
        cl.yves_ai_consent !== true
      ) {
        setShowConsentModal(true);
      }
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
      const { data, error: alertErr } = await supabase
        .from("alerts")
        .insert({
          practitioner_id: client.practitioner_id,
          client_id: client.id,
          alert_type: "red_flag",
          message: `Red flag detected: ${queryText.slice(0, 100)}`,
          urgency: triage.urgency,
        })
        .select("id")
        .single();
      if (alertErr) throw alertErr;
      alertRowId = (data?.id as string | null) ?? null;
    } catch (e) {
      log.error("[Yves] insert alert failed:", e);
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
        await supabase.from("alerts").update({ webhook_fired: true }).eq("id", alertRowId);
      } catch (e) {
        log.warn("Alert webhook_fired update failed:", e);
      }
    }

    if (alertRowId) {
      try {
        const { notifyAlertPush } = await import("@/lib/push.functions");
        await notifyAlertPush({ data: { alertId: alertRowId, kind: "yves" } });
      } catch (e) {
        log.warn("[Yves] push notify failed:", e);
      }
    }
  };

  const accessAllowed =
    !!client?.practitioner_id && practiceYvesEnabled && client?.yves_enabled !== false;
  const hasAiConsent = client?.yves_ai_consent === true;
  const canUseYves = accessAllowed && hasAiConsent;

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
    if (!accessAllowed) return;
    if (!hasAiConsent) {
      setShowConsentModal(true);
      return;
    }

    setError(null);
    setStage("loading");
    const queryText = text.trim();

    // Daily limit: 3 Yves questions per client per day (server enforces too).
    const startToday = new Date();
    startToday.setHours(0, 0, 0, 0);
    const { count: usedToday } = await supabase
      .from("symptom_queries")
      .select("id", { count: "exact", head: true })
      .eq("client_id", client.id)
      .gte("created_at", startToday.toISOString());
    if ((usedToday ?? 0) >= 3) {
      setError(
        "You've reached today's limit of 3 Yves questions. Please continue tomorrow, or contact your practitioner if this is urgent.",
      );
      setStage("input");
      return;
    }

    let triage: TriageResult;
    try {
      triage = await analyzeSymptom(queryText, undefined, pName, client.id);
    } catch (e) {
      log.error(e);
      setError(CLIENT_GENERIC_ERROR);
      setStage("input");
      return;
    }

    // Persist via direct insert (RLS allows client_id = current_client_id())
    let insertedId: string | null = null;
    try {
      const { data, error: insErr } = await supabase
        .from("symptom_queries")
        .insert({
          client_id: client.id,
          practitioner_id: client.practitioner_id,
          query_text: queryText,
          urgency: triage.urgency,
          red_flag_detected: triage.red_flag_detected,
          suggested_next_step: triage.suggested_next_step,
          ai_rationale: triage.rationale,
          severity: triage.severity,
          source: triage.source,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      insertedId = (data?.id as string | null) ?? null;
    } catch (e) {
      log.error("[Yves] insert symptom_query failed:", e);
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
        log.warn("Alert flow failed:", e);
      }
    }

    setResult(triage);
    setResultText(queryText);
    setContacted(false);
    setLastQueryId(insertedId);
    setFeedbackUnderstood(null);
    setFeedbackHelpful(null);
    setFeedbackSent(false);
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
      await notifyAssignedPractitioner({
        data: {
          clientId: client.id,
          symptomDescription: result?.rationale ?? resultText ?? text.trim(),
          symptomScore: result?.severity ?? 0,
          urgency: (result?.urgency ?? "urgent") as
            | "emergency"
            | "urgent"
            | "soon"
            | "monitor"
            | "routine",
        },
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
      await notifyAssignedPractitioner({
        data: {
          clientId: client.id,
          symptomDescription: text.trim(),
          symptomScore: realTime?.severity ?? 0,
          urgency: (realTime?.urgency ?? "urgent") as
            | "emergency"
            | "urgent"
            | "soon"
            | "monitor"
            | "routine",
        },
      });
    }
    setContacting(false);
    setContacted(true);
  };

  const askAnother = () => {
    setResult(null);
    setResultText("");
    setContacted(false);
    setLastQueryId(null);
    setFeedbackUnderstood(null);
    setFeedbackHelpful(null);
    setFeedbackSent(false);
    setStage("input");
  };

  const sendFeedback = useServerFn(setPatientFeedback);
  const submitFeedback = async (field: "understood" | "helpful", value: boolean) => {
    if (!lastQueryId) return;
    if (field === "understood") setFeedbackUnderstood(value);
    else setFeedbackHelpful(value);
    try {
      await sendFeedback({
        data: {
          symptomQueryId: lastQueryId,
          ...(field === "understood" ? { understood: value } : { helpful: value }),
        },
      });
      setFeedbackSent(true);
    } catch (e) {
      log.error("[Yves] patient feedback failed", e);
    }
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
        <div
          style={{
            fontFamily: "var(--font-hero)",
            fontSize: 20,
            color: "var(--white-muted)",
            textAlign: "center",
          }}
        >
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
    const showContact = result.should_notify_practitioner && !!client?.practitioner_id;
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
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-hero)",
                fontSize: 20,
                color: theme.text,
                fontWeight: 600,
              }}
            >
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
            <p
              style={{
                marginTop: 10,
                color: theme.text,
                opacity: 0.8,
                fontSize: 12,
                fontStyle: "italic",
              }}
            >
              It looks like you may be describing symptoms you don't have — rephrase if that's
              incorrect.
            </p>
          )}

          {result.attribution_detected && (
            <p
              style={{
                marginTop: 10,
                color: theme.text,
                opacity: 0.8,
                fontSize: 12,
                fontStyle: "italic",
              }}
            >
              It looks like these symptoms may belong to someone else — rephrase if that's
              incorrect.
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
              Yves is temporarily unavailable. Your symptoms have been noted and keyword analysis is
              being used.
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

        {/* Patient feedback: UX comprehension/helpfulness only.
            Never feeds calibration, alert severity, urgency, or thresholds. */}
        {lastQueryId && (
          <div
            style={{
              marginTop: 16,
              padding: "10px 12px",
              background: "var(--navy-card)",
              border: "1px solid var(--navy-border)",
              borderRadius: 8,
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              color: "var(--white-muted)",
            }}
          >
            {feedbackSent && feedbackUnderstood !== null && feedbackHelpful !== null ? (
              <span>Thanks for the feedback.</span>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <FeedbackRow
                  label="Did Yves understand you?"
                  value={feedbackUnderstood}
                  onPick={(v) => submitFeedback("understood", v)}
                  ariaPrefix="Yves understood"
                />
                <FeedbackRow
                  label="Was this helpful?"
                  value={feedbackHelpful}
                  onPick={(v) => submitFeedback("helpful", v)}
                  ariaPrefix="Reply helpful"
                />
              </div>
            )}
          </div>
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
    <>
      <div style={{ padding: "24px 20px 32px" }}>
        <AiDisclosureBar />
        <h1
          style={{
            fontFamily: "var(--font-hero)",
            fontWeight: 400,
            fontSize: 26,
            color: "var(--white)",
            marginTop: 12,
          }}
        >
          Ask Yves
        </h1>

        <p
          style={{
            marginTop: 6,
            color: "var(--white-muted)",
            fontFamily: "var(--font-ui)",
            fontSize: 13,
          }}
        >
          Describe how you're feeling and Yves will assess what to do next
        </p>
        <p
          style={{
            marginTop: 6,
            color: "var(--white-muted)",
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            opacity: 0.7,
          }}
        >
          You can ask up to 3 questions per day.
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
      {showConsentModal && client && (
        <ConsentModal
          saving={consentSaving}
          onAgree={async () => {
            if (!client) return;
            setConsentSaving(true);
            const res = await saveConsent({ data: { clientId: client.id, consent: true } });
            setConsentSaving(false);
            if (res.ok) {
              const now = new Date().toISOString();
              setClient({ ...client, yves_ai_consent: true, yves_ai_consent_at: now });
              setShowConsentModal(false);
            }
          }}
          onDecline={() => {
            setShowConsentModal(false);
            window.history.back();
          }}
        />
      )}
    </>
  );
}

function FeedbackRow({
  label,
  value,
  onPick,
  ariaPrefix,
}: {
  label: string;
  value: boolean | null;
  onPick: (v: boolean) => void;
  ariaPrefix: string;
}) {
  const btn = (active: boolean): React.CSSProperties => ({
    minWidth: 44,
    minHeight: 44,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    borderRadius: 8,
    background: active ? "var(--blue-accent)" : "transparent",
    color: active ? "var(--white)" : "var(--white-muted)",
    border: `1px solid ${active ? "var(--blue-accent)" : "var(--navy-border)"}`,
    cursor: "pointer",
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      <button
        type="button"
        aria-label={`${ariaPrefix}: yes`}
        aria-pressed={value === true}
        onClick={() => onPick(true)}
        style={btn(value === true)}
      >
        <ThumbsUp size={16} />
      </button>
      <button
        type="button"
        aria-label={`${ariaPrefix}: no`}
        aria-pressed={value === false}
        onClick={() => onPick(false)}
        style={btn(value === false)}
      >
        <ThumbsDown size={16} />
      </button>
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
  const [isOpen, setIsOpen] = useState(false);
  if (history.length === 0) return null;
  return (
    <div style={{ marginTop: 24 }}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "10px 12px",
          background: "var(--navy-card)",
          border: "1px solid var(--navy-border)",
          borderRadius: 8,
          color: "var(--white-muted)",
          cursor: "pointer",
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        <span>Previous queries ({history.length})</span>
        <ChevronDown
          size={16}
          style={{
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}
        />
      </button>

      {isOpen && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
          {history.slice(0, 5).map((q) => {
            const u = (q.urgency as UrgencyTier) ?? "routine";
            const theme = BANNER_THEME[u];
            const itemOpen = expanded === q.id;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => setExpanded(itemOpen ? null : q.id)}
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
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-data)",
                      fontSize: 11,
                      color: "var(--white-muted)",
                    }}
                  >
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
                    overflow: itemOpen ? "visible" : "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: itemOpen ? "normal" : "nowrap",
                  }}
                >
                  {q.query_text}
                </div>
              </button>
            );
          })}
        </div>
      )}
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
            {contacted
              ? `Notified ${practitionerName}`
              : contacting
                ? "Notifying…"
                : `Notify ${practitionerName}`}
          </button>
        )}
      </div>
    </div>
  );
}

function AiDisclosureBar() {
  return (
    <div
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 8,
        padding: "8px 12px",
        fontFamily: "var(--font-ui)",
        fontSize: 12,
        lineHeight: 1.5,
        color: "var(--white-muted)",
      }}
    >
      Yves uses AI provided by Anthropic to analyse what you share. Not a diagnosis.{" "}
      <Link
        to="/privacy-policy"
        hash="ai"
        style={{ color: "var(--blue-accent)", textDecoration: "underline" }}
      >
        How your data is used
      </Link>
    </div>
  );
}

function ConsentModal({
  saving,
  onAgree,
  onDecline,
}: {
  saving: boolean;
  onAgree: () => void;
  onDecline: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const agreeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    agreeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        const focusables =
          containerRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="yves-consent-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 1000,
      }}
    >
      <div
        ref={containerRef}
        style={{
          background: "var(--navy-bg, #0a1420)",
          border: "1px solid var(--navy-border)",
          borderRadius: 12,
          maxWidth: 480,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 22,
          color: "var(--white)",
        }}
      >
        <h2
          id="yves-consent-title"
          style={{
            fontFamily: "var(--font-hero)",
            fontWeight: 500,
            fontSize: 22,
            margin: 0,
            color: "var(--white)",
          }}
        >
          Before you use Yves
        </h2>

        <div
          style={{
            marginTop: 14,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            fontFamily: "var(--font-ui)",
            fontSize: 14,
            lineHeight: 1.55,
            color: "var(--white)",
          }}
        >
          <p style={{ margin: 0 }}>
            <strong style={{ color: "var(--white)" }}>What is sent:</strong> The symptoms, check in
            answers, and messages you type into Yves are sent to our AI provider to analyse your
            symptoms and flag anything your practitioner should review.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: "var(--white)" }}>Who it is sent to:</strong> Your information
            is processed by Anthropic, the company that provides the AI model behind Yves. Anthropic
            processes this data on our behalf and does not use it to train its models. To suggest a
            suitable exercise program from your check-ins, the same information may also be processed
            by Google through our platform provider, Lovable. Both act as our data processors and use
            your data only to provide these features, not to train their own models.
          </p>
          <p style={{ margin: 0 }}>
            <strong style={{ color: "var(--white)" }}>Why:</strong> This lets Yves give you a
            helpful, safe response and alert your practitioner to concerning symptoms.
          </p>
          <p style={{ margin: 0, color: "var(--white-muted)" }}>
            Yves is not a diagnosis and does not replace your practitioner or emergency care.
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--white-muted)" }}>
            You can change your mind any time in Profile.{" "}
            <Link
              to="/privacy-policy"
              hash="ai"
              style={{ color: "var(--blue-accent)", textDecoration: "underline" }}
            >
              How your data is used
            </Link>
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
          <button
            ref={agreeRef}
            type="button"
            onClick={onAgree}
            disabled={saving}
            style={{
              minHeight: 48,
              borderRadius: 8,
              background: "var(--blue-accent)",
              color: "var(--white)",
              border: "none",
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 15,
              cursor: saving ? "default" : "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving…" : "I agree, continue"}
          </button>
          <button
            type="button"
            onClick={onDecline}
            disabled={saving}
            style={{
              minHeight: 44,
              borderRadius: 8,
              background: "transparent",
              color: "var(--white-muted)",
              border: "1px solid var(--navy-border)",
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 14,
              cursor: saving ? "default" : "pointer",
            }}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
