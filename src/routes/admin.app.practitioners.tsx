import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Practice, Profile, Client } from "@/lib/types";
import { SkeletonList, ErrorCard, EmptyState } from "@/components/UIStates";

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
  client_count: number;
};

function PractitionersList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: profs }, { data: pracs }, { data: clients }] = await Promise.all([
        supabase.from("profiles").select("*").eq("role", "practitioner"),
        supabase.from("practices").select("*"),
        supabase.from("clients").select("id,practitioner_id"),
      ]);
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
          client_count: counts.get(pr.practitioner_id) ?? 0,
        };
      });
      // Include practitioners with no practices row
      ((profs as Profile[]) ?? []).forEach((p) => {
        if (!out.find((r) => r.practitioner_id === p.id)) {
          out.push({
            practitioner_id: p.id,
            full_name: p.full_name,
            practice_name: "—",
            profession: p.profession,
            onboarding_complete: false,
            client_count: counts.get(p.id) ?? 0,
          });
        }
      });
      setRows(out);
      setLoading(false);
    })();
  }, []);

  return (
    <div style={{ padding: "20px 16px 32px" }}>
      <h1 style={{ fontFamily: "var(--font-hero)", fontWeight: 400, fontSize: 28, color: "var(--white)" }}>
        All Practitioners
      </h1>

      {loading ? (
        <div style={{ marginTop: 16, color: "var(--white-muted)" }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ marginTop: 16, color: "var(--white-muted)" }}>No practitioners yet.</div>
      ) : (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((r) => (
            <button
              key={r.practitioner_id}
              type="button"
              onClick={() =>
                navigate({
                  to: "/admin/app/practitioner/$practitionerId",
                  params: { practitionerId: r.practitioner_id },
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
                  {r.practice_name}
                  {r.profession ? ` · ${r.profession}` : ""}
                </div>
                <div style={{ marginTop: 6, fontFamily: "var(--font-data)", fontSize: 11, color: "var(--white-muted)" }}>
                  {r.client_count} {r.client_count === 1 ? "client" : "clients"}
                </div>
              </div>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  fontFamily: "var(--font-ui)",
                  border: `1px solid ${r.onboarding_complete ? "var(--green)" : "var(--amber)"}`,
                  color: r.onboarding_complete ? "var(--green)" : "var(--amber)",
                }}
              >
                {r.onboarding_complete ? "Complete" : "Pending"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
