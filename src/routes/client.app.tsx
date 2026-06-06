import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ClipboardList, List, Activity, MessageCircle, User } from "lucide-react";
import { getClientId } from "@/lib/client-session";

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

function ClientAppLayout() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!getClientId()) navigate({ to: "/client/login" });
  }, [navigate]);

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
            <span style={{ fontSize: 11, fontFamily: "var(--font-ui)", fontWeight: 600 }}>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
