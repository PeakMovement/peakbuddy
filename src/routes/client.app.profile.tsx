import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LogOut, ExternalLink, Trash2, ChevronDown } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getClientId, clearClientId } from "@/lib/client-session";
import type { CheckIn, Client } from "@/lib/types";
import {
  getMyProgram,
  respondToSuggestedProgram,
  type ClientProgramState,
} from "@/lib/client-program.functions";
import { setYvesAiConsent } from "@/lib/yves-consent.functions";
import { deleteMyAccount } from "@/lib/account-delete.functions";

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
  const saveConsent = useServerFn(setYvesAiConsent);
  const [busy, setBusy] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineItems, setTimelineItems] = useState<CheckIn[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [openCheckInId, setOpenCheckInId] = useState<string | null>(null);

  const toggleAiConsent = async () => {
    if (!client || consentBusy) return;
    const next = !client.yves_ai_consent;
    setConsentBusy(true);
    const res = await saveConsent({ data: { clientId: client.id, consent: next } });
    setConsentBusy(false);
    if (res.ok) {
      setClient({
        ...client,
        yves_ai_consent: next,
        yves_ai_consent_at: next ? new Date().toISOString() : null,
      });
    }
  };

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
        <ProfileField label="Email" value={client?.email} />
        <ProfileField label="Phone" value={client?.phone || "Not set"} />
        <AiConsentRow
          on={client?.yves_ai_consent === true}
          busy={consentBusy}
          onToggle={toggleAiConsent}
        />
      </div>

      {programState?.program && programState.status !== "none" && (
        <MyProgramCard
          state={programState}
          busy={busy}
          onAccept={handleAccept}
          onDecline={handleDecline}
        />
      )}

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

function AiConsentRow({
  on,
  busy,
  onToggle,
}: {
  on: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
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
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
      >
        <div
          style={{
            color: "var(--white-muted)",
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          AI analysis (Yves)
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="AI analysis with Yves"
          onClick={onToggle}
          disabled={busy}
          style={{
            position: "relative",
            width: 46,
            height: 26,
            borderRadius: 999,
            background: on ? "var(--blue-accent)" : "var(--navy-border)",
            border: "none",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.6 : 1,
            transition: "background 0.2s",
          }}
        >
          <span
            style={{
              position: "absolute",
              top: 3,
              left: on ? 23 : 3,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "var(--white)",
              transition: "left 0.2s",
            }}
          />
        </button>
      </div>
      <div
        style={{
          marginTop: 8,
          color: "var(--white)",
          fontFamily: "var(--font-ui)",
          fontSize: 14,
        }}
      >
        {on ? "On" : "Off"}
      </div>
      <p
        style={{
          marginTop: 6,
          color: "var(--white-muted)",
          fontFamily: "var(--font-ui)",
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        When on, your symptom messages are sent to our AI provider (Anthropic) to power Yves, and
        your check-ins may also be processed by Google (via our platform provider Lovable) to suggest
        a suitable program. Turn off to stop all AI analysis.
      </p>
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
