import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList, List, Activity, MessageCircle, User } from "lucide-react";
import { getClientId } from "@/lib/client-session";
import { useOnline } from "@/hooks/use-online";
import {
  getClientBootstrap,
  type ClientProgramState,
} from "@/lib/client-program.functions";
import { ProgramIntroModal } from "@/components/ProgramIntroModal";

export const Route = createFileRoute("/client/app")({
  component: ClientAppLayout,
});


const tabs = [
  { to: "/client/app/checkin", label: "Check-in", Icon: ClipboardList },
  { to: "/client/app/timeline", label: "Timeline", Icon: List },
  { to: "/client/app/progress", label: "Progress", Icon: Activity },
  { to: "/client/app/yves", label: "Yves", Icon: MessageCircle },
  { to: "/client/app/profile", label: "Profile", Icon: User },
] as const;

function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      style={{
        background: "var(--amber, #f9a825)",
        color: "#0f1419",
        textAlign: "center",
        padding: "6px 12px",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      Offline — your check-ins will sync when you reconnect.
    </div>
  );
}

function shouldShowIntro(state: ClientProgramState | null) {
  if (!state || !state.program || state.status !== "pending") return false;
  if (!state.snoozed_until) return true;
  return new Date(state.snoozed_until).getTime() <= Date.now();
}

function ClientAppLayout() {
  const navigate = useNavigate();
  const bootstrap = useServerFn(getClientBootstrap);
  const [programState, setProgramState] = useState<ClientProgramState | null>(null);
  const [introOpen, setIntroOpen] = useState(false);
  const [clientName, setClientName] = useState<string | null>(null);

  useEffect(() => {
    if (!getClientId()) {
      navigate({ to: "/client/login" });
      return;
    }
    let cancelled = false;
    bootstrap()
      .then((res) => {
        if (cancelled) return;
        setProgramState(res);
        if (shouldShowIntro(res)) setIntroOpen(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [navigate, bootstrap]);

  useEffect(() => {
    const id = getClientId();
    if (!id) return;
    let cancelled = false;
    import("@/lib/supabase").then(({ supabase }) =>
      supabase
        .from("clients")
        .select("full_name")
        .eq("id", id)
        .maybeSingle()
        .then(({ data }) => {
          if (cancelled) return;
          const full = (data as { full_name?: string } | null)?.full_name ?? "";
          setClientName(full.trim().split(/\s+/)[0] || null);
        }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const handleClose = useCallback(() => {
    setIntroOpen(false);
    // Refresh state so the snooze/decision is reflected.
    bootstrap()
      .then((res) => setProgramState(res))
      .catch(() => {});
  }, [bootstrap]);

  const reopenIntro = () => {
    if (programState?.program && programState.status === "pending") setIntroOpen(true);
  };

  const pendingBannerVisible =
    !introOpen &&
    programState?.program &&
    programState.status === "pending" &&
    programState.snoozed_until &&
    new Date(programState.snoozed_until).getTime() > Date.now();

  return (
    <div
      className="safe-area"
      style={{
        minHeight: "100vh",
        background: "var(--navy)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <OfflineBanner />

      {pendingBannerVisible && programState?.program && (
        <button
          type="button"
          onClick={reopenIntro}
          style={{
            margin: "10px 12px 0",
            background: "color-mix(in oklab, var(--blue-accent) 14%, transparent)",
            border: "1px solid color-mix(in oklab, var(--blue-accent) 45%, transparent)",
            borderRadius: 10,
            padding: "10px 12px",
            color: "var(--white)",
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            textAlign: "left",
            cursor: "pointer",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span>
            <strong>{programState.program.name}</strong> is waiting — take another look when you're ready.
          </span>
          <span style={{ color: "var(--blue-accent)", fontWeight: 700, fontSize: 12 }}>View</span>
        </button>
      )}

      <main style={{ flex: 1, paddingBottom: 80, overflowX: "hidden" }}>
        <Outlet />
      </main>

      <nav
        aria-label="Primary"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          background: "var(--navy-card)",
          borderTop: "1px solid var(--navy-border)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
          display: "flex",
          zIndex: 50,
        }}
      >
        {tabs.map(({ to, label, Icon }) => (
          <Link
            key={to}
            to={to}
            style={{
              flex: 1,
              minHeight: 56,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              textDecoration: "none",
              color: "var(--white-muted)",
              padding: "8px 4px",
            }}
            activeProps={{
              style: {
                flex: 1,
                minHeight: 56,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                textDecoration: "none",
                color: "var(--blue-accent)",
                padding: "8px 4px",
              },
            }}
          >
            <Icon size={22} />
            <span style={{ fontSize: 11, fontFamily: "var(--font-ui)", fontWeight: 600 }}>
              {label}
            </span>
          </Link>
        ))}
      </nav>

      {introOpen && programState?.program && (
        <ProgramIntroModal
          program={programState.program}
          personalNote={programState.personal_note}
          clientFirstName={clientName}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
