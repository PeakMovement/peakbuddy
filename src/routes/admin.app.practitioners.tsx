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
      const [{ data: profs, error: e1 }, { data: pracs, error: e2 }, { data: clients, error: e3 }] = await Promise.all([
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
      console.error(e);
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
      <h1 style={{ fontFamily: "var(--font-hero)", fontWeight: 400, fontSize: 28, color: "var(--white)" }}>
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
          <EmptyState Icon={Users} title="No practitioners yet" subtitle="Practitioners will appear here once they sign up." />
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
