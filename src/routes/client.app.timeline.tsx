import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/client/app/timeline")({
  component: () => <Navigate to="/client/app/profile" />,
});

const moodLabels = ["—", "Very Low", "Low", "Okay", "Good", "Great"];

function painColor(p: number | null | undefined) {
  if (p == null) return "var(--white-muted)";
  if (p <= 3) return "var(--green)";
  if (p <= 6) return "var(--amber)";
  return "var(--red)";
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function Timeline() {
  const [items, setItems] = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const id = getClientId();
    if (!id) return;
    (async () => {
      const { data } = await supabase
        .from("check_ins")
        .select("*")
        .eq("client_id", id)
        .order("created_at", { ascending: false });
      setItems((data as CheckIn[]) ?? []);
      setLoading(false);
    })();
  }, []);

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
        Your Timeline
      </h1>

      {loading ? (
        <p style={{ marginTop: 24, color: "var(--white-muted)" }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ marginTop: 24, color: "var(--white-muted)" }}>
          No check-ins yet. Complete your first check-in to get started.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 20 }}>
          {items.map((ci) => {
            const open = openId === ci.id;
            return (
              <button
                key={ci.id}
                type="button"
                onClick={() => setOpenId(open ? null : ci.id)}
                style={{
                  textAlign: "left",
                  background: "var(--navy-card)",
                  borderRadius: 12,
                  borderLeft: `3px solid ${painColor(ci.pain_level)}`,
                  border: "1px solid var(--navy-border)",
                  borderLeftWidth: 3,
                  borderLeftColor: painColor(ci.pain_level),
                  padding: 16,
                  color: "var(--white)",
                  width: "100%",
                  cursor: "pointer",
                }}
              >
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-data)",
                      fontSize: 12,
                      color: "var(--white-muted)",
                    }}
                  >
                    {fmtDate(ci.created_at)}
                  </span>
                  {ci.flagged && (
                    <span
                      style={{
                        background: "var(--red)",
                        color: "var(--white)",
                        fontSize: 10,
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontWeight: 700,
                        letterSpacing: "0.05em",
                      }}
                    >
                      FLAGGED
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 8 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-data)",
                      fontSize: 32,
                      fontWeight: 700,
                      color: painColor(ci.pain_level),
                      lineHeight: 1,
                    }}
                  >
                    {ci.pain_level ?? "—"}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--white-muted)" }}>pain</span>
                  {ci.mood != null && (
                    <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--white)" }}>
                      {moodLabels[ci.mood] ?? ""}
                    </span>
                  )}
                </div>
                {open && (
                  <div
                    style={{
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: "1px solid var(--navy-border)",
                      display: "grid",
                      gap: 6,
                      fontSize: 13,
                    }}
                  >
                    <Row k="Sleep" v={ci.sleep_quality} />
                    <Row k="Stress" v={ci.stress_level} />
                    <Row k="Energy" v={ci.energy_level} />
                    <Row k="Mood" v={ci.mood} />
                    <Row k="Medication" v={ci.medication_taken ? "Yes" : "No"} />
                    {ci.notes && (
                      <div
                        style={{ marginTop: 8, color: "var(--white-muted)", fontStyle: "italic" }}
                      >
                        “{ci.notes}”
                      </div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", color: "var(--white-muted)" }}>
      <span>{k}</span>
      <span style={{ color: "var(--white)", fontFamily: "var(--font-data)" }}>{v ?? "—"}</span>
    </div>
  );
}
