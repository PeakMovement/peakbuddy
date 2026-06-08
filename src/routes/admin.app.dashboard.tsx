import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/admin/app/dashboard")({
  head: () => ({ meta: [{ title: "Admin Dashboard — Buddy" }] }),
  component: AdminDashboard,
});

function AdminDashboard() {
  const [stats, setStats] = useState({ practitioners: 0, clients: 0, checkins: 0, openAlerts: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [pr, cl, ci, al] = await Promise.all([
        supabase
          .from("profiles")
          .select("*", { count: "exact", head: true })
          .eq("role", "practitioner"),
        supabase.from("clients").select("*", { count: "exact", head: true }),
        supabase.from("check_ins").select("*", { count: "exact", head: true }),
        supabase
          .from("alerts")
          .select("*", { count: "exact", head: true })
          .eq("is_read", false)
          .gte("created_at", todayStart.toISOString()),
      ]);
      setStats({
        practitioners: pr.count ?? 0,
        clients: cl.count ?? 0,
        checkins: ci.count ?? 0,
        openAlerts: al.count ?? 0,
      });
      setLoading(false);
    })();
  }, []);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div style={{ padding: "20px 16px 32px" }}>
      <h1
        style={{
          fontFamily: "var(--font-hero)",
          fontWeight: 400,
          fontSize: 30,
          color: "var(--white)",
        }}
      >
        Buddy Admin
      </h1>
      <div
        style={{
          marginTop: 4,
          fontFamily: "var(--font-data)",
          fontSize: 12,
          color: "var(--white-muted)",
        }}
      >
        {today}
      </div>

      <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <StatCard label="Practitioners" value={stats.practitioners} loading={loading} />
        <StatCard label="Clients" value={stats.clients} loading={loading} />
        <StatCard label="Check-ins" value={stats.checkins} loading={loading} />
        <StatCard
          label="Open Alerts Today"
          value={stats.openAlerts}
          loading={loading}
          danger={stats.openAlerts > 0}
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
  danger,
}: {
  label: string;
  value: number;
  loading: boolean;
  danger?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 12,
        padding: 16,
        minHeight: 96,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-data)",
          fontSize: 32,
          fontWeight: 700,
          color: danger ? "var(--red)" : "var(--white)",
        }}
      >
        {loading ? "…" : value}
      </div>
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          color: "var(--white-muted)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
}
