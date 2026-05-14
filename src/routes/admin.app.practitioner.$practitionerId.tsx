import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Alert, Client, Practice, Profile } from "@/lib/types";

export const Route = createFileRoute("/admin/app/practitioner/$practitionerId")({
  head: () => ({ meta: [{ title: "Practitioner — Buddy Admin" }] }),
  component: PractitionerDetail,
});

function PractitionerDetail() {
  const { practitionerId } = Route.useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: prof }, { data: prac }, { data: cl }, { data: al }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", practitionerId).maybeSingle(),
        supabase.from("practices").select("*").eq("practitioner_id", practitionerId).maybeSingle(),
        supabase.from("clients").select("*").eq("practitioner_id", practitionerId).order("created_at", { ascending: false }),
        supabase.from("alerts").select("*").eq("practitioner_id", practitionerId).order("created_at", { ascending: false }),
      ]);
      setProfile(prof as Profile | null);
      setPractice(prac as Practice | null);
      setClients((cl as Client[]) ?? []);
      setAlerts((al as Alert[]) ?? []);
      setLoading(false);
    })();
  }, [practitionerId]);

  if (loading) return <div style={{ padding: 24, color: "var(--white-muted)" }}>Loading…</div>;

  const sectionTitle: React.CSSProperties = {
    fontFamily: "var(--font-ui)",
    fontWeight: 600,
    fontSize: 12,
    color: "var(--white-muted)",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    marginTop: 24,
    marginBottom: 10,
  };

  return (
    <div style={{ padding: "16px 16px 32px" }}>
      <Link
        to="/admin/app/practitioners"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          color: "var(--white-muted)",
          textDecoration: "none",
          fontFamily: "var(--font-ui)",
          fontSize: 14,
        }}
      >
        <ArrowLeft size={16} /> Back
      </Link>

      <h1 style={{ marginTop: 12, fontFamily: "var(--font-hero)", fontWeight: 400, fontSize: 28, color: "var(--white)" }}>
        {profile?.full_name ?? "Unknown"}
      </h1>
      <div style={{ marginTop: 4, color: "var(--white-muted)", fontFamily: "var(--font-ui)", fontSize: 13 }}>
        {practice?.practice_name ?? "—"}
        {practice?.profession ? ` · ${practice.profession}` : profile?.profession ? ` · ${profile.profession}` : ""}
      </div>

      <div style={sectionTitle}>Practice Details</div>
      <Card>
        <Row label="Practice Name" value={practice?.practice_name ?? "—"} />
        <Row label="Profession" value={practice?.profession ?? profile?.profession ?? "—"} />
        <Row label="Onboarding" value={practice?.onboarding_complete ? "Complete" : "Pending"} />
        <Row label="POPIA Agreed" value={practice?.popia_agreed ? "Yes" : "No"} />
      </Card>

      <div style={sectionTitle}>Webhooks (admin view)</div>
      <Card>
        <Row label="Alert URL" value={practice?.webhook_url || "—"} mono />
        <Row label="Alert Enabled" value={practice?.webhook_enabled ? "On" : "Off"} />
        <Row label="Contact URL" value={practice?.contact_webhook_url || "—"} mono />
        <Row label="Contact Enabled" value={practice?.contact_webhook_enabled ? "On" : "Off"} />
      </Card>

      <div style={sectionTitle}>Clients ({clients.length})</div>
      {clients.length === 0 ? (
        <Card>
          <span style={{ color: "var(--white-muted)", fontSize: 13 }}>No clients.</span>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {clients.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => navigate({ to: "/admin/app/client/$clientId", params: { clientId: c.id } })}
              style={{
                textAlign: "left",
                background: "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                borderRadius: 10,
                padding: 12,
                cursor: "pointer",
                color: "inherit",
              }}
            >
              <div style={{ fontFamily: "var(--font-ui)", fontWeight: 600, color: "var(--white)" }}>{c.full_name}</div>
              <div style={{ marginTop: 2, color: "var(--white-muted)", fontSize: 12 }}>{c.primary_complaint || "—"}</div>
            </button>
          ))}
        </div>
      )}

      <div style={sectionTitle}>Alert History ({alerts.length})</div>
      {alerts.length === 0 ? (
        <Card>
          <span style={{ color: "var(--white-muted)", fontSize: 13 }}>No alerts.</span>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {alerts.map((a) => (
            <div
              key={a.id}
              style={{
                background: "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                borderRadius: 10,
                padding: 12,
                opacity: a.is_read ? 0.6 : 1,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600, color: "var(--white)", fontSize: 13 }}>
                  {a.urgency.toUpperCase()}
                </span>
                <span style={{ fontFamily: "var(--font-data)", fontSize: 11, color: "var(--white-muted)" }}>
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </div>
              <div style={{ marginTop: 6, color: "var(--white)", fontSize: 13 }}>{a.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 12,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          color: "var(--white-muted)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: mono ? "var(--font-data)" : "var(--font-ui)",
          fontSize: 13,
          color: "var(--white)",
          textAlign: "right",
          wordBreak: "break-all",
          minWidth: 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}
