import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/lib/supabase";
import { signInWithQuickCode } from "@/lib/quick-login.functions";
import { QuickCodeKeypad } from "@/components/QuickCodeKeypad";
import { markQuickCodeSession } from "@/lib/quick-login";
import { withTimeout } from "@/lib/with-timeout";

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
  // When the device already remembers who this is, the code alone is enough —
  // asking for the email again on every sign-in defeats the point of a quick
  // code. The field is still one tap away for a shared or borrowed device.
  const [askForEmail, setAskForEmail] = useState(!initialEmail.trim());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const res = await withTimeout(quickSignIn({ data: { email: trimmed, code: value } }));
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
      {askForEmail ? (
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
      ) : (
        <div
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            minHeight: 52,
            borderRadius: 8,
            background: "var(--navy-card)",
            border: "1px solid var(--navy-border)",
            padding: "0 16px",
          }}
        >
          <span
            style={{
              color: "var(--white)",
              fontFamily: "var(--font-ui)",
              fontSize: 15,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {email}
          </span>
          <button
            type="button"
            onClick={() => {
              setAskForEmail(true);
              setEmail("");
              setError(null);
              setCode("");
            }}
            style={{
              flexShrink: 0,
              minHeight: 44,
              background: "transparent",
              border: "none",
              padding: "0 4px",
              color: "var(--cold-blue, #7FB2D9)",
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 14,
              textDecoration: "underline",
            }}
          >
            Not you?
          </button>
        </div>
      )}

      <QuickCodeKeypad
        value={code}
        onChange={setCode}
        disabled={busy}
        label={busy ? "Signing in…" : "Enter your 4-digit code"}
        onSubmit={() => void submit(code)}
        submitLabel={busy ? "Signing in…" : "Sign in"}
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
