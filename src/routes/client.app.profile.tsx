import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LogOut, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { getClientId, clearClientId } from "@/lib/client-session";
import type { Client } from "@/lib/types";
import {
  getMyProgram,
  respondToSuggestedProgram,
  type ClientProgramState,
} from "@/lib/client-program.functions";
import { setYvesAiConsent } from "@/lib/yves-consent.functions";


export const Route = createFileRoute("/client/app/profile")({
  head: () => ({ meta: [{ title: "Profile — Buddy" }] }),
  component: ClientProfile,
});


function ClientProfile() {
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [programState, setProgramState] = useState<ClientProgramState | null>(null);
  const loadProgram = useServerFn(getMyProgram);
  const respond = useServerFn(respondToSuggestedProgram);
  const [busy, setBusy] = useState(false);

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

  const signOut = async () => {
    await supabase.auth.signOut();
    clearClientId();
    navigate({ to: "/client/login" });
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

