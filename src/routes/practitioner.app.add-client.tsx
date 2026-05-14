import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";

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

function genCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = genCode();
    const { data } = await supabase.from("clients").select("id").eq("login_code", code).maybeSingle();
    if (!data) return code;
  }
  return genCode();
}

function AddClient() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [complaint, setComplaint] = useState("");
  const [notes, setNotes] = useState("");
  const [freq, setFreq] = useState("daily");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    generateUniqueCode().then(setCode);
  }, []);

  const refreshCode = async () => {
    setCode("");
    setCode(await generateUniqueCode());
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!fullName.trim() || !complaint.trim()) {
      setError("Full name and primary complaint are required.");
      return;
    }
    setSubmitting(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setError("Not signed in.");
      setSubmitting(false);
      return;
    }
    const { error: insErr } = await supabase.from("clients").insert({
      practitioner_id: u.user.id,
      full_name: fullName.trim(),
      email: email.trim(),
      primary_complaint: complaint.trim(),
      notes: notes.trim(),
      check_in_frequency: freq,
      login_code: code,
      popia_accepted: false,
    });
    if (insErr) {
      setError(insErr.message);
      setSubmitting(false);
      return;
    }
    setSuccess(`Client added. Their login code is ${code}. Share this with them to get started.`);
    setFullName("");
    setEmail("");
    setComplaint("");
    setNotes("");
    setFreq("daily");
    setCode(await generateUniqueCode());
    setSubmitting(false);
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--navy-card)",
    border: "1px solid var(--navy-border)",
    borderRadius: 8,
    padding: "12px 14px",
    color: "var(--white)",
    fontFamily: "var(--font-ui)",
    fontSize: 15,
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
      <h1 style={{ fontFamily: "var(--font-hero)", fontWeight: 400, fontSize: 28, color: "var(--white)" }}>
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
          {success}
        </div>
      )}

      <form onSubmit={submit} style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={labelStyle}>Full Name *</label>
          <input style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </div>
        <div>
          <label style={labelStyle}>Email</label>
          <input
            type="email"
            style={inputStyle}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputMode="email"
          />
        </div>
        <div>
          <label style={labelStyle}>Primary Complaint *</label>
          <input style={inputStyle} value={complaint} onChange={(e) => setComplaint(e.target.value)} required />
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
                onClick={() => setFreq(f.value)}
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
          <label style={labelStyle}>Login Code</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div
              style={{
                flex: 1,
                background: "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                borderRadius: 8,
                padding: "12px 14px",
                fontFamily: "var(--font-data)",
                fontSize: 24,
                fontWeight: 700,
                color: "var(--white)",
                textAlign: "center",
                letterSpacing: "0.3em",
                minHeight: 48,
              }}
            >
              {code || "…"}
            </div>
            <button
              type="button"
              onClick={refreshCode}
              aria-label="Regenerate code"
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
              }}
            >
              <RefreshCw size={18} />
            </button>
          </div>
        </div>

        {error && (
          <div style={{ color: "var(--red)", fontSize: 13, fontFamily: "var(--font-ui)" }}>{error}</div>
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
