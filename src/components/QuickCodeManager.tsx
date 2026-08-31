import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound } from "lucide-react";
import {
  clearQuickCode,
  getQuickCodeStatus,
  setQuickCode,
} from "@/lib/quick-login.functions";
import { QuickCodeKeypad } from "@/components/QuickCodeKeypad";

/**
 * Reusable "Quick sign-in code" card for the client profile and the
 * practitioner / admin settings screens.
 */
export function QuickCodeManager() {
  const fetchStatus = useServerFn(getQuickCodeStatus);
  const saveCode = useServerFn(setQuickCode);
  const removeCode = useServerFn(clearQuickCode);

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const s = await fetchStatus();
        if (!alive) return;
        setEnabled(s.enabled);
        setLocked(s.locked);
      } catch {
        /* ignore */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fetchStatus]);

  const reset = () => {
    setEditing(false);
    setStep("enter");
    setFirst("");
    setSecond("");
    setError(null);
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
    setEnabled(true);
    setLocked(false);
    setNotice("Quick code saved.");
    reset();
  };

  const onRemove = async () => {
    setBusy(true);
    await removeCode({});
    setBusy(false);
    setEnabled(false);
    setLocked(false);
    setNotice("Quick code removed.");
  };

  if (loading) return null;

  return (
    <section
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <KeyRound size={16} color="var(--blue-accent)" />
        <h2
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 14,
            color: "var(--white)",
          }}
        >
          Quick sign-in code
        </h2>
      </div>

      <p style={{ color: "var(--white-muted)", fontSize: 13, lineHeight: 1.5 }}>
        {enabled
          ? locked
            ? "Your quick code is locked after too many wrong tries. It unlocked when you signed in with your password — set a new one if you'd like."
            : "You can sign in with your email and 4-digit code instead of your password."
          : "Set a 4-digit code to sign in faster next time. You can still use your password any time."}
      </p>

      {editing ? (
        <div style={{ marginTop: 6 }}>
          <QuickCodeKeypad
            value={step === "enter" ? first : second}
            onChange={onDigits}
            disabled={busy}
            label={step === "enter" ? "Choose a 4-digit code" : "Confirm your code"}
          />
          {error && (
            <p role="alert" style={{ color: "var(--red)", fontSize: 13, textAlign: "center" }}>
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 14,
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
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setEditing(true);
            }}
            style={{
              flex: 1,
              minWidth: 140,
              minHeight: 44,
              borderRadius: 8,
              background: "var(--blue-accent)",
              border: "none",
              color: "var(--white)",
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {enabled ? "Change code" : "Set up code"}
          </button>
          {enabled && (
            <button
              type="button"
              onClick={() => void onRemove()}
              disabled={busy}
              style={{
                flex: 1,
                minWidth: 140,
                minHeight: 44,
                borderRadius: 8,
                background: "transparent",
                border: "1px solid var(--navy-border)",
                color: "var(--white-muted)",
                fontFamily: "var(--font-ui)",
                fontSize: 14,
              }}
            >
              Turn off
            </button>
          )}
        </div>
      )}

      {notice && !editing && (
        <p style={{ color: "var(--white-muted)", fontSize: 12 }}>{notice}</p>
      )}
    </section>
  );
}

export default QuickCodeManager;
