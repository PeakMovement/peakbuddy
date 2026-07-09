import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getClientId, startOfTodayISO } from "@/lib/client-session";
import { analyzeRealTime } from "@/lib/yves";
import { fireAlertWebhook, findRecentOpenAlert } from "@/lib/webhooks";
import {
  cacheClient,
  getCachedClient,
  queueCheckIn,
  startQueueAutoFlush,
} from "@/lib/offline-queue";
import type { CheckIn, Client } from "@/lib/types";
import { log } from "@/lib/log";
import { suggestProgram } from "@/lib/programs.functions";
import { computeStreak, type CheckInFrequency } from "@/lib/streak";
import { StreakCard } from "@/components/StreakCard";
import { WearablePromptCard } from "@/components/wearables/WearablePromptCard";
import { RemindMeButton } from "@/components/checkin/RemindMeButton";
// MyRewards now lives in the Profile page so rewards + plan sit together.

export const Route = createFileRoute("/client/app/checkin")({
  component: CheckInScreen,
});

const moods = ["Very Low", "Low", "Okay", "Good", "Great"];

const CLIENT_GENERIC_ERROR =
  "Something went wrong. Please try again or contact your practitioner directly if your symptoms are urgent.";

function painColor(p: number) {
  if (p <= 3) return "var(--green)";
  if (p <= 6) return "var(--amber)";
  return "var(--red)";
}

