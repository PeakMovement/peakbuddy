import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getClientId, startOfTodayISO } from "@/lib/client-session";
import { analyzeRealTime } from "@/lib/yves";
import { fireAlertWebhook, findRecentOpenAlert } from "@/lib/webhooks";
import type { CheckIn, Client } from "@/lib/types";

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

  useEffect(() => {
    const id = getClientId();
    if (!id) return;
    (async () => {
      const [{ data: c }, { data: ci }] = await Promise.all([
        supabase.from("clients").select("*").eq("id", id).maybeSingle(),
        supabase
          .from("check_ins")
          .select("*")
          .eq("client_id", id)
          .gte("created_at", startOfTodayISO())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      setClient(c as Client | null);
      setTodayCheckIn(ci as CheckIn | null);
      setLoading(false);
    })();
  }, []);

  const submit = async () => {
    if (!client) return;
    setSubmitError(null);
    setSubmitting(true);

    const rt = analyzeRealTime(notes);
    const notesFlagged = rt.detected && rt.severity >= 6;
    const flagged = pain >= 7 || notesFlagged;

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
    });

    if (insErr || !newId) {
      console.error("[Check-in] insert_check_in failed:", insErr);
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
          console.error("[Check-in] insert_alert failed:", e);
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
          await supabase
            .from("alerts")
            .update({ webhook_fired: true })
            .eq("id", alertRowId);
        }
      } else {
        console.log("[Buddy] Duplicate alert suppressed for client:", client.id);
      }
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
  };

  if (loading) {
    return <div style={{ padding: 24, color: "var(--white-muted)" }}>Loading…</div>;
  }

  if (success || todayCheckIn) {
    const ci = todayCheckIn;
    return (
      <div style={{ padding: "32px 20px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: "50%",
            border: "3px solid var(--green)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginTop: 32,
            animation: "pulse 1.6s ease-out",
          }}
        >
          <CheckCircle2 size={48} color="var(--green)" />
        </div>
        <h1 style={{ fontFamily: "var(--font-hero)", fontSize: 26, marginTop: 24, color: "var(--white)" }}>
          {success ? "Check-in complete. Well done." : "Already checked in today."}
        </h1>
        {!success && (
          <p style={{ marginTop: 8, color: "var(--white-muted)" }}>See you tomorrow.</p>
        )}
        {ci?.pain_level != null && (
          <p style={{ marginTop: 24, fontFamily: "var(--font-data)", color: "var(--white-muted)" }}>
            Last pain score:{" "}
            <span style={{ color: painColor(ci.pain_level), fontSize: 20 }}>
              {ci.pain_level}/10
            </span>
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 20px 32px" }}>
      <h1 style={{ fontFamily: "var(--font-hero)", fontWeight: 400, fontSize: 24, color: "var(--white)" }}>
        How are you feeling today?
      </h1>
      <p style={{ marginTop: 6, fontFamily: "var(--font-data)", fontSize: 12, color: "var(--white-muted)" }}>
        {todayLabel}
      </p>

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
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: 11, color: "var(--white-muted)", fontFamily: "var(--font-data)" }}>
            <span>0</span><span>10</span>
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

      {/* Notes */}
      <Section label="Anything else to add?">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="Describe how you're feeling in your own words..."
          style={{
            width: "100%",
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
