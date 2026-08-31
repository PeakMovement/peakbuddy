import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getQuickCodeStatus, setQuickCode, unlockQuickCode } from "@/lib/quick-login.functions";
import { QuickCodeKeypad } from "@/components/QuickCodeKeypad";
import { hasBeenPrompted, markPrompted, isQuickCodeSession } from "@/lib/quick-login";

/**
 * One-time "Set a 4-digit quick code?" prompt, shown after the first
 * email + password login on a device. Mounted inside each app shell.
 */
export function SetQuickCodePrompt() {
  const fetchStatus = useServerFn(getQuickCodeStatus);
  const saveCode = useServerFn(setQuickCode);
  const unlock = useServerFn(unlockQuickCode);

  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!alive || !uid) return;
      setUserId(uid);
      try {
        const status = await fetchStatus();
        // A full password login clears any lockout.
        if (status.locked && !isQuickCodeSession()) await unlock({});
        if (status.enabled) return;
        if (hasBeenPrompted(uid)) return;
        if (alive) setOpen(true);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, [fetchStatus, unlock]);

  const dismiss = () => {
    if (userId) markPrompted(userId);
    setOpen(false);
  };

  const onDigits = (next: string) => {
    setError(null);
    if (step === "enter") {
      setFirst(next);
      if (next.length === 4) setStep("confirm");
    } else {
      setSecond(next);
      if (next.length === 4) void submit(first, next);
    }
  };

  const submit = async (a: string, b: string) => {
    if (a !== b) {
      setError("Those codes didn't match. Start again.");
      setStep("enter");
      setFirst("");
      setSecond("");
      return;
    }
    setBusy(true);
    const res = await saveCode({ data: { code: a } });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      setStep("enter");
      setFirst("");
      setSecond("");
      return;
    }
    dismiss();
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Set a quick sign-in code"
      onClick={dismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(4, 10, 22, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 360,
          background: "var(--navy-card)",
          border: "1px solid var(--navy-border)",
          borderRadius: 14,
          padding: 22,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-hero)",
            fontWeight: 400,
            fontSize: 20,
            color: "var(--white)",
            textAlign: "center",
          }}
        >
          Set a 4-digit quick code?
        </h2>
        <p
          style={{
            color: "var(--white-muted)",
            fontSize: 13,
            lineHeight: 1.5,
            textAlign: "center",
            margin: "8px 0 18px",
          }}
        >
          Next time you can sign in with your email and 4 digits instead of your password.
        </p>

        <QuickCodeKeypad
          value={step === "enter" ? first : second}
          onChange={onDigits}
          disabled={busy}
          label={step === "enter" ? "Choose a code" : "Confirm your code"}
        />

        {error && (
          <p
            role="alert"
            style={{ color: "var(--red)", fontSize: 13, textAlign: "center", marginTop: 10 }}
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={dismiss}
          style={{
            marginTop: 18,
            width: "100%",
            minHeight: 44,
            borderRadius: 8,
            background: "transparent",
            border: "1px solid var(--navy-border)",
            color: "var(--white-muted)",
            fontFamily: "var(--font-ui)",
            fontSize: 14,
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

export default SetQuickCodePrompt;
