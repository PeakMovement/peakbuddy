import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabase";
import { signInWithQuickCode } from "@/lib/quick-login.functions";
import { QuickCodeKeypad } from "@/components/QuickCodeKeypad";
import { markQuickCodeSession } from "@/lib/quick-login";

interface Props {
  /** Called once a Supabase session exists. */
  onSignedIn: (email: string) => void | Promise<void>;
  /** Prefilled email, if the parent already has one. */
  initialEmail?: string;
  onCancel: () => void;
}

export function QuickCodeSignIn({ onSignedIn, initialEmail = "", onCancel }: Props) {
  const quickSignIn = useServerFn(signInWithQuickCode);
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (code.length === 4 && !busy) void submit(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const submit = async (value: string) => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email first.");
      setCode("");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await quickSignIn({ data: { email: trimmed, code: value } });
      if (!res.ok) {
        setError(res.error);
        setCode("");
        setBusy(false);
        return;
      }
      const { error: otpErr } = await supabase.auth.verifyOtp({
        type: "magiclink",
        token_hash: res.tokenHash,
      });
      if (otpErr) {
        setError("Could not start your session. Try your password instead.");
        setCode("");
        setBusy(false);
        return;
      }
      markQuickCodeSession(true);
      await onSignedIn(trimmed);
    } catch {
      setError("Something went wrong. Try again.");
      setCode("");
    }
    setBusy(false);
  };

  return (
    <div
      style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14, marginTop: 24 }}
    >
      <input
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
        aria-label="Email"
        style={{
          width: "100%",
          height: 52,
          borderRadius: 8,
          background: "var(--navy-card)",
          border: "1px solid var(--navy-border)",
          color: "var(--white)",
          fontFamily: "var(--font-ui)",
          fontSize: 16,
          padding: "0 16px",
          outline: "none",
        }}
      />

      <QuickCodeKeypad
        value={code}
        onChange={setCode}
        disabled={busy}
        label={busy ? "Signing in…" : "Enter your 4-digit code"}
      />

      {error && (
        <p role="alert" style={{ color: "var(--red)", fontSize: 13, textAlign: "center" }}>
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onCancel}
        style={{
          width: "100%",
          minHeight: 48,
          borderRadius: 8,
          background: "transparent",
          border: "1px solid var(--navy-border)",
          color: "var(--white)",
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: 15,
        }}
      >
        Use email and password
      </button>
    </div>
  );
}

export default QuickCodeSignIn;
