import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

export const Route = createFileRoute("/practitioner/app/profile")({
  head: () => ({ meta: [{ title: "Profile — Buddy" }] }),
  component: PractitionerProfile,
});

function PractitionerProfile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        navigate({ to: "/practitioner/login" });
        return;
      }
      setEmail(u.user.email ?? null);
      setPhone(u.user.phone ?? null);
      const { data: prof } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", u.user.id)
        .maybeSingle();
      setProfile(prof as Profile | null);
      setLoading(false);
    })();
  }, [navigate]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/practitioner/login" });
  };

  if (loading) return <div style={{ padding: 24, color: "var(--white-muted)" }}>Loading…</div>;

  return (
    <div style={{ padding: "24px 20px 32px" }}>
      <h1
        style={{
          fontFamily: "var(--font-hero)",
          fontWeight: 400,
          fontSize: 28,
          color: "var(--white)",
        }}
      >
        Profile
      </h1>

      <div
        style={{
          marginTop: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <ProfileField label="Name" value={profile?.full_name} />
        <ProfileField label="Email" value={email} />
        <ProfileField label="Phone" value={phone || "Not set"} />
      </div>

      <button
        type="button"
        onClick={signOut}
        style={{
          marginTop: 32,
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

function ProfileField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 8,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          color: "var(--white-muted)",
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--white)",
          fontFamily: "var(--font-ui)",
          fontSize: 16,
          wordBreak: "break-word",
        }}
      >
        {value || "—"}
      </div>
    </div>
  );
}
