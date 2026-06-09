import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { X, ExternalLink } from "lucide-react";
import { respondToSuggestedProgram, type ProgramLite } from "@/lib/client-program.functions";

type Props = {
  program: ProgramLite;
  onClose: (status: "accepted" | "declined") => void;
};

export function WelcomeProgramModal({ program, onClose }: Props) {
  const respond = useServerFn(respondToSuggestedProgram);
  const [busy, setBusy] = useState<null | "accept" | "decline">(null);
  const [error, setError] = useState<string | null>(null);

  const handle = async (accept: boolean) => {
    setError(null);
    setBusy(accept ? "accept" : "decline");
    const res = await respond({ data: { accept } });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (accept && program.external_url) {
      window.open(program.external_url, "_blank", "noopener,noreferrer");
    }
    onClose(accept ? "accepted" : "declined");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "var(--navy-card)",
          border: "1px solid var(--navy-border)",
          borderRadius: 14,
          maxWidth: 440,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          position: "relative",
        }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={() => handle(false)}
          disabled={busy !== null}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            background: "transparent",
            border: "none",
            color: "var(--white-muted)",
            cursor: "pointer",
            padding: 6,
          }}
        >
          <X size={20} />
        </button>

        {program.image_url && (
          <img
            src={program.image_url}
            alt=""
            style={{
              width: "100%",
              height: 160,
              objectFit: "cover",
              borderTopLeftRadius: 14,
              borderTopRightRadius: 14,
            }}
          />
        )}

        <div style={{ padding: 22 }}>
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--blue-accent)",
              marginBottom: 6,
            }}
          >
            Welcome to Buddy
          </div>
          <h2
            style={{
              fontFamily: "var(--font-hero)",
              fontWeight: 400,
              fontSize: 24,
              color: "var(--white)",
              margin: "0 0 6px",
            }}
          >
            Your practitioner suggested a program
          </h2>
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 18,
              fontWeight: 600,
              color: "var(--white)",
              marginTop: 14,
            }}
          >
            {program.name}
          </div>
          <p
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 14,
              lineHeight: 1.5,
              color: "var(--white-muted)",
              marginTop: 8,
            }}
          >
            {program.description}
          </p>

          {error && (
            <div
              role="alert"
              style={{
                marginTop: 12,
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

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
            <button
              type="button"
              onClick={() => handle(true)}
              disabled={busy !== null}
              style={{
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
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy === "accept" ? "Joining…" : "Yes, I'll join"}
              {busy !== "accept" && <ExternalLink size={16} />}
            </button>
            <button
              type="button"
              onClick={() => handle(false)}
              disabled={busy !== null}
              style={{
                minHeight: 44,
                background: "transparent",
                color: "var(--white-muted)",
                border: "1px solid var(--navy-border)",
                borderRadius: 8,
                fontFamily: "var(--font-ui)",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy === "decline" ? "Saving…" : "Not now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
