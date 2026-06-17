import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Trash2, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Practice, Profile, Client } from "@/lib/types";
import { SkeletonList, ErrorCard, EmptyState } from "@/components/UIStates";
import { log } from "@/lib/log";
import { adminDeletePractitioner } from "@/lib/admin-delete.functions";

export const Route = createFileRoute("/admin/app/practitioners")({
  head: () => ({ meta: [{ title: "Practitioners — Buddy Admin" }] }),
  component: PractitionersList,
});

type Row = {
  practitioner_id: string;
  full_name: string;
  practice_name: string;
  profession: string | null;
  onboarding_complete: boolean;
  is_approved: boolean;
  client_count: number;
};

function PractitionersList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      const [{ data: profs, error: e1 }, { data: pracs, error: e2 }, { data: clients, error: e3 }] =
        await Promise.all([
          supabase.from("profiles").select("*").eq("role", "practitioner"),
          supabase.from("practices").select("*"),
          supabase.from("clients").select("id,practitioner_id"),
        ]);
      if (e1 || e2 || e3) throw e1 || e2 || e3;
      const profileMap = new Map<string, Profile>();
      ((profs as Profile[]) ?? []).forEach((p) => profileMap.set(p.id, p));
      const counts = new Map<string, number>();
      ((clients as Client[]) ?? []).forEach((c) => {
        counts.set(c.practitioner_id, (counts.get(c.practitioner_id) ?? 0) + 1);
      });
      const out: Row[] = ((pracs as Practice[]) ?? []).map((pr) => {
        const prof = profileMap.get(pr.practitioner_id);
        return {
          practitioner_id: pr.practitioner_id,
          full_name: prof?.full_name ?? "Unknown",
          practice_name: pr.practice_name,
          profession: pr.profession ?? prof?.profession ?? null,
          onboarding_complete: pr.onboarding_complete,
          is_approved: pr.is_approved ?? false,
          client_count: counts.get(pr.practitioner_id) ?? 0,
        };
      });
      ((profs as Profile[]) ?? []).forEach((p) => {
        if (!out.find((r) => r.practitioner_id === p.id)) {
          out.push({
            practitioner_id: p.id,
            full_name: p.full_name,
            practice_name: "—",
            profession: p.profession,
            onboarding_complete: false,
            is_approved: false,
            client_count: counts.get(p.id) ?? 0,
          });
        }
      });
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
        All Practitioners
      </h1>

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
            title="No practitioners yet"
            subtitle="Practitioners will appear here once they sign up."
          />
        </div>
      ) : (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => (
            <PractitionerCard
              key={r.practitioner_id}
              row={r}
              onOpen={() =>
                navigate({
                  to: "/admin/app/practitioner/$practitionerId",
                  params: { practitionerId: r.practitioner_id },
                })
              }
              onApproved={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PractitionerCard({
  row,
  onOpen,
  onApproved,
}: {
  row: Row;
  onOpen: () => void;
  onApproved: () => void;
}) {
  const [approving, setApproving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `Permanently remove ${row.full_name}? This deletes their account, practice, and all their clients and check-ins.`,
      )
    )
      return;
    setRemoving(true);
    setErr(null);
    try {
      const res = await adminDeletePractitioner({ data: { id: row.practitioner_id } });
      if (!res.ok) throw new Error(res.error);
      onApproved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to remove practitioner.");
      setRemoving(false);
    }
  };

  const approve = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setApproving(true);
    setErr(null);
    const { error } = await supabase
      .from("practices")
      .update({ is_approved: true })
      .eq("practitioner_id", row.practitioner_id);
    setApproving(false);
    if (error) setErr(error.message);
    else onApproved();
  };

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
      <button
        type="button"
        onClick={onOpen}
        style={{
          textAlign: "left",
          background: "transparent",
          border: "none",
          padding: 0,
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
            {row.full_name}
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
            {row.practice_name}
            {row.profession ? ` · ${row.profession}` : ""}
          </div>
          <div
            style={{
              marginTop: 6,
              fontFamily: "var(--font-data)",
              fontSize: 11,
              color: "var(--white-muted)",
            }}
          >
            {row.client_count} {row.client_count === 1 ? "client" : "clients"}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          <Badge color={row.is_approved ? "green" : "amber"}>
            {row.is_approved ? "Active" : "Pending"}
          </Badge>
          {row.onboarding_complete ? null : <Badge color="muted">Onboarding</Badge>}
        </div>
      </button>

      {!row.is_approved && (
        <button
          type="button"
          onClick={approve}
          disabled={approving}
          style={{
            minHeight: 40,
            width: "100%",
            background: "var(--green)",
            color: "var(--white)",
            border: "none",
            borderRadius: 8,
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
            opacity: approving ? 0.6 : 1,
          }}
        >
          {approving ? "Approving…" : "Approve"}
        </button>
      )}
      <button
        type="button"
        onClick={remove}
        disabled={removing}
        style={{
          minHeight: 36,
          background: "transparent",
          color: "var(--red)",
          border: "1px solid var(--red)",
          borderRadius: 8,
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: 12,
          cursor: "pointer",
          opacity: removing ? 0.6 : 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <Trash2 size={14} /> {removing ? "Removing…" : "Remove practitioner"}
      </button>
      {err && <div style={{ color: "var(--red)", fontSize: 12 }}>{err}</div>}
    </div>
  );
}

function Badge({
  color,
  children,
}: {
  color: "green" | "amber" | "muted";
  children: React.ReactNode;
}) {
  const c =
    color === "green" ? "var(--green)" : color === "amber" ? "var(--amber)" : "var(--white-muted)";
  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        fontFamily: "var(--font-ui)",
        border: `1px solid ${c}`,
        color: c,
      }}
    >
      {children}
    </span>
  );
}
