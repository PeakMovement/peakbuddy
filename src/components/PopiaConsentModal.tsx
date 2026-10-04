import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";
import { getPopiaStatus, acceptPopiaConsent } from "@/lib/popia-consent.functions";
import { currentConsent } from "@/lib/consent/wording";

type Gate = "loading" | "error" | "needs_consent" | "ok";

/**
 * First-run POPIA data-processing consent. Blocks the client app until accepted.
 * Non-dismissible — consent is required to proceed. Fail closed: a lookup error
 * keeps the overlay up until consent status can be verified.
 */
export function PopiaConsentModal() {
  const fetchStatus = useServerFn(getPopiaStatus);
  const accept = useServerFn(acceptPopiaConsent);
  const [gate, setGate] = useState<Gate>("loading");
  const [reconsent, setReconsent] = useState(false);
  const [checked, setChecked] = useState(false);
  const [readToEnd, setReadToEnd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setGate("loading");
    setError(null);
    try {
      const r = await fetchStatus();
      setReconsent(r?.needsReconsent === true);
      setGate(r?.accepted === true ? "ok" : "needs_consent");
    } catch {
      setGate("error");
      setError("We couldn't verify your privacy consent. Check your connection and try again.");
    }
  }, [fetchStatus]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const consent = currentConsent("popia_core");

  // Enabling the button only once they have reached the bottom is the one piece
  // of evidence a tap alone cannot give: that the wording was actually in front
  // of them. Generous threshold so a short viewport or a trackpad overshoot
  // does not trap anyone.
  const onScroll = (e: { currentTarget: HTMLDivElement }) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setReadToEnd(true);
  };

  if (gate === "ok") return null;

  const onAccept = async () => {
    if (!checked || saving || gate !== "needs_consent") return;
    setSaving(true);
    setError(null);
    try {
      await accept({
        data: {
          type: "popia_core",
          channel: "pwa",
          version: consent.version,
          userAgent:
            typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 400) : undefined,
        },
      });
      setGate("ok");
    } catch {
      setError("Couldn't save your consent. Please check your connection and try again.");
      setSaving(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Data processing consent" style={overlay}>
      <div style={modal}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <ShieldCheck size={22} color="var(--blue-accent)" aria-hidden />
          <span style={eyebrow}>Your privacy</span>
        </div>
        <h2 style={title}>
          {gate === "error"
            ? "We need to check your consent"
            : reconsent
              ? "We've updated this"
              : consent.heading}
        </h2>
        {gate === "loading" && <p style={body}>Checking your privacy consent…</p>}
        {gate === "error" && (
          <>
            <p style={body}>{error}</p>
            <button type="button" onClick={() => void loadStatus()} style={cta(false)}>
              Try again
            </button>
          </>
        )}
        {gate === "needs_consent" && (
          <>
            {reconsent && (
              <p style={body}>
                We have changed what this says since you last agreed, so please read it again. It
                now names the companies that handle your information and says that some of it is
                processed outside South Africa. Nothing about your treatment changes.
              </p>
            )}
            <div style={scroller} onScroll={onScroll}>
              {consent.sections.map((sec, i) => (
                <div key={i} style={{ marginBottom: 14 }}>
                  {sec.heading && <div style={sectionHeading}>{sec.heading}</div>}
                  <p style={{ ...body, margin: 0 }}>{sec.body}</p>
                </div>
              ))}
              <p style={{ ...body, margin: 0 }}>
                Full detail is in our{" "}
                <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={link}>
                  Privacy Policy
                </a>
                .
              </p>
            </div>
            {!readToEnd && (
              <p style={fine}>Scroll to the end before you agree.</p>
            )}

            <label style={checkRow}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                style={{ marginTop: 3, flex: "0 0 auto" }}
              />
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 14,
                  lineHeight: 1.5,
                  color: "var(--white)",
                }}
              >
                {consent.affirmation}
              </span>
            </label>

            {error && (
              <div
                style={{
                  color: "var(--red)",
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  marginTop: 10,
                }}
              >
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={onAccept}
              disabled={!checked || !readToEnd || saving}
              style={cta(!checked || !readToEnd || saving)}
            >
              {saving ? "Saving…" : "I agree — continue"}
            </button>
            <p style={fine}>
              You need to agree to use Buddy. If you'd prefer not to, close the app and speak to
              your practitioner.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default PopiaConsentModal;

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(4,8,20,0.82)",
  backdropFilter: "blur(3px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  zIndex: 90,
};
const modal: CSSProperties = {
  maxWidth: 400,
  width: "100%",
  background: "linear-gradient(165deg, var(--navy-card), var(--navy))",
  border: "1px solid var(--navy-border)",
  borderRadius: 20,
  padding: "24px 22px",
};
const eyebrow: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--white-muted)",
};
const title: CSSProperties = {
  fontFamily: "var(--font-hero)",
  fontSize: 22,
  fontWeight: 700,
  color: "var(--white)",
  margin: "0 0 10px",
};
const body: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 14,
  lineHeight: 1.55,
  color: "var(--white-muted)",
  margin: "0 0 12px",
};
const scroller: CSSProperties = {
  maxHeight: "42vh",
  overflowY: "auto",
  padding: "4px 10px 4px 0",
  marginBottom: 10,
};
const sectionHeading: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  fontWeight: 700,
  color: "var(--white)",
  marginBottom: 3,
};
const link: CSSProperties = { color: "var(--blue-accent)", textDecoration: "underline" };
const checkRow: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  marginTop: 8,
  cursor: "pointer",
};
const cta = (disabled: boolean): CSSProperties => ({
  width: "100%",
  marginTop: 18,
  background: disabled ? "rgba(74,141,240,0.4)" : "var(--blue-accent)",
  color: "var(--navy)",
  border: "none",
  borderRadius: 12,
  padding: "13px 16px",
  fontFamily: "var(--font-ui)",
  fontSize: 15,
  fontWeight: 700,
  cursor: disabled ? "default" : "pointer",
});
const fine: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  lineHeight: 1.5,
  color: "var(--white-muted)",
  opacity: 0.8,
  marginTop: 12,
  textAlign: "center",
};
