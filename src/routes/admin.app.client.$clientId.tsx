import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { CheckIn, Client, Profile } from "@/lib/types";

export const Route = createFileRoute("/admin/app/client/$clientId")({
  head: () => ({ meta: [{ title: "Client — Buddy Admin" }] }),
  component: ClientDetailAdmin,
});

function ClientDetailAdmin() {
  const { clientId } = Route.useParams();
  const [client, setClient] = useState<Client | null>(null);
  const [practitioner, setPractitioner] = useState<Profile | null>(null);
  const [items, setItems] = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase.from("clients").select("*").eq("id", clientId).maybeSingle();
      const cl = c as Client | null;
      setClient(cl);
      if (cl) {
        const [{ data: p }, { data: ci }] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", cl.practitioner_id).maybeSingle(),
          supabase.from("check_ins").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
        ]);
        setPractitioner(p as Profile | null);
        setItems((ci as CheckIn[]) ?? []);
      }
      setLoading(false);
    })();
  }, [clientId]);

  if (loading) return <div style={{ padding: 24, color: "var(--white-muted)" }}>Loading…</div>;
  if (!client) {
    return (
      <div style={{ padding: 24 }}>
        <Link to="/admin/app/clients" style={{ color: "var(--blue-accent)" }}>
          ← Back
        </Link>
        <p style={{ marginTop: 16, color: "var(--white-muted)" }}>Client not found.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 16px 32px" }}>
      <Link
        to="/admin/app/clients"
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
        {client.full_name}
      </h1>
      <div style={{ marginTop: 4, color: "var(--white-muted)", fontSize: 13 }}>
        {client.primary_complaint || "—"}
      </div>
      {practitioner && (
        <div
          style={{
            marginTop: 8,
            display: "inline-block",
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            fontFamily: "var(--font-ui)",
            border: "1px solid var(--blue-cold)",
            color: "var(--blue-cold)",
          }}
        >
          {practitioner.full_name}
        </div>
      )}

      <h2
        style={{
          marginTop: 24,
          marginBottom: 10,
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: 12,
          color: "var(--white-muted)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        All Check-ins ({items.length})
      </h2>

      {items.length === 0 ? (
        <div style={{ color: "var(--white-muted)", fontSize: 13 }}>No check-ins yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((ci) => (
            <div
              key={ci.id}
              style={{
                background: "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-data)", fontSize: 12, color: "var(--white-muted)" }}>
                  {new Date(ci.created_at).toLocaleString()}
                </span>
                {ci.pain_level != null && (
                  <span
                    style={{
                      fontFamily: "var(--font-data)",
                      fontWeight: 700,
                      color: ci.pain_level >= 7 ? "var(--red)" : "var(--white)",
                    }}
                  >
                    Pain {ci.pain_level}/10
                  </span>
                )}
              </div>
              <div
                style={{
                  marginTop: 8,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 1fr 1fr",
                  gap: 6,
                  fontFamily: "var(--font-data)",
                  fontSize: 11,
                  color: "var(--white-muted)",
                }}
              >
                <span>Sl {ci.sleep_quality ?? "—"}</span>
                <span>St {ci.stress_level ?? "—"}</span>
                <span>En {ci.energy_level ?? "—"}</span>
                <span>Mo {ci.mood ?? "—"}</span>
              </div>
              {ci.notes && (
                <div style={{ marginTop: 8, color: "var(--white)", fontSize: 13 }}>{ci.notes}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
