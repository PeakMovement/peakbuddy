import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/practitioner/onboarding")({
  head: () => ({ meta: [{ title: "Onboarding — Buddy" }] }),
  component: Onboarding,
});

const PROFESSIONS = [
  "Physiotherapist",
  "Biokineticist",
  "Chiropractor",
  "Sports Scientist",
  "Personal Trainer",
  "Strength and Conditioning Coach",
  "Other",
];

const POPIA_TEXT = `BUDDY HEALTH — POPIA COMPLIANCE NOTICE

Who collects the data: Buddy Health is operated by Peak Movement Medical. Buddy acts as an operator of personal information on behalf of you, the responsible party, in relation to your patients and clients.

What data is collected: Buddy collects and stores full name and contact details, daily symptom logs including pain, sleep, stress, energy and mood scores, free-text symptom descriptions, red flag alerts and clinical triage outputs, and device and usage data for platform improvement.

Why it is collected: This data is collected solely to support remote monitoring of your clients between clinical sessions, to surface red flag symptoms, and to provide trend data to inform your clinical decisions.

How it is stored: All data is stored on Supabase infrastructure with row-level security. Your client data is isolated to your practitioner account and is not visible to any other practitioner. Only Buddy super administrators can access cross-practitioner data for platform management purposes.

Your obligations: By registering you confirm that you have obtained informed consent from each client before enrolling them, you have informed clients their health data will be stored digitally, you will not enrol anyone under 18 without guardian consent, and you will notify Buddy if a client withdraws consent.

Retention and deletion: Client data is retained for the duration of their active monitoring period. You may request deletion at any time. Data is never sold or shared with third parties for commercial purposes.

Data breach notification: In the event of a breach Buddy will notify you within 72 hours.

By proceeding you confirm you are a registered or licensed healthcare or fitness professional and accept full responsibility for obtaining consent from each client you enrol.`;

