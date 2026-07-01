import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Users, Sparkles, AlertTriangle, Watch } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Profile, Client, CheckIn } from "@/lib/types";
import { CircularRing, ringColor } from "@/components/CircularRing";
import { SkeletonList, ErrorCard, EmptyState } from "@/components/UIStates";
import { log } from "@/lib/log";
import {
  getMorningAnalysis,
  setMorningAnalysisEnabled,
  type MorningAnalysisPayload,
} from "@/lib/morning-analysis.functions";
import { registerPushToken } from "@/lib/push";
import { countActiveWearableConnections } from "@/lib/wearables.functions";

export const Route = createFileRoute("/practitioner/app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Buddy" }] }),
  component: Dashboard,
});

type ClientRow = Client & {
  _lastCheckIn: string | null;
  _compliance: number;
  _activeToday: boolean;
};

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
  const [wearableCount, setWearableCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      void registerPushToken();



      const [{ data: prof }, { data: clients, error: cErr }, { count: unreadCount, error: aErr }] =
        await Promise.all([
          supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle(),
          supabase
            .from("clients")
            .select("*")
            .eq("practitioner_id", u.user.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("alerts")
            .select("*", { count: "exact", head: true })
            .eq("practitioner_id", u.user.id)
            .eq("is_read", false),
        ]);
      if (cErr || aErr) throw cErr || aErr;

      setProfile(prof as Profile | null);
      setUnread(unreadCount ?? 0);

      const list = (clients as Client[]) ?? [];
      if (list.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }
      const ids = list.map((c) => c.id);
      const { data: checkIns, error: ciErr } = await supabase
        .from("check_ins")
        .select("*")
        .in("client_id", ids)
        .order("created_at", { ascending: false });
      if (ciErr) throw ciErr;

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
              : Math.min(
                  Math.ceil(elapsed / (c.check_in_frequency === "every_3_days" ? 3 : 2)),
                  weeks * 4,
                );
        const compliance = Math.min(
          100,
          Math.round((ci.length / Math.max(1, expectedSoFar)) * 100),
        );
        return {
          ...c,
          _lastCheckIn: last,
          _compliance: compliance,
          _activeToday: !!last && isSameDay(last, today),
        };
      });
      setRows(enriched);
    } catch (e) {
      log.error(e);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
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
        <h1
          style={{
            fontFamily: "var(--font-hero)",
            fontWeight: 400,
            fontSize: 26,
            color: "var(--white)",
          }}
        >
          {greeting()} {firstName}
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
      </header>

      <section
        style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}
      >
        <Stat label="Clients" value={rows.length} />
        <Stat label="Active" value={rows.filter((r) => r._activeToday).length} />
        <Stat label="Alerts" value={unread} danger={unread > 0} />
      </section>

      <MorningAnalysisCard />



      <div
        style={{
          marginTop: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
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
        <div style={{ marginTop: 16 }}>
          <SkeletonList count={3} height={84} />
        </div>
      ) : error ? (
        <div style={{ marginTop: 16 }}>
          <ErrorCard message={error} onRetry={load} />
        </div>
      ) : rows.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState
            Icon={Users}
            title="No clients yet"
            subtitle="Add your first client to get started."
          />
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() =>
                navigate({
                  to: "/practitioner/app/client-detail/$clientId",
                  params: { clientId: r.id },
                })
              }
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
                  <span
                    style={{
                      fontFamily: "var(--font-data)",
                      fontSize: 11,
                      color: "var(--white-muted)",
                    }}
                  >
                    {r._lastCheckIn ? new Date(r._lastCheckIn).toLocaleDateString() : "Never"}
                  </span>
                </div>
              </div>
              <CircularRing
                size={40}
                stroke={5}
                pct={r._compliance}
                color={ringColor(r._compliance)}
              >
                <span
                  style={{
                    fontFamily: "var(--font-data)",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--white)",
                  }}
                >
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

function MorningAnalysisCard() {
  const [data, setData] = useState<MorningAnalysisPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>("all");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMorningAnalysis();
      setData(res);
    } catch (e) {
      log.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      await setMorningAnalysisEnabled({ data: { enabled: next } });
      await load();
    } catch (e) {
      log.error(e);
    } finally {
      setSaving(false);
    }
  };

  const clientOptions = data
    ? Array.from(new Map(data.items.map((i) => [i.client_id, i.client_name])).entries())
    : [];
  const filtered = data
    ? selected === "all"
      ? data.items
      : data.items.filter((i) => i.client_id === selected)
    : [];

  return (
    <section
      style={{
        marginTop: 20,
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 12,
        padding: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={16} color="var(--blue-accent)" />
          <h2
            style={{
              fontFamily: "var(--font-ui)",
              fontWeight: 700,
              fontSize: 14,
              color: "var(--white)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Morning Analysis
          </h2>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--white-muted)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={data?.enabled ?? true}
            disabled={saving || loading}
            onChange={(e) => toggle(e.target.checked)}
          />
          {data?.enabled ? "On" : "Off"}
        </label>
      </div>

      {loading ? (
        <p style={{ marginTop: 10, fontSize: 12, color: "var(--white-muted)" }}>Loading…</p>
      ) : !data?.enabled ? (
        <p style={{ marginTop: 10, fontSize: 12, color: "var(--white-muted)" }}>
          Daily analysis is paused. Turn on to receive AI summaries each morning.
        </p>
      ) : data.client_count === 0 ? (
        <p style={{ marginTop: 10, fontSize: 12, color: "var(--white-muted)" }}>
          Add a client to start receiving morning analysis.
        </p>
      ) : data.items.length === 0 ? (
        <p style={{ marginTop: 10, fontSize: 12, color: "var(--white-muted)" }}>
          No flags this morning — everyone looks stable.
        </p>
      ) : (
        <>
          <div style={{ marginTop: 10 }}>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              style={{
                width: "100%",
                minHeight: 40,
                background: "var(--navy)",
                color: "var(--white)",
                border: "1px solid var(--navy-border)",
                borderRadius: 8,
                padding: "0 10px",
                fontFamily: "var(--font-ui)",
                fontSize: 13,
              }}
            >
              <option value="all">All clients ({data.items.length})</option>
              {clientOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((i) => (
              <div
                key={i.id}
                style={{
                  background: "var(--navy)",
                  border: "1px solid var(--navy-border)",
                  borderRadius: 10,
                  padding: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <strong style={{ fontSize: 13, color: "var(--white)" }}>{i.client_name}</strong>
                  {i.risk_score !== null && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 10,
                        padding: "2px 6px",
                        borderRadius: 999,
                        background: i.risk_score >= 60 ? "var(--red)" : "var(--navy-border)",
                        color: "var(--white)",
                        fontFamily: "var(--font-data)",
                      }}
                    >
                      <AlertTriangle size={10} /> {i.risk_score}
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: "var(--white)", fontWeight: 600 }}>
                  {i.draft_title}
                </div>
                <p style={{ marginTop: 4, fontSize: 12, lineHeight: 1.4, color: "var(--white-muted)" }}>
                  {i.draft_body}
                </p>
                {i.suggested_program && (
                  <p style={{ marginTop: 4, fontSize: 11, color: "var(--blue-accent)" }}>
                    Suggested: {i.suggested_program}
                  </p>
                )}
              </div>
            ))}
          </div>
          <Link
            to="/practitioner/app/insights"
            style={{
              display: "block",
              textAlign: "center",
              marginTop: 10,
              fontSize: 12,
              color: "var(--blue-accent)",
              textDecoration: "none",
            }}
          >
            Review &amp; action in Insights →
          </Link>
        </>
      )}
    </section>
  );
}

