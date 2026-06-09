import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RefreshCw, Copy, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { createClientAccount } from "@/lib/clients.functions";
import { listActivePrograms } from "@/lib/client-program.functions";


export const Route = createFileRoute("/practitioner/app/add-client")({
  head: () => ({ meta: [{ title: "Add Client — Buddy" }] }),
  component: AddClient,
});

const FREQUENCIES: { value: string; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "every_2_days", label: "Every 2 Days" },
  { value: "every_3_days", label: "Every 3 Days" },
  { value: "weekly", label: "Weekly" },
];

function generatePassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 12; i++) out += chars[arr[i] % chars.length];
  return out;
}

function AddClient() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [complaint, setComplaint] = useState("");
  const [notes, setNotes] = useState("");
  const [freq, setFreq] = useState<"daily" | "every_2_days" | "every_3_days" | "weekly">("daily");
  const [password, setPassword] = useState(() => generatePassword());
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [programs, setPrograms] = useState<{ id: string; name: string }[]>([]);
  const [suggestedProgramId, setSuggestedProgramId] = useState<string>("");
  const [programNote, setProgramNote] = useState<string>("");

  useEffect(() => {
    listActivePrograms()
      .then((rows) => setPrograms(rows))
      .catch(() => setPrograms([]));
  }, []);


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!fullName.trim() || !complaint.trim() || !email.trim()) {
      setError("Full name, email, and primary complaint are required.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setError("Not signed in.");
      setSubmitting(false);
      return;
    }
    const result = await createClientAccount({
      data: {
        practitionerId: u.user.id,
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        primaryComplaint: complaint.trim(),
        notes: notes.trim(),
        checkInFrequency: freq,
        suggestedProgramId: suggestedProgramId || null,
        programPersonalNote: suggestedProgramId ? programNote.trim() : "",
      },
    });
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }
    setSuccess({ email: email.trim(), password });
    setFullName("");
    setEmail("");
    setComplaint("");
    setNotes("");
    setFreq("daily");
    setPassword(generatePassword());
    setSuggestedProgramId("");
    setProgramNote("");
    setSubmitting(false);
  };


  const copyCreds = async () => {
    if (!success) return;
    await navigator.clipboard.writeText(`Email: ${success.email}\nPassword: ${success.password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--navy-card)",
    border: "1px solid var(--navy-border)",
    borderRadius: 8,
    padding: "12px 14px",
    color: "var(--white)",
    fontFamily: "var(--font-ui)",
    fontSize: 16,
    minHeight: 48,
  };
  const labelStyle: React.CSSProperties = {
    display: "block",
    color: "var(--white-muted)",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 6,
  };

  return (
    <div style={{ padding: "20px 16px 32px" }}>
      <h1
        style={{
          fontFamily: "var(--font-hero)",
          fontWeight: 400,
          fontSize: 28,
          color: "var(--white)",
        }}
      >
        Add New Client
      </h1>

      {success && (
        <div
          style={{
            marginTop: 16,
            padding: 14,
            background: "color-mix(in oklab, var(--green) 18%, transparent)",
            border: "1px solid var(--green)",
            borderRadius: 10,
            color: "var(--white)",
            fontSize: 14,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Client account created.</div>
          <div style={{ fontFamily: "var(--font-data)", fontSize: 13, lineHeight: 1.6 }}>
            <div>Email: {success.email}</div>
            <div>Password: {success.password}</div>
          </div>
          <button
            type="button"
            onClick={copyCreds}
            style={{
              marginTop: 10,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "1px solid var(--green)",
              borderRadius: 6,
              padding: "6px 10px",
              color: "var(--white)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy credentials"}
          </button>
        </div>
      )}

      <form
        onSubmit={submit}
        style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 16 }}
      >
        <div>
          <label style={labelStyle}>Full Name *</label>
          <input
            style={inputStyle}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>
        <div>
          <label style={labelStyle}>Email *</label>
          <input
            type="email"
            style={inputStyle}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputMode="email"
            required
          />
        </div>
        <div>
          <label style={labelStyle}>Primary Complaint *</label>
          <input
            style={inputStyle}
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            required
          />
        </div>
        <div>
          <label style={labelStyle}>Notes</label>
          <textarea
            style={{ ...inputStyle, minHeight: 96, resize: "vertical" }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle}>Check-in Frequency</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {FREQUENCIES.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setFreq(f.value as typeof freq)}
                style={{
                  minHeight: 44,
                  borderRadius: 8,
                  fontFamily: "var(--font-ui)",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  background: freq === f.value ? "var(--blue-accent)" : "transparent",
                  color: freq === f.value ? "var(--white)" : "var(--white-muted)",
                  border: `1px solid ${freq === f.value ? "var(--blue-accent)" : "var(--navy-border)"}`,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label style={labelStyle}>Suggested Program (optional)</label>
          <select
            value={suggestedProgramId}
            onChange={(e) => setSuggestedProgramId(e.target.value)}
            style={{ ...inputStyle, appearance: "auto" }}
          >
            <option value="">— None —</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--white-muted)" }}>
            If selected, the client will see a friendly intro on first sign-in.
          </div>
        </div>

        {suggestedProgramId && (
          <div>
            <label style={labelStyle}>Personal note (optional)</label>
            <textarea
              value={programNote}
              onChange={(e) => setProgramNote(e.target.value.slice(0, 280))}
              placeholder="A short message your client will see with the suggestion."
              style={{ ...inputStyle, minHeight: 84, resize: "vertical" }}
              maxLength={280}
            />
            <div
              style={{
                marginTop: 6,
                fontSize: 12,
                color: "var(--white-muted)",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>Shown on the final step of their welcome intro.</span>
              <span>{programNote.length}/280</span>
            </div>
          </div>
        )}

        <div>
          <label style={labelStyle}>Initial Password *</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ ...inputStyle, fontFamily: "var(--font-data)", letterSpacing: "0.05em" }}
              minLength={8}
              required
            />
            <button
              type="button"
              onClick={() => setPassword(generatePassword())}
              aria-label="Generate new password"
              style={{
                width: 48,
                height: 48,
                background: "transparent",
                border: "1px solid var(--navy-border)",
                borderRadius: 8,
                color: "var(--white-muted)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <RefreshCw size={18} />
            </button>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--white-muted)" }}>
            Share this password with your client. They sign in with their email and this password.
          </div>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              padding: 12,
              background: "color-mix(in oklab, var(--red) 18%, transparent)",
              border: "1px solid var(--red)",
              borderRadius: 10,
              color: "var(--white)",
              fontSize: 13,
              fontFamily: "var(--font-ui)",
              lineHeight: 1.45,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            minHeight: 48,
            width: "100%",
            background: "var(--blue-accent)",
            color: "var(--white)",
            border: "none",
            borderRadius: 8,
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 16,
            cursor: "pointer",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "Adding…" : "Add Client"}
        </button>
      </form>
    </div>
  );
}