function Onboarding() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [fullName, setFullName] = useState("");
  const [profession, setProfession] = useState("");
  const [practiceName, setPracticeName] = useState("");

  const [popiaOk, setPopiaOk] = useState(false);
  const [dpaOk, setDpaOk] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        navigate({ to: "/practitioner/login" });
        return;
      }
      setUserId(data.user.id);
      const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
      const metaName =
        (typeof meta.full_name === "string" && meta.full_name) ||
        (typeof meta.name === "string" && meta.name) ||
        "";
      setFullName(metaName);
    })();
  }, [navigate]);

  const completeOnboarding = async () => {
    if (!userId) return;
    setError(null);
    setSaving(true);

    const now = new Date().toISOString();

    const { error: profErr } = await supabase.from("profiles").upsert(
      {
        id: userId,
        role: "practitioner",
        full_name: fullName,
        profession,
      },
      { onConflict: "id" },
    );

    if (profErr) {
      setSaving(false);
      setError(profErr.message);
      return;
    }

    const { error: prErr } = await supabase.from("practices").upsert(
      {
        practitioner_id: userId,
        practice_name: practiceName,
        profession,
        popia_agreed: true,
        popia_agreed_at: now,
        data_processing_agreed: true,
        data_processing_agreed_at: now,
        onboarding_complete: true,
      },
      { onConflict: "practitioner_id" },
    );

    if (prErr) {
      setSaving(false);
      setError(prErr.message);
      return;
    }

    setSaving(false);
    navigate({ to: "/practitioner/app/dashboard" });
  };

  const step1Valid = fullName.trim() && profession && practiceName.trim();

  return (
    <main
      className="safe-area"
      style={{
        minHeight: "100vh",
        background: "var(--navy)",
        padding: "32px 20px",
      }}
    >
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <Stepper step={step} />

        {step === 1 && (
          <section style={{ marginTop: 32 }}>
            <h1 style={heroStyle}>Set up your practice</h1>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 24 }}>
              <Field label="Full name">
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  style={inputStyle}
                />
              </Field>

              <Field label="Profession">
                <select
                  value={profession}
                  onChange={(e) => setProfession(e.target.value)}
                  style={{ ...inputStyle, appearance: "none" }}
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {PROFESSIONS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Practice name">
                <input
                  value={practiceName}
                  onChange={(e) => setPracticeName(e.target.value)}
                  style={inputStyle}
                />
              </Field>
            </div>

            <button
              type="button"
              disabled={!step1Valid}
              onClick={() => setStep(2)}
              style={{ ...primaryBtn, marginTop: 32, opacity: step1Valid ? 1 : 0.5 }}
            >
              Continue
            </button>
          </section>
        )}

        {step === 2 && (
          <section style={{ marginTop: 32 }}>
            <h1 style={heroStyle}>Before you start</h1>

            <div
              style={{
                marginTop: 20,
                background: "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                borderRadius: 8,
                padding: 16,
                maxHeight: 280,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
                color: "var(--white-muted)",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              {POPIA_TEXT}
            </div>

            <CheckboxRow checked={popiaOk} onChange={setPopiaOk}>
              I have read and accept the POPIA compliance notice
            </CheckboxRow>
            <CheckboxRow checked={dpaOk} onChange={setDpaOk}>
              I agree to Buddy holding and processing my patients' personal data on my behalf
            </CheckboxRow>

            <button
              type="button"
              disabled={!(popiaOk && dpaOk)}
              onClick={() => setStep(3)}
              style={{ ...primaryBtn, marginTop: 24, opacity: popiaOk && dpaOk ? 1 : 0.5 }}
            >
              Continue
            </button>
          </section>
        )}

        {step === 3 && (
          <section
            style={{
              marginTop: 48,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: "50%",
                border: "3px solid var(--green)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CheckCircle2 size={56} color="var(--green)" />
            </div>
            <h1 style={{ ...heroStyle, marginTop: 24 }}>You're all set.</h1>
            <p style={{ marginTop: 12, color: "var(--white-muted)", fontSize: 15 }}>
              Your practice is ready. Start by adding your first client.
            </p>

            {error && <p style={{ color: "var(--red)", marginTop: 16, fontSize: 13 }}>{error}</p>}

            <button
              type="button"
              onClick={completeOnboarding}
              disabled={saving}
              style={{ ...primaryBtn, marginTop: 32, opacity: saving ? 0.6 : 1 }}
            >
              {saving ? "Saving…" : "Go to my dashboard"}
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {[1, 2, 3].map((n, i) => {
        const active = step === n;
        const done = step > n;
        return (
          <div key={n} style={{ display: "flex", alignItems: "center", flex: 1, gap: 8 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                border: `1px solid ${active || done ? "var(--blue-accent)" : "var(--navy-border)"}`,
                background: done ? "var(--blue-accent)" : "transparent",
                color: done ? "var(--white)" : active ? "var(--blue-accent)" : "var(--white-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-data)",
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {n}
            </div>
            {i < 2 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: step > n ? "var(--blue-accent)" : "var(--navy-border)",
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function CheckboxRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        marginTop: 16,
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        background: "transparent",
        border: "none",
        color: "var(--white)",
        textAlign: "left",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          marginTop: 2,
          flexShrink: 0,
          width: 22,
          height: 22,
          borderRadius: 4,
          border: `1px solid ${checked ? "var(--blue-accent)" : "var(--navy-border)"}`,
          background: checked ? "var(--blue-accent)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--white)",
          fontSize: 14,
          fontWeight: 700,
        }}
      >
        {checked ? "✓" : ""}
      </span>
      <span style={{ fontSize: 14, lineHeight: 1.4 }}>{children}</span>
    </button>
  );
}

const heroStyle: React.CSSProperties = {
  fontFamily: "var(--font-hero)",
  fontWeight: 400,
  fontSize: 28,
  color: "var(--white)",
  lineHeight: 1.1,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 48,
  borderRadius: 8,
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  color: "var(--white)",
  fontFamily: "var(--font-ui)",
  fontSize: 16,
  padding: "0 14px",
  outline: "none",
};

const primaryBtn: React.CSSProperties = {
  width: "100%",
  minHeight: 48,
  borderRadius: 8,
  background: "var(--blue-accent)",
  color: "var(--white)",
  border: "none",
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 16,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--white-muted)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
