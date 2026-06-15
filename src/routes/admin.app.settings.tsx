import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { PlatformSettings } from "@/lib/types";

export const Route = createFileRoute("/admin/app/settings")({
  head: () => ({ meta: [{ title: "Settings — Buddy Admin" }] }),
  component: AdminSettings,
});

function AdminSettings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [programsEnabled, setProgramsEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);


  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("platform_settings").select("*").limit(1).maybeSingle();
      const s = data as PlatformSettings | null;
      if (s) {
        setSettingsId(s.id);
        setUrl(s.new_practitioner_webhook_url ?? "");
        setEnabled(s.new_practitioner_webhook_enabled ?? false);
        setProgramsEnabled(s.programs_feature_enabled ?? true);
      }

      setLoading(false);
    })();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    const payload = {
      new_practitioner_webhook_url: url.trim(),
      new_practitioner_webhook_enabled: enabled,
      programs_feature_enabled: programsEnabled,
    };

    let err: { message: string } | null = null;
    if (settingsId) {
      const { error } = await supabase
        .from("platform_settings")
        .update(payload)
        .eq("id", settingsId);
      err = error;
    } else {
      const { data, error } = await supabase
        .from("platform_settings")
        .insert(payload)
        .select()
        .maybeSingle();
      err = error;
      if (data) setSettingsId((data as PlatformSettings).id);
    }
    setSaving(false);
    if (err) setError(err.message);
    else setSuccess("Saved.");
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/admin/login" });
  };

  if (loading) return <div style={{ padding: 24, color: "var(--white-muted)" }}>Loading…</div>;

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
        Platform Settings
      </h1>

      <form
        onSubmit={save}
        style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={sectionTitle}>New practitioner notification webhook</div>
        <p style={{ color: "var(--white-muted)", fontSize: 12, marginTop: -8 }}>
          Fired when a new practitioner completes signup. Use this with Make.com to receive an
          approval email.
        </p>

        <div>
          <label style={labelStyle}>Webhook URL</label>
          <input
            style={inputStyle}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hook.eu1.make.com/…"
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
          <span style={{ color: "var(--white)", fontFamily: "var(--font-ui)", fontSize: 14 }}>
            Enabled
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            style={{ width: 22, height: 22, accentColor: "var(--blue-accent)" }}
          />
        </label>

        {error && <div style={{ color: "var(--red)", fontSize: 13 }}>{error}</div>}
        {success && <div style={{ color: "var(--green)", fontSize: 13 }}>{success}</div>}

        <button
          type="submit"
          disabled={saving}
          style={{
            marginTop: 8,
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
          marginTop: 24,
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
const sectionTitle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 700,
  color: "var(--white)",
  fontSize: 14,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginTop: 12,
};