function CheckInScreen() {
  const [client, setClient] = useState<Client | null>(null);
  const [todayCheckIn, setTodayCheckIn] = useState<CheckIn | null>(null);
  const [loading, setLoading] = useState(true);

  const [pain, setPain] = useState(3);
  const [sleep, setSleep] = useState<number | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  const [energy, setEnergy] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [med, setMed] = useState(false);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [savedOffline, setSavedOffline] = useState(false);
  const [historyStamps, setHistoryStamps] = useState<string[]>([]);
  const [gamificationOn, setGamificationOn] = useState(true);

  // Repeat same-day check-in flow
  const [showRepeatModal, setShowRepeatModal] = useState(false);
  const [conditionContext, setConditionContext] = useState<"same" | "different" | null>(null);
  const [conditionNote, setConditionNote] = useState("");


  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    [],
  );

  const streak = useMemo(() => {
    if (!client) return null;
    const freq = ((client as unknown as { check_in_frequency?: string }).check_in_frequency ??
      "daily") as CheckInFrequency;
    const stamps = success ? [new Date().toISOString(), ...historyStamps] : historyStamps;
    return computeStreak(stamps, freq);
  }, [client, historyStamps, success]);

  useEffect(() => {
    const id = getClientId();
    if (!id) return;
    (async () => {
      const [{ data: c }, { data: ci }, { data: hist }] = await Promise.all([
        supabase.from("clients").select("*").eq("id", id).maybeSingle(),
        supabase
          .from("check_ins")
          .select("*")
          .eq("client_id", id)
          .gte("created_at", startOfTodayISO())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("check_ins")
          .select("created_at")
          .eq("client_id", id)
          .order("created_at", { ascending: false })
          .limit(400),
      ]);
      const resolved = (c as Client | null) ?? getCachedClient<Client>();
      if (c) cacheClient(c);
      setClient(resolved);
      setTodayCheckIn(ci as CheckIn | null);
      setHistoryStamps(((hist ?? []) as { created_at: string }[]).map((r) => r.created_at));
      const practitionerId = (resolved as Client | null)?.practitioner_id;
      if (practitionerId) {
        const { data: prac } = await supabase
          .from("practices")
          .select("gamification_enabled")
          .eq("practitioner_id", practitionerId)
          .maybeSingle();
        setGamificationOn(
          (prac as { gamification_enabled?: boolean } | null)?.gamification_enabled !== false,
        );
      }
      setLoading(false);
    })();
    // Sync any check-ins queued while offline (now and on reconnect).
    const stop = startQueueAutoFlush();
    return stop;
  }, []);

  const submit = async () => {
    if (!client) return;
    setSubmitError(null);
    setSubmitting(true);

    const rt = analyzeRealTime(notes);
    const notesFlagged = rt.detected && rt.severity >= 6;
    const flagged = pain >= 7 || notesFlagged;

    const queuePayload = {
      queued_at: new Date().toISOString(),
      client_id: client.id,
      practitioner_id: client.practitioner_id,
      client_name: client.full_name,
      pain_level: pain,
      sleep_quality: sleep,
      stress_level: stress,
      energy_level: energy,
      mood,
      notes,
      medication_taken: med,
      flagged,
      condition_context: conditionContext,
      condition_note: conditionNote.trim() || null,
    };


    const saveOffline = () => {
      queueCheckIn(queuePayload);
      setTodayCheckIn({
        id: `offline-${Date.now()}`,
        client_id: client.id,
        practitioner_id: client.practitioner_id,
        pain_level: pain,
        sleep_quality: sleep,
        stress_level: stress,
        energy_level: energy,
        mood,
        notes,
        medication_taken: med,
        flagged,
        created_at: new Date().toISOString(),
      } as CheckIn);
      setSubmitting(false);
      setSavedOffline(true);
      setSuccess(true);
    };

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      saveOffline();
      return;
    }

    const { data: newId, error: insErr } = await supabase.rpc("insert_check_in", {
      p_client_id: client.id,
      p_practitioner_id: client.practitioner_id,
      p_pain_level: pain,
      p_sleep_quality: sleep,
      p_stress_level: stress,
      p_energy_level: energy,
      p_mood: mood,
      p_notes: notes,
      p_medication_taken: med,
      p_flagged: flagged,
      p_condition_context: conditionContext,
      p_condition_note: conditionNote.trim() || null,
    });


    if (insErr || !newId) {
      const msg = insErr?.message?.toLowerCase() ?? "";
      const looksLikeNetwork =
        msg.includes("fetch") || msg.includes("network") || msg.includes("timeout");
      if (looksLikeNetwork) {
        // Connection dropped mid-submit — keep the data, sync later.
        saveOffline();
        return;
      }
      log.error("[Check-in] insert_check_in failed:", insErr);
      setSubmitting(false);
      setSubmitError(CLIENT_GENERIC_ERROR);
      return;
    }

    const insertedId = newId as string;

    if (flagged) {
      const existing = await findRecentOpenAlert(client.id, "red_flag");

      if (!existing) {
        const alertMessage =
          pain >= 7
            ? `Pain level ${pain}/10 reported in check-in.`
            : "Red flag keyword detected in check-in notes.";

        let alertRowId: string | null = null;
        try {
          const { data: alertId, error: alertErr } = await supabase.rpc("insert_alert", {
            p_practitioner_id: client.practitioner_id,
            p_client_id: client.id,
            p_alert_type: "red_flag",
            p_message: alertMessage,
            p_urgency: "urgent",
          });
          if (alertErr) throw alertErr;
          alertRowId = (alertId as string | null) ?? null;
        } catch (e) {
          log.error("[Check-in] insert_alert failed:", e);
        }

        // Tag the alert with detected red-flag category for grouping/feedback.
        if (alertRowId && rt.category) {
          await supabase
            .from("alerts")
            .update({ red_flag_category: rt.category })
            .eq("id", alertRowId);
        }

        // Push the practitioner (best-effort, first name only — no symptom detail).
        if (alertRowId) {
          try {
            const { notifyAlertPush } = await import("@/lib/push.functions");
            await notifyAlertPush({ data: { alertId: alertRowId, kind: "checkin" } });
          } catch (e) {
            log.warn("[Check-in] practitioner push failed:", e);
          }
        }

        const result = await fireAlertWebhook({
          practitionerId: client.practitioner_id,
          clientName: client.full_name,
          clientId: client.id,
          alertMessage: "Red flag symptom detected in daily check-in",
          urgency: "urgent",
          redFlagDetected: true,
        });

        if (result.fired && alertRowId) {
          await supabase.from("alerts").update({ webhook_fired: true }).eq("id", alertRowId);
        }
      } else {
        log.debug("[Buddy] Duplicate alert suppressed for client:", client.id);
      }
    }

    // Pattern detection — rising pain trend across last few check-ins
    try {
      const { data: recent } = await supabase
        .from("check_ins")
        .select("pain_level, created_at")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false })
        .limit(4);
      const pains = (recent ?? [])
        .map((c) => c.pain_level)
        .filter((p): p is number => typeof p === "number");
      // Include today's submission as the newest if not yet returned by DB
      const series = [pain, ...pains].slice(0, 4);
      const rising =
        series.length >= 3 &&
        series[0] - series[series.length - 1] >= 3 &&
        series[0] >= 5 &&
        !flagged; // don't double-alert when red-flag already fired

      if (rising) {
        const existingPattern = await findRecentOpenAlert(client.id, "pattern");
        if (!existingPattern) {
          try {
            const { data: patternAlertId } = await supabase.rpc("insert_alert", {
              p_practitioner_id: client.practitioner_id,
              p_client_id: client.id,
              p_alert_type: "pattern",
              p_message: `Pain has risen from ${series[series.length - 1]}/10 to ${series[0]}/10 over the last ${series.length} check-ins.`,
              p_urgency: "soon",
            });
            if (patternAlertId) {
              await supabase
                .from("alerts")
                .update({ pattern: "rising_pain" })
                .eq("id", patternAlertId as string);
            }
          } catch (e) {
            log.error("[Check-in] pattern alert failed:", e);
          }
        }
      }
    } catch (e) {
      log.debug("[Check-in] pattern detection skipped:", e);
    }

    setTodayCheckIn({
      id: insertedId,
      client_id: client.id,
      practitioner_id: client.practitioner_id,
      pain_level: pain,
      sleep_quality: sleep,
      stress_level: stress,
      energy_level: energy,
      mood,
      notes,
      medication_taken: med,
      flagged,
      created_at: new Date().toISOString(),
    } as CheckIn);
    setSubmitting(false);
    setSuccess(true);
    // Trigger background suggestion (queued for the practitioner — no UI on the client).
    suggestProgram({
      data: {
        pain,
        sleep,
        stress,
        energy,
        mood,
        notes,
        clientId: client.id,
      },
    }).catch((e) => log.error("[Check-in] suggestProgram failed:", e));
  };

  if (loading) {
    return <div style={{ padding: 24, color: "var(--white-muted)" }}>Loading…</div>;
  }

  if (success || todayCheckIn) {
    const ci = todayCheckIn;
    return (
      <div
        style={{
          padding: "24px 20px 32px",
          minHeight: "calc(100dvh - 150px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: "50%",
            border: "3px solid var(--green)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "pulse 1.6s ease-out",
          }}
        >
          <CheckCircle2 size={48} color="var(--green)" />
        </div>
        <h1
          style={{
            fontFamily: "var(--font-hero)",
            fontSize: 26,
            marginTop: 20,
            color: "var(--white)",
          }}
        >
          {success ? "Check-in complete. Well done." : "Already checked in today."}
        </h1>
        {!success && <p style={{ marginTop: 6, color: "var(--white-muted)" }}>See you tomorrow.</p>}
        {gamificationOn && (
          <div
            style={{
              marginTop: 22,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <StreakCard streak={streak} />
          </div>
        )}
        {savedOffline && (
          <p role="status" style={{ marginTop: 12, color: "var(--amber, #f9a825)", fontSize: 14 }}>
            Saved on your device. It will sync automatically when you are back online.
          </p>
        )}
        {ci?.pain_level != null && (
          <p style={{ marginTop: 18, fontFamily: "var(--font-data)", color: "var(--white-muted)" }}>
            Last pain score:{" "}
            <span style={{ color: painColor(ci.pain_level), fontSize: 20 }}>
              {ci.pain_level}/10
            </span>
          </p>
        )}

        <button
          type="button"
          onClick={() => setShowRepeatModal(true)}
          style={{
            marginTop: 24,
            background: "transparent",
            border: "1px solid var(--navy-border)",
            color: "var(--white)",
            padding: "12px 20px",
            borderRadius: 10,
            fontFamily: "var(--font-data)",
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Check in again
        </button>
        <p style={{ marginTop: 8, fontSize: 11, color: "var(--white-muted)", maxWidth: 320 }}>
          Something changed since your last check-in? Log another entry.
        </p>

        {showRepeatModal && (
          <RepeatCheckInModal
            onCancel={() => setShowRepeatModal(false)}
            onConfirm={(ctx, note) => {
              setConditionContext(ctx);
              setConditionNote(note);
              setShowRepeatModal(false);
              // Reset the "already checked in" view so the form shows again.
              setTodayCheckIn(null);
              setSuccess(false);
              setSavedOffline(false);
              setNotes(note); // seed notes with the description if provided
            }}
          />
        )}
      </div>
    );
  }



  return (
    <div style={{ padding: "24px 20px 32px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              fontFamily: "var(--font-hero)",
              fontWeight: 400,
              fontSize: 24,
              color: "var(--white)",
            }}
          >
            How are you feeling today?
          </h1>
          <p
            style={{
              marginTop: 6,
              fontFamily: "var(--font-data)",
              fontSize: 12,
              color: "var(--white-muted)",
            }}
          >
            {todayLabel}
          </p>
        </div>
        <RemindMeButton />
      </div>
      <p
        style={{
          marginTop: 8,
          fontFamily: "var(--font-data)",
          fontSize: 12,
          color: "var(--white-muted)",
          lineHeight: 1.5,
        }}
      >
        Pain level is the most important field. Sleep, stress, energy and mood
        are optional.
      </p>

      {conditionContext && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 12px",
            border: "1px solid var(--navy-border)",
            borderRadius: 10,
            background: "var(--navy-card)",
            fontSize: 12,
            color: "var(--white-muted)",
            fontFamily: "var(--font-data)",
          }}
        >
          Repeat check-in tagged as{" "}
          <strong style={{ color: "var(--white)" }}>
            {conditionContext === "same" ? "same condition" : "different condition"}
          </strong>
          . This will be shown to your practitioner.
        </div>
      )}


      {gamificationOn && (
        <div style={{ marginTop: 16 }}>
          <StreakCard streak={streak} />
        </div>
      )}

      <WearablePromptCard />

      {/* Pain */}
      <Section label="Pain Level">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div
            style={{
              fontFamily: "var(--font-data)",
              fontSize: 56,
              fontWeight: 700,
              color: painColor(pain),
              lineHeight: 1,
            }}
          >
            {pain}
          </div>
          <input
            type="range"
            min={0}
            max={10}
            value={pain}
            onChange={(e) => setPain(parseInt(e.target.value, 10))}
            style={{ width: "100%", accentColor: painColor(pain) }}
            aria-label="Pain level"
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              width: "100%",
              fontSize: 11,
              color: "var(--white-muted)",
              fontFamily: "var(--font-data)",
            }}
          >
            <span>0</span>
            <span>10</span>
          </div>
        </div>
      </Section>

      {/* Sleep */}
      <Section label="Sleep Quality">
        <NumberRow value={sleep} onChange={setSleep} />
      </Section>

      {/* Stress */}
      <Section label="Stress Level">
        <NumberRow value={stress} onChange={setStress} />
      </Section>

      {/* Energy */}
      <Section label="Energy Level">
        <NumberRow value={energy} onChange={setEnergy} />
      </Section>

      {/* Mood */}
      <Section label="Mood">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
          {moods.map((m, i) => {
            const v = i + 1;
            const active = mood === v;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMood(v)}
                style={{
                  minHeight: 56,
                  borderRadius: 8,
                  border: `1px solid ${active ? "var(--blue-cold)" : "var(--navy-border)"}`,
                  background: active ? "var(--blue-cold)" : "var(--navy-card)",
                  color: active ? "var(--navy)" : "var(--white)",
                  fontFamily: "var(--font-ui)",
                  fontWeight: 600,
                  fontSize: 11,
                  padding: 4,
                  lineHeight: 1.2,
                }}
              >
                {m}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Medication */}
      <div
        style={{
          marginTop: 24,
          padding: 16,
          background: "var(--navy-card)",
          border: "1px solid var(--navy-border)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontFamily: "var(--font-ui)", fontWeight: 500, color: "var(--white)" }}>
          Medication taken today
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={med}
          onClick={() => setMed((m) => !m)}
          style={{
            width: 52,
            height: 30,
            borderRadius: 999,
            border: "none",
            background: med ? "var(--blue-accent)" : "var(--navy-border)",
            position: "relative",
            transition: "background 150ms",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: med ? 25 : 3,
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "var(--white)",
              transition: "left 150ms",
            }}
          />
        </button>
      </div>

      {/* Symptoms */}
      <Section label="New or changed symptoms?">
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          placeholder="Describe any new or changed symptoms..."
          style={{
            width: "100%",
            minHeight: 44,
            background: "var(--navy-card)",
            border: "1px solid var(--navy-border)",
            color: "var(--white)",
            borderRadius: 8,
            padding: "0 12px",
            fontFamily: "var(--font-ui)",
            fontSize: 14,
            outline: "none",
          }}
        />
      </Section>

      {submitError && (
        <p style={{ color: "var(--red)", marginTop: 16, fontSize: 13 }}>{submitError}</p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        style={{
          marginTop: 24,
          width: "100%",
          minHeight: 48,
          borderRadius: 8,
          background: "var(--blue-accent)",
          color: "var(--white)",
          border: "none",
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: 16,
          opacity: submitting ? 0.6 : 1,
        }}
      >
        {submitting ? "Submitting…" : "Submit check-in"}
      </button>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 24 }}>
      <label
        style={{
          display: "block",
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          color: "var(--white)",
          fontSize: 14,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 12,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function NumberRow({ value, onChange }: { value: number | null; onChange: (n: number) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const active = value === n;
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            style={{
              minHeight: 48,
              borderRadius: 8,
              border: `1px solid ${active ? "var(--blue-cold)" : "var(--navy-border)"}`,
              background: active ? "var(--blue-cold)" : "var(--navy-card)",
              color: active ? "var(--navy)" : "var(--white)",
              fontFamily: "var(--font-data)",
              fontWeight: 700,
              fontSize: 18,
            }}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

function RepeatCheckInModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (ctx: "same" | "different", note: string) => void;
}) {
  const [choice, setChoice] = useState<"same" | "different" | null>(null);
  const [note, setNote] = useState("");
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--navy)",
          border: "1px solid var(--navy-border)",
          borderRadius: 14,
          padding: 20,
          maxWidth: 420,
          width: "100%",
          textAlign: "left",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-hero)",
            fontSize: 20,
            color: "var(--white)",
            marginBottom: 6,
          }}
        >
          Another check-in
        </h2>
        <p style={{ color: "var(--white-muted)", fontSize: 13, marginBottom: 16 }}>
          Is this for the same condition as earlier today, or something new?
        </p>

        <div style={{ display: "grid", gap: 10 }}>
          {(["same", "different"] as const).map((k) => {
            const active = choice === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setChoice(k)}
                style={{
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: `1px solid ${active ? "var(--blue-cold)" : "var(--navy-border)"}`,
                  background: active ? "var(--blue-cold)" : "var(--navy-card)",
                  color: active ? "var(--navy)" : "var(--white)",
                  textAlign: "left",
                  fontFamily: "var(--font-data)",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {k === "same" ? "Same condition" : "Different / new condition"}
                </div>
                <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>
                  {k === "same"
                    ? "An update on how the earlier issue is going."
                    : "A new symptom or a different area / concern."}
                </div>
              </button>
            );
          })}
        </div>

        <label
          style={{
            display: "block",
            marginTop: 16,
            fontSize: 12,
            color: "var(--white-muted)",
            fontFamily: "var(--font-data)",
          }}
        >
          Short description (optional)
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={
              choice === "different"
                ? "e.g. sharp pain in left knee since this afternoon"
                : "e.g. worse after physio session"
            }
            style={{
              marginTop: 6,
              width: "100%",
              background: "var(--navy-card)",
              border: "1px solid var(--navy-border)",
              borderRadius: 8,
              padding: 10,
              color: "var(--white)",
              fontFamily: "var(--font-data)",
              fontSize: 13,
              resize: "vertical",
            }}
          />
        </label>

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid var(--navy-border)",
              background: "transparent",
              color: "var(--white)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!choice}
            onClick={() => choice && onConfirm(choice, note.trim())}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "none",
              background: choice ? "var(--green)" : "var(--navy-card)",
              color: choice ? "var(--navy)" : "var(--white-muted)",
              fontWeight: 700,
              cursor: choice ? "pointer" : "not-allowed",
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
