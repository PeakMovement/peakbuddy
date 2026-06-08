import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { CheckIn, Client, Profile } from "@/lib/types";
import { SkeletonList, ErrorCard, EmptyState } from "@/components/UIStates";
import { log } from "@/lib/log";

export const Route = createFileRoute("/admin/app/clients")({
  head: () => ({ meta: [{ title: "All Clients — Buddy Admin" }] }),
  component: AllClients,
});

type Row = Client & {
  _practitionerName: string;
  _lastCheckIn: string | null;
  _compliance: number;
};

function AllClients() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [practs, setPracts] = useState<Profile[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      const [
        { data: clients, error: e1 },
        { data: profs, error: e2 },
        { data: checkIns, error: e3 },
      ] = await Promise.all([
        supabase.from("clients").select("*").order("created_at", { ascending: false }),
        supabase.from("profiles").select("*").eq("role", "practitioner"),
        supabase.from("check_ins").select("*").order("created_at", { ascending: false }),
      ]);
      if (e1 || e2 || e3) throw e1 || e2 || e3;
      const profileMap = new Map<string, Profile>();
      ((profs as Profile[]) ?? []).forEach((p) => profileMap.set(p.id, p));
      const ciMap = new Map<string, CheckIn[]>();
      ((checkIns as CheckIn[]) ?? []).forEach((ci) => {
        const arr = ciMap.get(ci.client_id) ?? [];
        arr.push(ci);
        ciMap.set(ci.client_id, arr);
      });

      const out: Row[] = ((clients as Client[]) ?? []).map((c) => {
        const ci = ciMap.get(c.id) ?? [];
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
          _practitionerName: profileMap.get(c.practitioner_id)?.full_name ?? "Unknown",
          _lastCheckIn: last,
          _compliance: compliance,
        };
      });

      setPracts((profs as Profile[]) ?? []);
      setRows(out);
    } catch (e) {
      log.error(e);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.practitioner_id === filter)),
    [rows, filter],
  );

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
        All Clients
      </h1>

      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{
          marginTop: 16,
          width: "100%",
          height: 44,
          background: "var(--navy-card)",
          border: "1px solid var(--navy-border)",
          borderRadius: 8,
          color: "var(--white)",
          fontFamily: "var(--font-ui)",
          fontSize: 14,
          padding: "0 12px",
        }}
      >
        <option value="all">All Practitioners</option>
        {practs.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name}
          </option>
        ))}
      </select>

      {loading ? (
        <div style={{ marginTop: 16 }}>
          <SkeletonList count={3} height={92} />
        </div>
      ) : error ? (
        <div style={{ marginTop: 16 }}>
          <ErrorCard message={error} onRetry={load} />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <EmptyState Icon={User} title="No clients" subtitle="No clients match this filter." />
        </div>
      ) : (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() =>
                navigate({ to: "/admin/app/client-detail/$clientId", params: { clientId: r.id } })
              }
              style={{
                textAlign: "left",
                background: "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                borderRadius: 12,
                padding: 14,
                cursor: "pointer",
                color: "inherit",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
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
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-data)",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--white)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r._compliance}%
                </span>
              </div>
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
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
                  {r._practitionerName}
                </span>
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
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
