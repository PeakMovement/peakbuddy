import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { Profile, Client, CheckIn } from "@/lib/types";
import { CircularRing, ringColor } from "@/components/CircularRing";

export const Route = createFileRoute("/practitioner/app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Buddy" }] }),
  component: Dashboard,
});

type ClientRow = Client & { _lastCheckIn: string | null; _compliance: number; _activeToday: boolean };

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function dotColor(last: string | null) {
  if (!last) return "var(--red)";
  const days = Math.floor((Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "var(--green)";
  if (days <= 3) return "var(--amber)";
  return "var(--red)";
}

function isSameDay(a: string, b: Date) {
  const d = new Date(a);
  return d.toDateString() === b.toDateString();
}

function Dashboard() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;

    const [{ data: prof }, { data: clients }, { count: unreadCount }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle(),
      supabase.from("clients").select("*").eq("practitioner_id", u.user.id).order("created_at", { ascending: false }),
      supabase.from("alerts").select("*", { count: "exact", head: true }).eq("practitioner_id", u.user.id).eq("is_read", false),
    ]);

    setProfile(prof as Profile | null);
    setUnread(unreadCount ?? 0);

    const list = (clients as Client[]) ?? [];
    if (list.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    const ids = list.map((c) => c.id);
    const { data: checkIns } = await supabase
      .from("check_ins")
      .select("*")
      .in("client_id", ids)
      .order("created_at", { ascending: false });

    const today = new Date();
    const byClient = new Map<string, CheckIn[]>();
    ((checkIns as CheckIn[]) ?? []).forEach((ci) => {
      const arr = byClient.get(ci.client_id) ?? [];
      arr.push(ci);
      byClient.set(ci.client_id, arr);
    });

    const enriched: ClientRow[] = list.map((c) => {
      const ci = byClient.get(c.id) ?? [];
      const last = ci[0]?.created_at ?? null;
      const weeks = c.tracking_duration_weeks ?? 8;
      const start = new Date(c.created_at).getTime();
      const elapsed = Math.max(1, Math.ceil((Date.now() - start) / (1000 * 60 * 60 * 24)));
      const expectedSoFar =
        c.check_in_frequency === "daily"
          ? Math.min(elapsed, weeks * 7)
          : c.check_in_frequency === "weekly"
            ? Math.min(Math.ceil(elapsed / 7), weeks)
            : Math.min(Math.ceil(elapsed / (c.check_in_frequency === "every_3_days" ? 3 : 2)), weeks * 4);
      const compliance = Math.min(100, Math.round((ci.length / Math.max(1, expectedSoFar)) * 100));
      return {
        ...c,
        _lastCheckIn: last,
        _compliance: compliance,
        _activeToday: !!last && isSameDay(last, today),
      };
    });
    setRows(enriched);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const firstName = (profile?.full_name ?? "").split(" ")[0] || "there";
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div style={{ padding: "20px 16px 32px" }}>
      <header>
        <h1 style={{ fontFamily: "var(--font-hero)", fontWeight: 400, fontSize: 26, color: "var(--white)" }}>
          {greeting()} {firstName}
        </h1>
        <div style={{ marginTop: 4, fontFamily: "var(--font-data)", fontSize: 12, color: "var(--white-muted)" }}>
          {today}
        </div>
      </header>

      <section style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <Stat label="Clients" value={rows.length} />
        <Stat label="Active" value={rows.filter((r) => r._activeToday).length} />
        <Stat label="Alerts" value={unread} danger={unread > 0} />
      </section>

      <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 16,
            color: "var(--white-muted)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Your Clients
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            background: "transparent",
            border: "1px solid var(--navy-border)",
            color: "var(--white-muted)",
            padding: "4px 10px",
            borderRadius: 6,
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {refreshing ? "…" : "Refresh"}
        </button>
      </div>

      {loading ? (
        <div style={{ marginTop: 16, color: "var(--white-muted)" }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div
          style={{
            marginTop: 16,
            padding: 24,
            background: "var(--navy-card)",
            border: "1px solid var(--navy-border)",
            borderRadius: 12,
            color: "var(--white-muted)",
            textAlign: "center",
          }}
        >
          No clients yet. Add your first client to get started.
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => navigate({ to: "/practitioner/app/client/$clientId", params: { clientId: r.id } })}
              style={{
                textAlign: "left",
                background: "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                borderRadius: 12,
                padding: 14,
                display: "flex",
                alignItems: "center",
                gap: 12,
                cursor: "pointer",
                color: "inherit",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontWeight: 700,
                    color: "var(--white)",
                    fontSize: 16,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.full_name}
                </div>
                <div
                  style={{
                    marginTop: 2,
                    color: "var(--white-muted)",
                    fontSize: 12,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.primary_complaint || "—"}
                </div>
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      background: dotColor(r._lastCheckIn),
                    }}
                  />
                  <span style={{ fontFamily: "var(--font-data)", fontSize: 11, color: "var(--white-muted)" }}>
                    {r._lastCheckIn
                      ? new Date(r._lastCheckIn).toLocaleDateString()
                      : "Never"}
                  </span>
                </div>
              </div>
              <CircularRing size={40} stroke={5} pct={r._compliance} color={ringColor(r._compliance)}>
                <span style={{ fontFamily: "var(--font-data)", fontSize: 10, fontWeight: 700, color: "var(--white)" }}>
                  {r._compliance}%
                </span>
              </CircularRing>
            </button>
          ))}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <Link
          to="/practitioner/app/add-client"
          style={{
            display: "block",
            textAlign: "center",
            padding: "14px",
            background: "var(--blue-accent)",
            color: "var(--white)",
            borderRadius: 8,
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            textDecoration: "none",
            minHeight: 48,
          }}
        >
          + Add Client
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-data)",
          fontSize: 22,
          fontWeight: 700,
          color: danger ? "var(--red)" : "var(--white)",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 11,
          color: "var(--white-muted)",
          marginTop: 2,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
    </div>
  );
}
