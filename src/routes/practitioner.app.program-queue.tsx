import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, X, Sparkles, Wand2, UserCog } from "lucide-react";
import {
  listPendingProgramSuggestions,
  approveProgramSuggestion,
  rejectProgramSuggestion,
  getProgramsFeatureEnabled,
  type PendingSuggestion,
} from "@/lib/client-program.functions";
import { log } from "@/lib/log";


export const Route = createFileRoute("/practitioner/app/program-queue")({
  head: () => ({ meta: [{ title: "Program Queue — Buddy" }] }),
  component: ProgramQueue,
});

function sourceMeta(source: PendingSuggestion["source"]) {
  if (source === "auto_ai") return { label: "AI suggestion", Icon: Sparkles };
  if (source === "practitioner") return { label: "You assigned", Icon: UserCog };
  return { label: "Rule match", Icon: Wand2 };
}

function ProgramQueue() {
  const [items, setItems] = useState<PendingSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await listPendingProgramSuggestions();
      setItems(rows);
    } catch (e) {
      log.error(e);
      setError("Could not load the queue.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const approve = async (clientId: string) => {
    setBusy(clientId);
    setError(null);
    try {
      const r = await approveProgramSuggestion({ data: { clientId } });
      if (!r.ok) throw new Error(r.error);
      setItems((prev) => prev.filter((p) => p.client_id !== clientId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not approve.");
    } finally {
      setBusy(null);
    }
  };

  const reject = async (clientId: string) => {
    if (!confirm("Reject this program suggestion?")) return;
    setBusy(clientId);
    setError(null);
    try {
      const r = await rejectProgramSuggestion({ data: { clientId } });
      if (!r.ok) throw new Error(r.error);
      setItems((prev) => prev.filter((p) => p.client_id !== clientId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not reject.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ padding: "24px 20px 32px", color: "var(--white)" }}>
      <h1 style={{ fontFamily: "var(--font-hero)", fontSize: 24, fontWeight: 400 }}>
        Program Queue
      </h1>
      <p style={{ marginTop: 6, color: "var(--white-muted)", fontSize: 13 }}>
        Approve a program before your client sees it.
      </p>

      {error && (
        <div
          role="alert"
          style={{
            marginTop: 14,
            padding: 12,
            background: "color-mix(in oklab, var(--red) 18%, transparent)",
            border: "1px solid var(--red)",
            borderRadius: 10,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ marginTop: 20, color: "var(--white-muted)" }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ marginTop: 24, color: "var(--white-muted)" }}>
          Nothing waiting. New suggestions appear here after a client check-in.
        </p>
      ) : (
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((item) => {
            const { label, Icon } = sourceMeta(item.source);
            return (
              <div
                key={item.client_id}
                style={{
                  background: "var(--navy-card)",
                  border: "1px solid var(--navy-border)",
                  borderRadius: 12,
                  padding: 14,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <strong style={{ fontSize: 15 }}>{item.client_name}</strong>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 11,
                      padding: "2px 8px",
                      background: "var(--navy)",
                      borderRadius: 999,
                      color: "var(--blue-accent)",
                    }}
                  >
                    <Icon size={12} /> {label}
                  </span>
                </div>
                {item.primary_complaint && (
                  <p style={{ marginTop: 4, fontSize: 12, color: "var(--white-muted)" }}>
                    {item.primary_complaint}
                  </p>
                )}

                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 10,
                    background: "var(--navy)",
                    border: "1px solid var(--navy-border)",
                  }}
                >
                  {item.program ? (
                    <>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{item.program.name}</div>
                      {item.program.description && (
                        <p style={{ marginTop: 4, fontSize: 13, color: "var(--white-muted)", lineHeight: 1.4 }}>
                          {item.program.description}
                        </p>
                      )}
                    </>
                  ) : (
                    <span style={{ color: "var(--white-muted)", fontSize: 13 }}>
                      Program no longer available.
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button
                    onClick={() => reject(item.client_id)}
                    disabled={busy === item.client_id}
                    style={{
                      flex: 1,
                      minHeight: 44,
                      borderRadius: 8,
                      background: "transparent",
                      border: "1px solid var(--navy-border)",
                      color: "var(--white)",
                      fontFamily: "var(--font-ui)",
                      fontWeight: 600,
                      fontSize: 14,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      cursor: "pointer",
                      opacity: busy === item.client_id ? 0.5 : 1,
                    }}
                  >
                    <X size={16} /> Reject
                  </button>
                  <button
                    onClick={() => approve(item.client_id)}
                    disabled={busy === item.client_id || !item.program}
                    style={{
                      flex: 2,
                      minHeight: 44,
                      borderRadius: 8,
                      background: "var(--blue-accent)",
                      border: "none",
                      color: "var(--white)",
                      fontFamily: "var(--font-ui)",
                      fontWeight: 600,
                      fontSize: 14,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 6,
                      cursor: "pointer",
                      opacity: busy === item.client_id || !item.program ? 0.5 : 1,
                    }}
                  >
                    <Check size={16} /> Approve for client
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
