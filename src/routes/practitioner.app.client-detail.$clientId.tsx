import { createFileRoute, Link } from "@tanstack/react-router";
import { ClientRewardsSection } from "@/components/ClientRewardsSection";
import { RequestCheckInButton } from "@/components/RequestCheckInButton";
import { ClientWearablesCard } from "@/components/ClientWearablesCard";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/lib/supabase";
import type { CheckIn, Client } from "@/lib/types";
import { CircularRing, ringColor } from "@/components/CircularRing";
import { useServerFn } from "@tanstack/react-start";
import { getClientProgramForPractitioner, type ProgramLite } from "@/lib/client-program.functions";

export const Route = createFileRoute("/practitioner/app/client-detail/$clientId")({
  head: () => ({ meta: [{ title: "Client — Buddy" }] }),
  component: ClientDetail,
});

function avg(items: CheckIn[], key: keyof CheckIn) {
  const vals = items.map((i) => i[key]).filter((v) => typeof v === "number") as number[];
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function ClientDetail() {
  const { clientId } = Route.useParams();
  const [client, setClient] = useState<Client | null>(null);
  const [items, setItems] = useState<CheckIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [practiceYves, setPracticeYves] = useState<boolean>(true);
  const [savingYves, setSavingYves] = useState(false);
  const [chartType, setChartType] = useState<"line" | "bar" | "rings">("line");
  const [metric, setMetric] = useState<"pain" | "sleep" | "stress" | "energy">("pain");
  const [programInfo, setProgramInfo] = useState<{
    program: ProgramLite | null;
    status: "none" | "pending" | "accepted" | "declined";
    decided_at: string | null;
  } | null>(null);
  const getProgram = useServerFn(getClientProgramForPractitioner);

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const [{ data: c }, { data: ci }, { data: pr }] = await Promise.all([
      supabase
        .from("clients")
        .select("*")
        .eq("id", clientId)
        .eq("practitioner_id", u.user.id)
        .maybeSingle(),
      supabase
        .from("check_ins")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false }),
      supabase
        .from("practices")
        .select("yves_enabled")
        .eq("practitioner_id", u.user.id)
        .maybeSingle(),
    ]);
    setClient(c as Client | null);
    setItems((ci as CheckIn[]) ?? []);
    setPracticeYves((pr as { yves_enabled: boolean } | null)?.yves_enabled !== false);
    setLoading(false);
  };

  const toggleYves = async () => {
    if (!client || savingYves) return;
    const next = !(client.yves_enabled !== false);
    setSavingYves(true);
    const { error } = await supabase
      .from("clients")
      .update({ yves_enabled: next })
      .eq("id", client.id);
    if (!error) setClient({ ...client, yves_enabled: next });
    setSavingYves(false);
  };

  useEffect(() => {
    load();
    getProgram({ data: { clientId } })
      .then((res) => setProgramInfo(res))
      .catch(() => {});
  }, [clientId, getProgram]);

  const stats = useMemo(
    () => ({
      pain: avg(items, "pain_level"),
      sleep: avg(items, "sleep_quality"),
      stress: avg(items, "stress_level"),
      energy: avg(items, "energy_level"),
    }),
    [items],
  );

  const compliance = useMemo(() => {
    if (!client) return 0;
    const weeks = client.tracking_duration_weeks ?? 8;
    const start = new Date(client.created_at).getTime();
    const elapsed = Math.max(1, Math.ceil((Date.now() - start) / (1000 * 60 * 60 * 24)));
    const expectedSoFar =
      client.check_in_frequency === "daily"
        ? Math.min(elapsed, weeks * 7)
        : client.check_in_frequency === "weekly"
          ? Math.min(Math.ceil(elapsed / 7), weeks)
          : Math.min(
              Math.ceil(elapsed / (client.check_in_frequency === "every_3_days" ? 3 : 2)),
              weeks * 4,
            );
    return Math.min(100, Math.round((items.length / Math.max(1, expectedSoFar)) * 100));
  }, [client, items]);

  const trendUp = useMemo(() => {
    const pains = [...items]
      .reverse()
      .filter((i) => i.pain_level != null)
      .map((i) => i.pain_level as number);
    if (pains.length < 6) return false;
    const half = Math.floor(pains.length / 2);
    const a = pains.slice(0, half).reduce((x, y) => x + y, 0) / half;
    const b = pains.slice(half).reduce((x, y) => x + y, 0) / (pains.length - half);
    return b - a >= 0.7;
  }, [items]);

  const last30 = useMemo(() => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return [...items]
      .reverse()
      .filter((i) => new Date(i.created_at).getTime() >= cutoff)
      .map((i) => ({
        date: new Date(i.created_at).toLocaleDateString(undefined, {
          month: "numeric",
          day: "numeric",
        }),
        pain: i.pain_level,
        sleep: i.sleep_quality,
        stress: i.stress_level,
        energy: i.energy_level,
      }));
  }, [items]);

  const metricMeta = {
    pain: { label: "Pain", max: 10, color: "var(--blue-cold)" },
    sleep: { label: "Sleep", max: 5, color: "var(--blue-accent)" },
    stress: { label: "Stress", max: 5, color: "var(--amber)" },
    energy: { label: "Energy", max: 5, color: "var(--green)" },
  } as const;

  const recommendations = useMemo(() => {
    const recs: string[] = [];
    if (trendUp)
      recs.push("Pain levels are increasing. Consider reviewing the current treatment plan.");
    if (compliance < 50) recs.push("Low check-in frequency. Encourage the client to log daily.");
    const last = items[0];
    const noRecent =
      !last || Date.now() - new Date(last.created_at).getTime() > 7 * 24 * 60 * 60 * 1000;
    if (noRecent) recs.push("No recent check-ins. Follow up with this client.");
    if (stats.pain >= 7) recs.push("High average pain reported. Consider specialist referral.");
    return recs.slice(0, 4);
  }, [trendUp, compliance, items, stats.pain]);

  if (loading) return <div style={{ padding: 24, color: "var(--white-muted)" }}>Loading…</div>;
  if (!client) {
    return (
      <div style={{ padding: 24 }}>
        <Link to="/practitioner/app/dashboard" style={{ color: "var(--blue-accent)" }}>
          ← Back
        </Link>
        <p style={{ marginTop: 16, color: "var(--white-muted)" }}>Client not found.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 16px 32px" }}>
      <Link
        to="/practitioner/app/dashboard"
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

      <h1
        style={{
          marginTop: 12,
          fontFamily: "var(--font-hero)",
          fontWeight: 400,
          fontSize: 30,
          color: "var(--white)",
        }}
      >
        {client.full_name}
      </h1>
      <div
        style={{
          marginTop: 4,
          color: "var(--white-muted)",
          fontFamily: "var(--font-ui)",
          fontSize: 14,
        }}
      >
        {client.primary_complaint || "—"}
      </div>

      {programInfo?.program && programInfo.status !== "none" && (
        <ProgramStatusRow info={programInfo} />
      )}

      <ClientWearablesCard clientId={client.id} />
      <RequestCheckInButton clientId={client.id} />
      <ClientRewardsSection clientId={client.id} />

      <section
        style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}
      >
        <MetricMini label="Pain" value={stats.pain} max={10} />
        <MetricMini label="Sleep" value={stats.sleep} max={5} />
        <MetricMini label="Stress" value={stats.stress} max={5} />
        <MetricMini label="Energy" value={stats.energy} max={5} />
      </section>

      <div
        style={{ marginTop: 28, display: "flex", flexDirection: "column", alignItems: "center" }}
      >
        <CircularRing size={160} stroke={14} pct={compliance} color={ringColor(compliance)}>
          <div
            style={{
              fontFamily: "var(--font-data)",
              fontSize: 32,
              fontWeight: 700,
              color: "var(--white)",
            }}
          >
            {compliance}%
          </div>
        </CircularRing>
        <div
          style={{
            marginTop: 8,
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            color: "var(--white-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontSize: 12,
          }}
        >
          Compliance Score
        </div>
      </div>

      {last30.length >= 1 && (
        <div
          style={{
            marginTop: 24,
            background: "var(--navy-card)",
            border: "1px solid var(--navy-border)",
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-ui)",
                fontWeight: 600,
                color: "var(--white)",
              }}
            >
              {chartType === "rings"
                ? "Latest check-in"
                : `${metricMeta[metric].label} — last 30 days`}
            </div>
            <Segmented
              options={[
                { value: "line", label: "Line" },
                { value: "bar", label: "Bar" },
                { value: "rings", label: "Rings" },
              ]}
              value={chartType}
              onChange={(v) => setChartType(v as typeof chartType)}
            />
          </div>

          {chartType !== "rings" && (
            <div style={{ marginBottom: 10 }}>
              <Segmented
                options={[
                  { value: "pain", label: "Pain" },
                  { value: "sleep", label: "Sleep" },
                  { value: "stress", label: "Stress" },
                  { value: "energy", label: "Energy" },
                ]}
                value={metric}
                onChange={(v) => setMetric(v as typeof metric)}
              />
            </div>
          )}

          {chartType === "line" && (
            <div style={{ width: "100%", height: 180 }}>
              <ResponsiveContainer>
                <LineChart data={last30} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="var(--navy-border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="var(--white-muted)" fontSize={10} />
                  <YAxis
                    domain={[0, metricMeta[metric].max]}
                    stroke="var(--white-muted)"
                    fontSize={10}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--navy)",
                      border: "1px solid var(--navy-border)",
                      color: "var(--white)",
                      fontSize: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey={metric}
                    stroke={metricMeta[metric].color}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {chartType === "bar" && (
            <div style={{ width: "100%", height: 180 }}>
              <ResponsiveContainer>
                <BarChart data={last30} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="var(--navy-border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="var(--white-muted)" fontSize={10} />
                  <YAxis
                    domain={[0, metricMeta[metric].max]}
                    stroke="var(--white-muted)"
                    fontSize={10}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--navy)",
                      border: "1px solid var(--navy-border)",
                      color: "var(--white)",
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey={metric} fill={metricMeta[metric].color} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {chartType === "rings" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 8,
                paddingTop: 4,
              }}
            >
              {(["pain", "sleep", "stress", "energy"] as const).map((k) => {
                const v = stats[k];
                const max = metricMeta[k].max;
                const pct = Math.min(100, Math.round((v / max) * 100));
                return (
                  <div
                    key={k}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center" }}
                  >
                    <CircularRing size={72} stroke={7} pct={pct} color={metricMeta[k].color}>
                      <div
                        style={{
                          fontFamily: "var(--font-data)",
                          fontSize: 14,
                          fontWeight: 700,
                          color: "var(--white)",
                        }}
                      >
                        {v.toFixed(1)}
                      </div>
                    </CircularRing>
                    <div
                      style={{
                        marginTop: 6,
                        fontFamily: "var(--font-ui)",
                        fontSize: 11,
                        color: "var(--white-muted)",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {metricMeta[k].label}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {recommendations.length > 0 && (
        <section style={{ marginTop: 24 }}>
          <h2
            style={{
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 14,
              color: "var(--white-muted)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Recommendations
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {recommendations.map((r) => (
              <div
                key={r}
                style={{
                  background: "var(--navy-card)",
                  border: "1px solid var(--navy-border)",
                  borderLeft: "3px solid var(--amber)",
                  borderRadius: 8,
                  padding: 12,
                  color: "var(--white)",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                {r}
              </div>
            ))}
          </div>
        </section>
      )}

      <section style={{ marginTop: 24 }}>
        <h2
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 14,
            color: "var(--white-muted)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          Check-in History
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
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-data)",
                      fontSize: 12,
                      color: "var(--white-muted)",
                    }}
                  >
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
                {(() => {
                  const cc = (ci as unknown as { condition_context?: string | null })
                    .condition_context;
                  const cn = (ci as unknown as { condition_note?: string | null }).condition_note;
                  if (!cc) return null;
                  return (
                    <div
                      style={{
                        marginTop: 6,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "3px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontFamily: "var(--font-data)",
                        background:
                          cc === "different" ? "rgba(249,168,37,0.15)" : "rgba(96,165,250,0.15)",
                        color: cc === "different" ? "var(--amber, #f9a825)" : "var(--blue-cold)",
                        border: `1px solid ${
                          cc === "different"
                            ? "rgba(249,168,37,0.35)"
                            : "rgba(96,165,250,0.35)"
                        }`,
                      }}
                    >
                      Repeat · {cc === "different" ? "different condition" : "same condition"}
                      {cn ? ` — ${cn}` : ""}
                    </div>
                  );
                })()}
                {ci.notes && (
                  <div style={{ marginTop: 6, color: "var(--white)", fontSize: 13 }}>
                    {ci.notes}
                  </div>
                )}

              </div>
            ))}
          </div>
        )}
      </section>

      <section
        style={{
          marginTop: 24,
          padding: 14,
          background: "var(--navy-card)",
          border: "1px solid var(--navy-border)",
          borderRadius: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-ui)",
                fontWeight: 600,
                color: "var(--white)",
                fontSize: 14,
              }}
            >
              Yves AI triage
            </div>
            <div
              style={{
                marginTop: 4,
                color: "var(--white-muted)",
                fontFamily: "var(--font-ui)",
                fontSize: 12,
              }}
            >
              {!practiceYves
                ? "Disabled at practice level by admin."
                : client.yves_enabled !== false
                  ? "On — this client can ask Yves."
                  : "Off — this client sees a message asking you to enable it."}
            </div>
          </div>
          {(() => {
            const effectiveOn = practiceYves && client.yves_enabled !== false;
            return (
              <button
                type="button"
                onClick={toggleYves}
                disabled={!practiceYves || savingYves}
                style={{
                  minWidth: 72,
                  minHeight: 36,
                  borderRadius: 999,
                  border: "1px solid var(--blue-accent)",
                  background: effectiveOn ? "var(--blue-accent)" : "transparent",
                  color: effectiveOn ? "var(--white)" : "var(--blue-accent)",
                  fontFamily: "var(--font-ui)",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: !practiceYves || savingYves ? "not-allowed" : "pointer",
                  opacity: !practiceYves ? 0.5 : savingYves ? 0.6 : 1,
                }}
              >
                {effectiveOn ? "On" : "Off"}
              </button>
            );
          })()}
        </div>
      </section>

      <button
        type="button"
        onClick={() => setEditOpen(true)}
        style={{
          marginTop: 24,
          width: "100%",
          minHeight: 48,
          background: "transparent",
          color: "var(--blue-accent)",
          border: "1px solid var(--blue-accent)",
          borderRadius: 8,
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: 15,
          cursor: "pointer",
        }}
      >
        Edit Client
      </button>

      {editOpen && (
        <EditClientSheet
          client={client}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => {
            setClient(updated);
            setEditOpen(false);
          }}
        />
      )}
    </div>
  );
}

function MetricMini({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max ? (value / max) * 100 : 0;
  return (
    <div
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 10,
        padding: 8,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
      }}
    >
      <CircularRing size={56} stroke={6} pct={pct} color="var(--blue-cold)">
        <span
          style={{
            fontFamily: "var(--font-data)",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--white)",
          }}
        >
          {value ? value.toFixed(1) : "—"}
        </span>
      </CircularRing>
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 10,
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

function EditClientSheet({
  client,
  onClose,
  onSaved,
}: {
  client: Client;
  onClose: () => void;
  onSaved: (c: Client) => void;
}) {
  const [fullName, setFullName] = useState(client.full_name);
  const [email, setEmail] = useState(client.email ?? "");
  const [complaint, setComplaint] = useState(client.primary_complaint ?? "");
  const [notes, setNotes] = useState(client.notes ?? "");
  const [freq, setFreq] = useState(client.check_in_frequency ?? "daily");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setError("Not signed in.");
      setSaving(false);
      return;
    }
    const payload = {
      full_name: fullName.trim(),
      email: email.trim(),
      primary_complaint: complaint.trim(),
      notes: notes.trim(),
      check_in_frequency: freq,
    };
    const { data, error: e } = await supabase
      .from("clients")
      .update(payload)
      .eq("id", client.id)
      .eq("practitioner_id", u.user.id)
      .select()
      .maybeSingle();
    setSaving(false);
    if (e) {
      setError(e.message);
      return;
    }
    if (data) onSaved(data as Client);
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "var(--navy)",
    border: "1px solid var(--navy-border)",
    borderRadius: 8,
    padding: "12px 14px",
    color: "var(--white)",
    fontFamily: "var(--font-ui)",
    fontSize: 15,
    minHeight: 48,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 60,
        display: "flex",
        alignItems: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          background: "var(--navy-card)",
          borderTop: "1px solid var(--navy-border)",
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          padding: 20,
          maxHeight: "90vh",
          overflowY: "auto",
          paddingBottom: "calc(20px + env(safe-area-inset-bottom))",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h2 style={{ fontFamily: "var(--font-hero)", fontSize: 22, color: "var(--white)" }}>
            Edit Client
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--white-muted)",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <X size={22} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            style={inputStyle}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full name"
          />
          <input
            style={inputStyle}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
          />
          <input
            style={inputStyle}
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
            placeholder="Primary complaint"
          />
          <textarea
            style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes"
          />
          <select style={inputStyle} value={freq} onChange={(e) => setFreq(e.target.value)}>
            <option value="daily">Daily</option>
            <option value="every_2_days">Every 2 Days</option>
            <option value="every_3_days">Every 3 Days</option>
            <option value="weekly">Weekly</option>
          </select>
          {error && <div style={{ color: "var(--red)", fontSize: 13 }}>{error}</div>}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{
              minHeight: 48,
              background: "var(--blue-accent)",
              color: "var(--white)",
              border: "none",
              borderRadius: 8,
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 16,
              cursor: "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ProgramStatusRow({
  info,
}: {
  info: {
    program: ProgramLite | null;
    status: "none" | "pending" | "accepted" | "declined";
    decided_at: string | null;
  };
}) {
  if (!info.program) return null;
  const status = info.status;
  const color =
    status === "accepted"
      ? "var(--green)"
      : status === "declined"
        ? "var(--red, #e57373)"
        : "var(--blue-accent)";
  const label = status === "accepted" ? "Accepted" : status === "declined" ? "Declined" : "Pending";
  return (
    <section
      style={{
        marginTop: 14,
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        justifyContent: "space-between",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: "var(--white-muted)",
            fontFamily: "var(--font-ui)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: 4,
          }}
        >
          Suggested Program
        </div>
        <div
          style={{
            color: "var(--white)",
            fontFamily: "var(--font-ui)",
            fontSize: 15,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {info.program.name}
        </div>
        {info.decided_at && (
          <div
            style={{
              marginTop: 2,
              fontSize: 11,
              color: "var(--white-muted)",
              fontFamily: "var(--font-ui)",
            }}
          >
            {label} on {new Date(info.decided_at).toLocaleDateString()}
          </div>
        )}
      </div>
      <span
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          padding: "4px 10px",
          borderRadius: 999,
          border: `1px solid ${color}`,
          color,
          flexShrink: 0,
        }}
      >
        {label}
      </span>
    </section>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        background: "var(--navy)",
        border: "1px solid var(--navy-border)",
        borderRadius: 999,
        padding: 3,
        gap: 2,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              border: "none",
              cursor: "pointer",
              padding: "5px 12px",
              borderRadius: 999,
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.04em",
              background: active ? "var(--blue-accent)" : "transparent",
              color: active ? "var(--white)" : "var(--white-muted)",
              transition: "background 120ms ease, color 120ms ease",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
