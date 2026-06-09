import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { X, ExternalLink, ArrowRight, ArrowLeft, Sparkles, Clock, Target, Check } from "lucide-react";
import {
  respondToSuggestedProgram,
  type ProgramLite,
  type ProgramDecision,
} from "@/lib/client-program.functions";

type Props = {
  program: ProgramLite;
  personalNote: string | null;
  clientFirstName?: string | null;
  onClose: (decision: ProgramDecision) => void;
};

const STEPS = 3;

export function ProgramIntroModal({ program, personalNote, clientFirstName, onClose }: Props) {
  const respond = useServerFn(respondToSuggestedProgram);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<null | ProgramDecision>(null);
  const [error, setError] = useState<string | null>(null);

  const cover = program.cover_image_url || program.image_url;
  const outcomes = program.outcomes ?? [];

  const submit = async (decision: ProgramDecision) => {
    setError(null);
    setBusy(decision);
    const res = await respond({ data: { decision } });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (decision === "accepted" && program.external_url) {
      window.open(program.external_url, "_blank", "noopener,noreferrer");
    }
    onClose(decision);
  };

  // Closing via X counts as "remind me later" — friendly default.
  const handleDismiss = () => {
    if (busy) return;
    submit("remind_later");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.72)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--navy-card)",
          border: "1px solid var(--navy-border)",
          borderRadius: 14,
          maxWidth: 460,
          width: "100%",
          maxHeight: "92vh",
          overflowY: "auto",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={handleDismiss}
          disabled={busy !== null}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            background: "rgba(0,0,0,0.35)",
            border: "none",
            color: "var(--white)",
            cursor: "pointer",
            padding: 6,
            borderRadius: 999,
            zIndex: 2,
          }}
        >
          <X size={18} />
        </button>

        {step === 0 && <StepWelcome firstName={clientFirstName} />}
        {step === 1 && <StepProgram program={program} cover={cover} outcomes={outcomes} />}
        {step === 2 && <StepDecide program={program} personalNote={personalNote} />}

        {error && (
          <div
            role="alert"
            style={{
              margin: "0 22px",
              padding: 10,
              background: "color-mix(in oklab, var(--red) 18%, transparent)",
              border: "1px solid var(--red)",
              borderRadius: 8,
              color: "var(--white)",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ padding: "16px 22px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          {step < STEPS - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(STEPS - 1, s + 1))}
              style={primaryBtn}
            >
              {step === 0 ? "Show me" : "Next"} <ArrowRight size={16} />
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                type="button"
                onClick={() => submit("accepted")}
                disabled={busy !== null}
                style={{ ...primaryBtn, opacity: busy ? 0.7 : 1 }}
              >
                {busy === "accepted" ? "Joining…" : (<>Yes, start now <ExternalLink size={16} /></>)}
              </button>
              <button
                type="button"
                onClick={() => submit("remind_later")}
                disabled={busy !== null}
                style={{ ...secondaryBtn, opacity: busy ? 0.7 : 1 }}
              >
                {busy === "remind_later" ? "Saving…" : "Remind me later"}
              </button>
              <button
                type="button"
                onClick={() => submit("declined")}
                disabled={busy !== null}
                style={{ ...tertiaryBtn, opacity: busy ? 0.7 : 1 }}
              >
                {busy === "declined" ? "Saving…" : "Not for me"}
              </button>
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 4,
            }}
          >
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                style={backBtn}
              >
                <ArrowLeft size={14} /> Back
              </button>
            ) : (
              <span />
            )}
            <div style={{ display: "flex", gap: 6 }} aria-hidden>
              {Array.from({ length: STEPS }).map((_, i) => (
                <span
                  key={i}
                  style={{
                    width: i === step ? 18 : 7,
                    height: 7,
                    borderRadius: 999,
                    background: i === step ? "var(--blue-accent)" : "var(--navy-border)",
                    transition: "all 200ms ease",
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepWelcome({ firstName }: { firstName?: string | null }) {
  const name = (firstName ?? "").trim();
  return (
    <div style={{ padding: "44px 26px 18px", textAlign: "center" }}>
      <div
        style={{
          width: 56,
          height: 56,
          margin: "0 auto 16px",
          borderRadius: "50%",
          background: "color-mix(in oklab, var(--blue-accent) 22%, transparent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--blue-accent)",
        }}
      >
        <Sparkles size={26} />
      </div>
      <div style={kickerStyle}>Welcome to Buddy</div>
      <h2 style={titleStyle}>
        {name ? `Hi ${name} 👋` : "You're in"}
      </h2>
      <p style={bodyStyle}>
        Your practitioner has picked something for you to try alongside Buddy.
        Take a quick look — you decide if it's a fit.
      </p>
    </div>
  );
}

function StepProgram({
  program,
  cover,
  outcomes,
}: {
  program: ProgramLite;
  cover: string | null;
  outcomes: string[];
}) {
  return (
    <div>
      {cover ? (
        <img
          src={cover}
          alt=""
          style={{
            width: "100%",
            height: 180,
            objectFit: "cover",
            borderTopLeftRadius: 14,
            borderTopRightRadius: 14,
          }}
        />
      ) : (
        <div
          style={{
            height: 100,
            background:
              "linear-gradient(135deg, color-mix(in oklab, var(--blue-accent) 30%, transparent), transparent)",
            borderTopLeftRadius: 14,
            borderTopRightRadius: 14,
          }}
        />
      )}
      <div style={{ padding: "20px 22px 4px" }}>
        <div style={kickerStyle}>Your suggested program</div>
        <h2 style={{ ...titleStyle, fontSize: 22, textAlign: "left", marginTop: 6 }}>
          {program.name}
        </h2>

        {(program.duration_label || program.focus_area) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {program.duration_label && <Tag icon={<Clock size={12} />} label={program.duration_label} />}
            {program.focus_area && <Tag icon={<Target size={12} />} label={program.focus_area} />}
          </div>
        )}

        {program.description && (
          <p style={{ ...bodyStyle, textAlign: "left", marginTop: 12 }}>{program.description}</p>
        )}

        {outcomes.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div
              style={{
                ...kickerStyle,
                fontSize: 10,
                color: "var(--white-muted)",
                marginBottom: 8,
              }}
            >
              What you'll get
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {outcomes.slice(0, 4).map((o) => (
                <li
                  key={o}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    color: "var(--white)",
                    fontSize: 14,
                    fontFamily: "var(--font-ui)",
                    lineHeight: 1.4,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: "color-mix(in oklab, var(--blue-accent) 22%, transparent)",
                      color: "var(--blue-accent)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 1,
                    }}
                  >
                    <Check size={13} />
                  </span>
                  {o}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function StepDecide({
  program,
  personalNote,
}: {
  program: ProgramLite;
  personalNote: string | null;
}) {
  return (
    <div style={{ padding: "30px 22px 4px" }}>
      <div style={kickerStyle}>Ready when you are</div>
      <h2 style={{ ...titleStyle, fontSize: 22, marginTop: 6 }}>
        Want to try {program.name}?
      </h2>
      <p style={{ ...bodyStyle, marginTop: 8 }}>
        No pressure — you can start now, decide later, or skip it. Your choice shows
        up on your profile either way.
      </p>

      {personalNote && (
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            borderRadius: 10,
            background: "color-mix(in oklab, var(--blue-accent) 10%, transparent)",
            border: "1px solid color-mix(in oklab, var(--blue-accent) 35%, transparent)",
          }}
        >
          <div
            style={{
              ...kickerStyle,
              fontSize: 10,
              color: "var(--blue-accent)",
              marginBottom: 6,
              textAlign: "left",
            }}
          >
            A note from your practitioner
          </div>
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 14,
              color: "var(--white)",
              lineHeight: 1.5,
              fontStyle: "italic",
            }}
          >
            "{personalNote}"
          </div>
        </div>
      )}
    </div>
  );
}

function Tag({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 9px",
        borderRadius: 999,
        background: "var(--navy)",
        border: "1px solid var(--navy-border)",
        color: "var(--white-muted)",
        fontSize: 12,
        fontFamily: "var(--font-ui)",
        fontWeight: 600,
      }}
    >
      {icon}
      {label}
    </span>
  );
}

const kickerStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--blue-accent)",
  textAlign: "center",
};

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-hero)",
  fontWeight: 400,
  fontSize: 26,
  color: "var(--white)",
  margin: "6px 0 8px",
  textAlign: "center",
  lineHeight: 1.2,
};

const bodyStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 14,
  lineHeight: 1.5,
  color: "var(--white-muted)",
  textAlign: "center",
  margin: 0,
};

const primaryBtn: React.CSSProperties = {
  minHeight: 48,
  background: "var(--blue-accent)",
  color: "var(--white)",
  border: "none",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 15,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
};

const secondaryBtn: React.CSSProperties = {
  minHeight: 44,
  background: "transparent",
  color: "var(--white)",
  border: "1px solid var(--blue-accent)",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};

const tertiaryBtn: React.CSSProperties = {
  minHeight: 40,
  background: "transparent",
  color: "var(--white-muted)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};

const backBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--white-muted)",
  cursor: "pointer",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: 4,
};
