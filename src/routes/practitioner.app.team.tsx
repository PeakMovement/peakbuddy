import { createFileRoute } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Users, UserPlus, Trash2 } from "lucide-react";
import {
  getMyPractice,
  invitePracticeMember,
  removePracticeMember,
  listPracticeClients,
} from "@/lib/practice-members.functions";

export const Route = createFileRoute("/practitioner/app/team")({
  head: () => ({ meta: [{ title: "Team — Buddy" }] }),
  component: TeamPage,
});

type PracticeInfo = Awaited<ReturnType<typeof getMyPractice>>;

function TeamPage() {
  const load = useServerFn(getMyPractice);
  const invite = useServerFn(invitePracticeMember);
  const remove = useServerFn(removePracticeMember);
  const loadClients = useServerFn(listPracticeClients);

  const [info, setInfo] = useState<PracticeInfo | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [allClients, setAllClients] = useState<
    { id: string; full_name: string; primary_complaint: string | null; practitioner_id: string }[]
  >([]);

  const refresh = useCallback(async () => {
    try {
      const r = await load();
      setInfo(r);
      setStatus("ready");
      if (r && r.inPractice && r.isOwner && r.practiceType === "group") {
        try {
          const c = await loadClients();
          if (c.ok) setAllClients(c.clients as typeof allClients);
        } catch {
          /* non-fatal */
        }
      }
    } catch {
      setStatus("error");
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addMember = async () => {
    if (!email.trim() || !name.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await invite({ data: { email: email.trim(), fullName: name.trim() } });
      if (r.ok) {
        setMsg({ kind: "ok", text: "Invite sent. They'll get an email to set their password." });
        setEmail("");
        setName("");
        await refresh();
      } else {
        setMsg({ kind: "err", text: r.error });
      }
    } catch {
      setMsg({ kind: "err", text: "Couldn't add that practitioner. Try again." });
    }
    setBusy(false);
  };

  const removeMember = async (userId: string, memberName: string) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await remove({ data: { userId } });
      if (r.ok) {
        setMsg({ kind: "ok", text: `${memberName} removed from the practice.` });
        await refresh();
      } else {
        setMsg({ kind: "err", text: r.error });
      }
    } catch {
      setMsg({ kind: "err", text: "Couldn't remove that member. Try again." });
    }
    setBusy(false);
  };

  return (
    <div style={wrap}>
      <header style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
        <Users size={20} color="var(--blue-accent)" aria-hidden />
        <h1 style={h1}>Your team</h1>
      </header>

      {status === "loading" && <p style={muted}>Loading…</p>}
      {status === "error" && <p style={muted}>Couldn't load your practice. Please refresh.</p>}

      {status === "ready" && info && !info.inPractice && (
        <p style={muted}>No practice found for your account. Contact support.</p>
      )}

      {status === "ready" && info && info.inPractice && info.practiceType !== "group" && (
        <div style={card}>
          <p style={{ ...muted, margin: 0 }}>
            This is an <strong style={{ color: "var(--white)" }}>individual</strong> account — just you and your
            own clients. To run a shared practice with several practitioners, create a practice account.
          </p>
        </div>
      )}

      {status === "ready" && info && info.inPractice && info.practiceType === "group" && !info.isOwner && (
        <div style={card}>
          <p style={{ ...muted, margin: 0 }}>
            You're a practitioner in this practice. Only the practice admin can add or remove members. You see
            and manage your own clients; the admin can see everyone's.
          </p>
        </div>
      )}

      {status === "ready" && info && info.inPractice && info.practiceType === "group" && info.isOwner && (
        <>
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={sub}>Practitioners</span>
              <span style={{ ...sub, color: "var(--white-muted)" }}>
                {info.memberCount} / {info.maxMembers}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              {info.members.map((m) => (
                <div key={m.userId} style={memberRow}>
                  <div>
                    <div style={{ color: "var(--white)", fontWeight: 600, fontSize: 14 }}>
                      {m.name}
                      {m.role === "owner" && <span style={badge}>Admin</span>}
                    </div>
                    <div style={{ color: "var(--white-muted)", fontSize: 12 }}>{m.email}</div>
                  </div>
                  {m.role !== "owner" && (
                    <button
                      type="button"
                      onClick={() => removeMember(m.userId, m.name)}
                      disabled={busy}
                      aria-label={`Remove ${m.name}`}
                      style={iconBtn}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {info.memberCount < info.maxMembers ? (
            <div style={card}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <UserPlus size={17} color="var(--blue-accent)" aria-hidden />
                <span style={sub}>Add a practitioner</span>
              </div>
              <input
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={input}
              />
              <input
                placeholder="Email"
                type="email"
                autoCapitalize="none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{ ...input, marginTop: 8 }}
              />
              <button type="button" onClick={addMember} disabled={busy || !email.trim() || !name.trim()} style={cta}>
                {busy ? "Sending…" : "Send invite"}
              </button>
              <p style={fine}>
                They'll get an email to set their password and can sign in as a practitioner in your practice.
              </p>
            </div>
          ) : (
            <div style={card}>
              <p style={{ ...muted, margin: 0 }}>
                Your practice is full ({info.maxMembers} practitioners). Remove someone to add another.
              </p>
            </div>
          )}
        </>
      )}

      {status === "ready" && info && info.inPractice && info.isOwner && info.practiceType === "group" && allClients.length > 0 && (
        <div style={card}>
          <span style={sub}>All clients ({allClients.length})</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {allClients.map((c) => {
              const who = info.members.find((m) => m.userId === c.practitioner_id)?.name ?? "Unassigned";
              return (
                <div key={c.id} style={memberRow}>
                  <div>
                    <div style={{ color: "var(--white)", fontWeight: 600, fontSize: 14 }}>{c.full_name}</div>
                    <div style={{ color: "var(--white-muted)", fontSize: 12 }}>
                      {c.primary_complaint || "—"}
                    </div>
                  </div>
                  <span style={{ ...badge, color: "var(--white-muted)" }}>{who}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {msg && (
        <div style={{ ...card, borderColor: msg.kind === "ok" ? "var(--green)" : "var(--red)" }}>
          <span style={{ color: msg.kind === "ok" ? "var(--green)" : "var(--red)", fontSize: 13.5 }}>
            {msg.text}
          </span>
        </div>
      )}
    </div>
  );
}

const wrap: CSSProperties = { padding: "16px 14px 96px", display: "flex", flexDirection: "column", gap: 12 };
const h1: CSSProperties = { fontFamily: "var(--font-hero)", fontSize: 24, fontWeight: 700, color: "var(--white)", margin: 0 };
const muted: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 14, lineHeight: 1.5, color: "var(--white-muted)" };
const sub: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--white-muted)" };
const card: CSSProperties = { background: "var(--navy-card)", border: "1px solid var(--navy-border)", borderRadius: 14, padding: 16 };
const memberRow: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" };
const badge: CSSProperties = { marginLeft: 8, fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--blue-accent)", border: "1px solid var(--navy-border)", borderRadius: 999, padding: "2px 7px" };
const iconBtn: CSSProperties = { background: "transparent", border: "none", color: "var(--red)", cursor: "pointer", padding: 6 };
const input: CSSProperties = { width: "100%", padding: "11px 12px", borderRadius: 10, background: "var(--navy)", border: "1px solid var(--navy-border)", color: "var(--white)", fontFamily: "var(--font-ui)", fontSize: 15 };
const cta: CSSProperties = { width: "100%", marginTop: 12, background: "var(--blue-accent)", color: "var(--navy)", border: "none", borderRadius: 10, padding: "12px 16px", fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 700, cursor: "pointer" };
const fine: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, lineHeight: 1.5, color: "var(--white-muted)", marginTop: 10 };
