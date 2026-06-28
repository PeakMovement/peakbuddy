import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LogOut, ExternalLink, Trash2, ChevronDown, Phone, Check, Mail } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getClientId, clearClientId } from "@/lib/client-session";
import type { CheckIn, Client } from "@/lib/types";
import {
  getMyProgram,
  respondToSuggestedProgram,
  type ClientProgramState,
} from "@/lib/client-program.functions";
import { deleteMyAccount } from "@/lib/account-delete.functions";
import { updateClientPhone, updateMyEmail } from "@/lib/client-profile.functions";
import { MyRewards } from "@/components/MyRewards";

export const Route = createFileRoute("/client/app/profile")({
  head: () => ({ meta: [{ title: "Profile — Buddy" }] }),
  component: ClientProfile,
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

function ClientProfile() {
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [programState, setProgramState] = useState<ClientProgramState | null>(null);
  const loadProgram = useServerFn(getMyProgram);
  const respond = useServerFn(respondToSuggestedProgram);
  const [busy, setBusy] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineItems, setTimelineItems] = useState<CheckIn[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [openCheckInId, setOpenCheckInId] = useState<string | null>(null);

  useEffect(() => {
    const id = getClientId();
    if (!id) {
      navigate({ to: "/client/login" });
      return;
    }
    (async () => {
      const { data } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
      setClient(data as Client | null);
      setLoading(false);
    })();
    loadProgram()
      .then((res) => setProgramState(res))
      .catch(() => {});
  }, [navigate, loadProgram]);

  const handleAccept = async () => {
    if (busy) return;
    setBusy(true);
    const res = await respond({ data: { decision: "accepted" } });
    setBusy(false);
    if (res.ok && programState?.program?.external_url) {
      window.open(programState.program.external_url, "_blank", "noopener,noreferrer");
    }
    if (res.ok) {
      const fresh = await loadProgram();
      setProgramState(fresh);
    }
  };

  const handleDecline = async () => {
    if (busy) return;
    setBusy(true);
    const res = await respond({ data: { decision: "declined" } });
    setBusy(false);
    if (res.ok) {
      const fresh = await loadProgram();
      setProgramState(fresh);
    }
  };

  useEffect(() => {
    if (!timelineOpen) return;
    const id = getClientId();
    if (!id) return;
    let cancelled = false;
    setTimelineLoading(true);
    supabase
      .from("check_ins")
      .select("*")
      .eq("client_id", id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        setTimelineItems((data as CheckIn[]) ?? []);
        setTimelineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [timelineOpen]);

  const signOut = async () => {
    await supabase.auth.signOut();
    clearClientId();
    navigate({ to: "/client/login" });
  };

  const deleteAccount = useServerFn(deleteMyAccount);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const savePhone = useServerFn(updateClientPhone);
  const [phoneEdit, setPhoneEdit] = useState(false);
  const [phoneValue, setPhoneValue] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const saveEmail = useServerFn(updateMyEmail);
  const [emailEdit, setEmailEdit] = useState(false);
  const [emailValue, setEmailValue] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const handleDeleteAccount = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await deleteAccount();
      if (res.ok) {
        await supabase.auth.signOut();
        clearClientId();
        navigate({ to: "/client/login" });
        return;
      }
      setDeleteError(res.error ?? "Could not delete your account. Please try again.");
    } catch {
      setDeleteError("Could not delete your account. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div style={{ padding: 24, color: "var(--white-muted)" }}>Loading…</div>;

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
        Profile
      </h1>

      <div
        style={{
          marginTop: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <ProfileField label="Name" value={client?.full_name} />
        <EditableTextField
          label="Email"
          icon={<Mail size={12} />}
          type="email"
          placeholder="Enter email address"
          emptyText="Tap to add your email"
          currentValue={client?.email}
          edit={emailEdit}
          value={emailValue}
          busy={emailBusy}
          error={emailError}
          onStartEdit={() => {
            setEmailValue(client?.email || "");
            setEmailEdit(true);
            setEmailError(null);
          }}
          onCancel={() => setEmailEdit(false)}
          onChange={setEmailValue}
          onSave={async (val) => {
            if (!client) return;
            const next = val.trim();
            if (!next) {
              setEmailError("Email is required.");
              return;
            }
            setEmailBusy(true);
            setEmailError(null);
            try {
              const res = await saveEmail({ data: { email: next } });
              setClient({ ...client, email: res.email });
              setEmailEdit(false);
            } catch (e: any) {
              setEmailError(e?.message || "Could not save email.");
            } finally {
              setEmailBusy(false);
            }
          }}
        />
        <EditableTextField
          label="Phone"
          icon={<Phone size={12} />}
          type="tel"
          placeholder="Enter phone number"
          emptyText="Tap to add your phone number"
          currentValue={client?.phone}
          edit={phoneEdit}
          value={phoneValue}
          busy={phoneBusy}
          error={phoneError}
          onStartEdit={() => {
            setPhoneValue(client?.phone || "");
            setPhoneEdit(true);
            setPhoneError(null);
          }}
          onCancel={() => setPhoneEdit(false)}
          onChange={setPhoneValue}
          onSave={async (val) => {
            if (!client) return;
            setPhoneBusy(true);
            setPhoneError(null);
            try {
              await savePhone({ data: { phone: val || null } });
              setClient({ ...client, phone: val || null });
              setPhoneEdit(false);
            } catch (e: any) {
              setPhoneError(e?.message || "Could not save phone number.");
            } finally {
              setPhoneBusy(false);
            }
          }}
        />
      </div>

      {/* Rewards */}
      <SectionHeader>Rewards</SectionHeader>
      <MyRewards />

      {/* Plan */}
      {programState?.program && programState.status !== "none" && (
        <>
          <SectionHeader>Your plan</SectionHeader>
          <MyProgramCard
            state={programState}
            busy={busy}
            onAccept={handleAccept}
            onDecline={handleDecline}
          />
        </>
      )}

      {/* Collapsible Timeline */}
      <div style={{ marginTop: 28 }}>
        <button
          type="button"
          onClick={() => setTimelineOpen((o) => !o)}
          style={{
            width: "100%",
            background: "var(--navy-card)",
            border: "1px solid var(--navy-border)",
            borderRadius: 12,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            color: "var(--white)",
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          <span>Your Timeline</span>
          <ChevronDown
            size={18}
            style={{
              transform: timelineOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s",
              color: "var(--white-muted)",
            }}
          />
        </button>

        {timelineOpen && (
          <div style={{ marginTop: 12 }}>
            {timelineLoading ? (
              <p style={{ color: "var(--white-muted)", fontSize: 13 }}>Loading…</p>
            ) : timelineItems.length === 0 ? (
              <p style={{ color: "var(--white-muted)", fontSize: 13 }}>
                No check-ins yet. Complete your first check-in to get started.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {timelineItems.map((ci) => {
                  const open = openCheckInId === ci.id;
                  return (
                    <button
                      key={ci.id}
                      type="button"
                      onClick={() => setOpenCheckInId(open ? null : ci.id)}
                      style={{
                        textAlign: "left",
                        background: "var(--navy-card)",
                        borderRadius: 12,
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
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 12,
                          marginTop: 8,
                        }}
                      >
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
                          <span
                            style={{
                              marginLeft: "auto",
                              fontSize: 13,
                              color: "var(--white)",
                            }}
                          >
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
                          <DetailRow k="Sleep" v={ci.sleep_quality} />
                          <DetailRow k="Stress" v={ci.stress_level} />
                          <DetailRow k="Energy" v={ci.energy_level} />
                          <DetailRow k="Mood" v={ci.mood} />
                          <DetailRow k="Medication" v={ci.medication_taken ? "Yes" : "No"} />
                          {ci.notes && (
                            <div
                              style={{
                                marginTop: 8,
                                color: "var(--white-muted)",
                                fontStyle: "italic",
                              }}
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
        )}
      </div>

      <button
        type="button"
        onClick={signOut}
        style={{
          marginTop: 32,
          minHeight: 48,
          width: "100%",
          background: "transparent",
          color: "var(--white-muted)",
          border: "1px solid var(--navy-border)",
          borderRadius: 8,
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <LogOut size={16} />
        Sign out
      </button>

      <DeleteAccountSection
        confirm={confirmDelete}
        deleting={deleting}
        error={deleteError}
        onAskConfirm={() => setConfirmDelete(true)}
        onCancel={() => {
          setConfirmDelete(false);
          setDeleteError(null);
        }}
        onConfirm={handleDeleteAccount}
      />
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 8,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          color: "var(--white-muted)",
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--white)",
          fontFamily: "var(--font-ui)",
          fontSize: 16,
          wordBreak: "break-word",
        }}
      >
        {value || "—"}
      </div>
    </div>
  );
}

function MyProgramCard({
  state,
  busy,
  onAccept,
  onDecline,
}: {
  state: ClientProgramState;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const program = state.program!;
  const status = state.status;
  const statusColor =
    status === "accepted"
      ? "var(--green)"
      : status === "declined"
        ? "var(--white-muted)"
        : "var(--blue-accent)";
  const statusLabel =
    status === "accepted" ? "Joined" : status === "declined" ? "Declined" : "Pending";

  return (
    <div
      style={{
        marginTop: 28,
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 12,
        overflow: "hidden",
        opacity: status === "declined" ? 0.7 : 1,
      }}
    >
      {(program.cover_image_url || program.image_url) && (
        <img
          src={program.cover_image_url || program.image_url || ""}
          alt=""
          style={{ width: "100%", height: 140, objectFit: "cover" }}
        />
      )}
      <div style={{ padding: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--white-muted)",
            }}
          >
            My Program
          </div>
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              padding: "4px 8px",
              borderRadius: 999,
              border: `1px solid ${statusColor}`,
              color: statusColor,
            }}
          >
            {statusLabel}
          </span>
        </div>
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 18,
            fontWeight: 600,
            color: "var(--white)",
          }}
        >
          {program.name}
        </div>
        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 14,
            lineHeight: 1.5,
            color: "var(--white-muted)",
            marginTop: 6,
          }}
        >
          {program.description}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
          {status === "accepted" && program.external_url && (
            <a
              href={program.external_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                minHeight: 44,
                background: "var(--blue-accent)",
                color: "var(--white)",
                border: "none",
                borderRadius: 8,
                fontFamily: "var(--font-ui)",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              Open program <ExternalLink size={16} />
            </a>
          )}
          {(status === "declined" || status === "pending") && (
            <button
              type="button"
              onClick={onAccept}
              disabled={busy}
              style={{
                minHeight: 44,
                background: "var(--blue-accent)",
                color: "var(--white)",
                border: "none",
                borderRadius: 8,
                fontFamily: "var(--font-ui)",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                opacity: busy ? 0.7 : 1,
              }}
            >
              {status === "declined" ? "Change my mind — join program" : "Yes, I'll join"}
            </button>
          )}
          {status === "pending" && (
            <button
              type="button"
              onClick={onDecline}
              disabled={busy}
              style={{
                minHeight: 40,
                background: "transparent",
                color: "var(--white-muted)",
                border: "1px solid var(--navy-border)",
                borderRadius: 8,
                fontFamily: "var(--font-ui)",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Not for me
            </button>
          )}
        </div>
        {state.decided_at && (
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: "var(--white-muted)",
              fontFamily: "var(--font-ui)",
            }}
          >
            Decision: {new Date(state.decided_at).toLocaleDateString()}
          </div>
        )}
      </div>
    </div>
  );
}


function DeleteAccountSection({
  confirm,
  deleting,
  error,
  onAskConfirm,
  onCancel,
  onConfirm,
}: {
  confirm: boolean;
  deleting: boolean;
  error: string | null;
  onAskConfirm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      style={{
        marginTop: 28,
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 8,
        padding: "16px 14px",
      }}
    >
      <div
        style={{
          color: "var(--white-muted)",
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
        }}
      >
        Delete account
      </div>
      <p
        style={{
          color: "var(--white-muted)",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          lineHeight: 1.5,
          margin: "0 0 14px",
        }}
      >
        Permanently delete your account and all your data — check-ins, symptom notes, Yves
        conversations and program history. This cannot be undone.
      </p>

      {error && (
        <p
          style={{
            color: "var(--red, #ff6b6b)",
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            margin: "0 0 12px",
          }}
        >
          {error}
        </p>
      )}

      {!confirm ? (
        <button
          type="button"
          onClick={onAskConfirm}
          style={{
            minHeight: 44,
            width: "100%",
            background: "transparent",
            color: "var(--red, #ff6b6b)",
            border: "1px solid var(--red, #ff6b6b)",
            borderRadius: 8,
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 14,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <Trash2 size={16} />
          Delete my account
        </button>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p
            style={{
              color: "var(--white)",
              fontFamily: "var(--font-ui)",
              fontSize: 14,
              fontWeight: 600,
              margin: 0,
            }}
          >
            Are you sure? This permanently deletes your account and data.
          </p>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            style={{
              minHeight: 44,
              width: "100%",
              background: "var(--red, #ff6b6b)",
              color: "var(--white)",
              border: "none",
              borderRadius: 8,
              fontFamily: "var(--font-ui)",
              fontWeight: 700,
              fontSize: 14,
              cursor: deleting ? "default" : "pointer",
              opacity: deleting ? 0.7 : 1,
            }}
          >
            {deleting ? "Deleting…" : "Yes, permanently delete my account"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            style={{
              minHeight: 40,
              width: "100%",
              background: "transparent",
              color: "var(--white-muted)",
              border: "1px solid var(--navy-border)",
              borderRadius: 8,
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function DetailRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", color: "var(--white-muted)" }}>
      <span>{k}</span>
      <span style={{ color: "var(--white)", fontFamily: "var(--font-data)" }}>{v ?? "—"}</span>
    </div>
  );
}

export function EditableTextField({
  label,
  icon,
  type,
  placeholder,
  emptyText,
  currentValue,
  onSave,
  edit,
  value,
  busy,
  error,
  onStartEdit,
  onCancel,
  onChange,
}: {
  label: string;
  icon?: React.ReactNode;
  type: "text" | "email" | "tel";
  placeholder: string;
  emptyText: string;
  currentValue?: string | null;
  onSave: (val: string) => Promise<void> | void;
  edit: boolean;
  value: string;
  busy: boolean;
  error: string | null;
  onStartEdit: () => void;
  onCancel: () => void;
  onChange: (v: string) => void;
}) {
  if (!edit) {
    return (
      <button
        type="button"
        onClick={onStartEdit}
        style={{
          width: "100%",
          textAlign: "left",
          background: "var(--navy-card)",
          border: "1px solid var(--navy-border)",
          borderRadius: 8,
          padding: "12px 14px",
          cursor: "pointer",
          color: "inherit",
        }}
      >
        <div
          style={{
            color: "var(--white-muted)",
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 4,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {icon}
          {label}
        </div>
        <div
          style={{
            color: "var(--white)",
            fontFamily: "var(--font-ui)",
            fontSize: 16,
            wordBreak: "break-word",
          }}
        >
          {currentValue || emptyText}
        </div>
      </button>
    );
  }

  return (
    <div
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 8,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          color: "var(--white-muted)",
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 8,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {icon}
        {label}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          autoCapitalize="off"
          autoCorrect="off"
          style={{
            flex: 1,
            background: "var(--navy-bg, #0a0f1c)",
            border: "1px solid var(--navy-border)",
            borderRadius: 6,
            padding: "10px 12px",
            color: "var(--white)",
            fontFamily: "var(--font-ui)",
            fontSize: 15,
            outline: "none",
          }}
        />
        <button
          type="button"
          onClick={() => onSave(value)}
          disabled={busy}
          style={{
            minWidth: 44,
            minHeight: 44,
            background: "var(--blue-accent)",
            border: "none",
            borderRadius: 6,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          <Check size={18} color="#fff" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          style={{
            minWidth: 44,
            minHeight: 44,
            background: "transparent",
            border: "1px solid var(--navy-border)",
            borderRadius: 6,
            color: "var(--white-muted)",
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p style={{ marginTop: 8, color: "var(--red)", fontSize: 13 }}>{error}</p>
      )}
    </div>
  );
}

