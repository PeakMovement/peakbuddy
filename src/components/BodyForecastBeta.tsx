import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Sparkles, ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { computeForecast, type ForecastResult } from "@/lib/body-forecast";
import { GarminAttribution, YvesGarminCaption } from "@/components/wearables/GarminAttribution";

// BETA GATE — only shows for these accounts. Expand/remove later.
type BetaClient = { id: string; full_name: string | null; email: string | null };

const DOT: Record<string, string> = {
  strong: "var(--green)",
  moderate: "var(--blue-accent)",
  low: "var(--red)",
  unknown: "var(--white-muted)",
};

/** Beta "Your Body Forecast" card. Renders nothing unless the client is in the beta gate. */
export function BodyForecastBeta({ client }: { client: BetaClient }) {
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [hasGarmin, setHasGarmin] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [open, setOpen] = useState(false);
  // 1-tap forecast confirmation (turns the forecast grade into a lightweight check-in)
  const [practitionerId, setPractitionerId] = useState<string | null>(null);
  const [todayDone, setTodayDone] = useState(true);
  const [confirmState, setConfirmState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const [wr, cr, clientRow] = await Promise.all([
          supabase
            .from("wearable_sessions")
            .select("date, source, sleep_score, readiness_score, resting_hr, hrv_avg")
            .eq("client_id", client.id)
            .order("date", { ascending: false })
            .limit(30),
          supabase
            .from("check_ins")
            .select("created_at, pain_level")
            .eq("client_id", client.id)
            .order("created_at", { ascending: false })
            .limit(60),
          supabase.from("clients").select("practitioner_id").eq("id", client.id).maybeSingle(),
        ]);
        if (wr.error || cr.error) throw wr.error ?? cr.error;
        if (cancelled) return;
        setPractitionerId(((clientRow.data as { practitioner_id?: string } | null)?.practitioner_id) ?? null);
        const todayKey = new Date().toISOString().slice(0, 10);
        setTodayDone(
          ((cr.data ?? []) as { created_at: string }[]).some(
            (c) => String(c.created_at).slice(0, 10) === todayKey,
          ),
        );
        const rawRows = (wr.data ?? []) as Record<string, unknown>[];
        setHasGarmin(rawRows.some((r) => r.source === "garmin"));
        const wearables = rawRows.map((r) => ({
          date: String(r.date),
          sleep_score: (r.sleep_score as number | null) ?? null,
          readiness_score: (r.readiness_score as number | null) ?? null,
          resting_hr: (r.resting_hr as number | null) ?? null,
          hrv_avg: (r.hrv_avg as number | null) ?? null,
        }));
        const checkins = ((cr.data ?? []) as { created_at: string; pain_level: number | null }[]).map((r) => ({
          date: String(r.created_at).slice(0, 10),
          pain_level: r.pain_level ?? null,
        }));
        setResult(computeForecast(wearables, checkins));
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Show only when we have a real forecast built from the client's own wearable
  // data; silent for everyone else (loading, error, or no wearable connected).
  if (status !== "ready" || !result || !result.hasWearable) return null;

  const dot = DOT[result.level] ?? "var(--blue-accent)";

  const confirmToday = async (pain: number) => {
    if (!practitionerId || confirmState === "saving") return;
    setConfirmState("saving");
    try {
      const { error } = await supabase.rpc("insert_check_in", {
        p_client_id: client.id,
        p_practitioner_id: practitionerId,
        p_pain_level: pain,
        p_sleep_quality: null,
        p_stress_level: null,
        p_energy_level: null,
        p_mood: null,
        p_notes: "Quick confirm from Body Forecast",
        p_medication_taken: false,
        p_flagged: pain >= 8,
      });
      if (error) throw error;
      setConfirmState("saved");
      setTodayDone(true);
    } catch {
      setConfirmState("error");
    }
  };

  const showConfirm = !todayDone && practitionerId != null;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={17} color="var(--blue-accent)" aria-hidden />
            <span style={eyebrow}>Your Body Forecast</span>
          </div>
          <span style={betaTag}>Beta</span>
        </div>
        {hasGarmin && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            <GarminAttribution />
            <YvesGarminCaption />
          </div>
        )}

        {/* Hero: symptom-relatable message */}
        <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "flex-start" }}>
          <span style={{ ...statusDot, background: dot }} aria-hidden />
          <p style={message}>{result.message}</p>
        </div>
        {result.action && <p style={action}>{result.action}</p>}

        {result.personalNote && (
          <div style={noteBox}>
            <strong style={{ color: "var(--white)" }}>Your pattern:</strong> {result.personalNote}
          </div>
        )}

        {/* 1-tap confirmation — grading the forecast doubles as today's check-in */}
        {showConfirm && confirmState !== "saved" && (
          <div style={confirmBox}>
            <div style={confirmLabel}>How's your pain today? One tap logs your check-in.</div>
            <div style={scaleRow} role="group" aria-label="Rate today's pain 0 to 10">
              {Array.from({ length: 11 }, (_, n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => confirmToday(n)}
                  disabled={confirmState === "saving"}
                  style={scaleBtn}
                  aria-label={`Pain ${n} of 10`}
                >
                  {n}
                </button>
              ))}
            </div>
            {confirmState === "error" && (
              <div style={{ color: "var(--red)", fontFamily: "var(--font-ui)", fontSize: 12, marginTop: 6 }}>
                Couldn't save — try again.
              </div>
            )}
          </div>
        )}
        {confirmState === "saved" && (
          <div style={{ ...confirmBox, color: "var(--green)", fontFamily: "var(--font-ui)", fontSize: 13 }}>
            Thanks — logged. Your forecast learns from every check-in.
          </div>
        )}

        {/* Reveal */}
        {result.factors.length > 0 && (
          <>
            <button type="button" onClick={() => setOpen((v) => !v)} style={revealBtn} aria-expanded={open}>
              How was this decided?
              <ChevronDown
                size={15}
                style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s ease" }}
                aria-hidden
              />
            </button>
            {open && (
              <div style={panel}>
                <p style={reasoning}>{result.reasoning}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                  {result.factors.map((f) => (
                    <div key={f.label} style={factorRow}>
                      <span style={{ color: "var(--white-muted)", fontFamily: "var(--font-ui)", fontSize: 13 }}>
                        {f.label}
                      </span>
                      <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--white)" }}>
                        <span style={{ fontFamily: "var(--font-data)", fontWeight: 700 }}>{f.value}</span>{" "}
                        <span style={{ color: "var(--white-muted)" }}>· {f.read}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8 }}>
          {result.confidence && <span style={confChip}>{result.confidence}</span>}
        </div>

        {result.prompt && <p style={promptStyle}>{result.prompt}</p>}

        <p style={disclaimer}>
          A gentle guide from your own data, not medical advice. Talk to your practitioner about anything concerning.
        </p>
      </div>
    </div>
  );
}

const card: CSSProperties = {
  background: "linear-gradient(160deg, var(--navy-card), var(--navy))",
  border: "1px solid var(--navy-border)",
  borderRadius: 16,
  padding: 18,
};
const eyebrow: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--white-muted)",
};
const betaTag: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--blue-accent)",
  border: "1px solid var(--navy-border)",
  borderRadius: 999,
  padding: "3px 8px",
};
const statusDot: CSSProperties = { width: 10, height: 10, borderRadius: "50%", marginTop: 8, flex: "0 0 auto" };
const message: CSSProperties = {
  fontFamily: "var(--font-hero)",
  fontSize: 23,
  lineHeight: 1.25,
  fontWeight: 600,
  color: "var(--white)",
  margin: 0,
};
const action: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 14,
  lineHeight: 1.5,
  color: "var(--white-muted)",
  marginTop: 10,
  marginLeft: 20,
};
const noteBox: CSSProperties = {
  marginTop: 14,
  background: "rgba(74,141,240,0.10)",
  border: "1px solid rgba(74,141,240,0.35)",
  borderRadius: 10,
  padding: "10px 12px",
  fontFamily: "var(--font-ui)",
  fontSize: 13.5,
  lineHeight: 1.5,
  color: "var(--white-muted)",
};
const confirmBox: CSSProperties = {
  marginTop: 14,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--navy-border)",
  borderRadius: 12,
  padding: "12px 14px",
};
const confirmLabel: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--white)",
};
const scaleRow: CSSProperties = {
  display: "flex",
  gap: 5,
  marginTop: 10,
  flexWrap: "wrap",
};
const scaleBtn: CSSProperties = {
  minWidth: 30,
  minHeight: 34,
  flex: "1 1 auto",
  background: "transparent",
  color: "var(--white-muted)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  fontFamily: "var(--font-data)",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};
const revealBtn: CSSProperties = {
  marginTop: 14,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "transparent",
  border: "none",
  color: "var(--blue-accent)",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
};
const panel: CSSProperties = {
  marginTop: 10,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--navy-border)",
  borderRadius: 12,
  padding: "12px 14px",
};
const reasoning: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--white-muted)",
  margin: 0,
};
const factorRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  paddingTop: 6,
  borderTop: "1px solid rgba(255,255,255,0.06)",
};
const confChip: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--white-muted)",
  border: "1px solid var(--navy-border)",
  borderRadius: 999,
  padding: "4px 10px",
};
const promptStyle: CSSProperties = {
  marginTop: 10,
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--blue-accent)",
};
const disclaimer: CSSProperties = {
  marginTop: 12,
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  lineHeight: 1.5,
  color: "var(--white-muted)",
  opacity: 0.8,
};
