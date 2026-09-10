import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";
import { getPopiaStatus, acceptPopiaConsent } from "@/lib/popia-consent.functions";

/**
 * First-run POPIA data-processing consent. Blocks the client app until accepted.
 * Non-dismissible (there is no close button) — consent is required to proceed.
 * Self-gating: renders nothing unless the client hasn't accepted yet.
 */
export function PopiaConsentModal() {
  const fetchStatus = useServerFn(getPopiaStatus);
  const accept = useServerFn(acceptPopiaConsent);
  const [show, setShow] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchStatus()
      .then((r) => {
        if (!cancelled && r && r.accepted === false) setShow(true);
      })
      .catch(() => {
        /* fail open — don't block the app on a lookup error */
      });
    return () => {
      cancelled = true;
    };
  }, [fetchStatus]);

  if (!show) return null;

  const onAccept = async () => {
    if (!checked || saving) return;
    setSaving(true);
    setError(null);
    try {
      await accept();
      setShow(false);
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
        <h2 style={title}>Before you start</h2>
        <p style={body}>
          Buddy records the symptoms and wellbeing check-ins you log, and shares them with your
          practitioner so they can support your care. If you connect a wearable, its health data is
          included too.
        </p>
        <p style={body}>
          In line with South Africa's POPIA, we process your personal and health information only to
          provide this service to you and your practitioner. We don't sell it, and you can ask your
          practitioner to remove your data at any time. Full detail is in our{" "}
          <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={link}>
            Privacy Policy
          </a>
          .
        </p>

        <label style={checkRow}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            style={{ marginTop: 3, flex: "0 0 auto" }}
          />
          <span style={{ fontFamily: "var(--font-ui)", fontSize: 14, lineHeight: 1.5, color: "var(--white)" }}>
            I consent to Buddy processing my personal and health information as described, and to
            sharing it with my practitioner.
          </span>
        </label>

        {error && (
          <div style={{ color: "var(--red)", fontFamily: "var(--font-ui)", fontSize: 13, marginTop: 10 }}>
            {error}
          </div>
        )}

        <button type="button" onClick={onAccept} disabled={!checked || saving} style={cta(!checked || saving)}>
          {saving ? "Saving…" : "I agree — continue"}
        </button>
        <p style={fine}>
          You need to agree to use Buddy. If you'd prefer not to, close the app and speak to your
          practitioner.
        </p>
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
