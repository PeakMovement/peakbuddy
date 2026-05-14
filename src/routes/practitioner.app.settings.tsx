import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Info, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Practice, Profile } from "@/lib/types";

export const Route = createFileRoute("/practitioner/app/settings")({
  head: () => ({ meta: [{ title: "Settings — Buddy" }] }),
  component: Settings,
});

const PROFESSIONS = [
  "Chiropractor",
  "Physiotherapist",
  "Osteopath",
  "Biokineticist",
  "Massage Therapist",
  "GP",
  "Other",
];

function Settings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [practiceId, setPracticeId] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [practiceName, setPracticeName] = useState("");
  const [profession, setProfession] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [contactWebhookUrl, setContactWebhookUrl] = useState("");
  const [contactWebhookEnabled, setContactWebhookEnabled] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      setUserId(u.user.id);
      const [{ data: prof }, { data: prac }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle(),
        supabase.from("practices").select("*").eq("practitioner_id", u.user.id).maybeSingle(),
      ]);
      const p = prof as Profile | null;
      const pr = prac as Practice | null;
      setFullName(p?.full_name ?? "");
      setProfession(p?.profession ?? pr?.profession ?? "");
      setPracticeName(pr?.practice_name ?? "");
      setWebhookUrl(pr?.webhook_url ?? "");
      setWebhookEnabled(pr?.webhook_enabled ?? false);
      setContactWebhookUrl(pr?.contact_webhook_url ?? "");
      setContactWebhookEnabled(pr?.contact_webhook_enabled ?? false);
      setPracticeId(pr?.id ?? null);
      setLoading(false);
    })();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    const { error: profErr } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim(), profession })
      .eq("id", userId);

    const updatePayload = {
      practice_name: practiceName.trim(),
      profession,
      webhook_url: webhookUrl.trim(),
      webhook_enabled: webhookEnabled,
      contact_webhook_url: contactWebhookUrl.trim(),
      contact_webhook_enabled: contactWebhookEnabled,
    };

    let pracErr: { message: string } | null = null;
    if (practiceId) {
      const { error } = await supabase
        .from("practices")
        .update(updatePayload)
        .eq("id", practiceId)
        .eq("practitioner_id", userId);
      pracErr = error;
    } else {
      const { data, error } = await supabase
        .from("practices")
        .insert({ ...updatePayload, practitioner_id: userId, onboarding_complete: true })
        .select()
        .maybeSingle();
      pracErr = error;
      if (data) setPracticeId((data as Practice).id);
    }

    setSaving(false);
    if (profErr || pracErr) {
      setError((profErr?.message || pracErr?.message) ?? "Failed to save.");
    } else {
      setSuccess("Settings saved.");
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/practitioner/login" });
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
  const sectionTitle: React.CSSProperties = {
    fontFamily: "var(--font-ui)",
    fontWeight: 700,
    color: "var(--white)",
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginTop: 24,
    marginBottom: 12,
  };

  if (loading) return <div style={{ padding: 24, color: "var(--white-muted)" }}>Loading…</div>;

  return (
    <div style={{ padding: "20px 16px 32px" }}>
      <h1 style={{ fontFamily: "var(--font-hero)", fontWeight: 400, fontSize: 28, color: "var(--white)" }}>Settings</h1>

      <form onSubmit={save}>
        <div style={sectionTitle}>Practice Details</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={labelStyle}>Your Name</label>
            <input style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Practice Name</label>
            <input style={inputStyle} value={practiceName} onChange={(e) => setPracticeName(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Profession</label>
            <select
              style={inputStyle}
              value={profession}
              onChange={(e) => setProfession(e.target.value)}
            >
              <option value="">Select…</option>
              {PROFESSIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <WebhookSection
          title="Alert Webhook"
          help="This webhook fires when a client triggers a red flag alert."
          url={webhookUrl}
          enabled={webhookEnabled}
          onUrl={setWebhookUrl}
          onEnabled={setWebhookEnabled}
          inputStyle={inputStyle}
          labelStyle={labelStyle}
          sectionTitle={sectionTitle}
        />

        <WebhookSection
          title="Contact Webhook"
          help="This webhook fires when a client contacts you directly."
          url={contactWebhookUrl}
          enabled={contactWebhookEnabled}
          onUrl={setContactWebhookUrl}
          onEnabled={setContactWebhookEnabled}
          inputStyle={inputStyle}
          labelStyle={labelStyle}
          sectionTitle={sectionTitle}
        />

        {error && <div style={{ color: "var(--red)", fontSize: 13, marginTop: 16 }}>{error}</div>}
        {success && <div style={{ color: "var(--green)", fontSize: 13, marginTop: 16 }}>{success}</div>}

        <button
          type="submit"
          disabled={saving}
          style={{
            marginTop: 24,
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
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      <button
        type="button"
        onClick={signOut}
        style={{
          marginTop: 16,
          minHeight: 48,
          width: "100%",
          background: "transparent",
          color: "var(--white-muted)",
          border: "1px solid var(--navy-border)",
          borderRadius: 8,
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <LogOut size={16} />
        Sign out
      </button>
    </div>
  );
}

function WebhookSection({
  title,
  help,
  url,
  enabled,
  onUrl,
  onEnabled,
  inputStyle,
  labelStyle,
  sectionTitle,
}: {
  title: string;
  help: string;
  url: string;
  enabled: boolean;
  onUrl: (v: string) => void;
  onEnabled: (v: boolean) => void;
  inputStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  sectionTitle: React.CSSProperties;
}) {
  return (
    <>
      <div style={{ ...sectionTitle, display: "flex", alignItems: "center", gap: 8 }}>
        {title}
        <Info size={14} aria-label="info" />
      </div>
      <p style={{ color: "var(--white-muted)", fontSize: 12, marginTop: -8, marginBottom: 12 }}>{help}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle}>URL</label>
          <input
            style={inputStyle}
            value={url}
            onChange={(e) => onUrl(e.target.value)}
            placeholder="https://…"
            inputMode="url"
          />
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--navy-card)",
            border: "1px solid var(--navy-border)",
            borderRadius: 8,
            padding: "12px 14px",
            minHeight: 48,
            cursor: "pointer",
          }}
        >
          <span style={{ color: "var(--white)", fontFamily: "var(--font-ui)", fontSize: 14 }}>Enabled</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabled(e.target.checked)}
            style={{ width: 22, height: 22, accentColor: "var(--blue-accent)" }}
          />
        </label>
      </div>
    </>
  );
}
