import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity, Users, User, Bell, Settings as SettingsIcon, Sparkles, ClipboardCheck, Database, GraduationCap } from "lucide-react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/admin/app")({
  component: AdminAppLayout,
});

type Tab = { to: string; label: string; Icon: typeof Activity };
const tabs: Tab[] = [
  { to: "/admin/app/dashboard", label: "Dashboard", Icon: Activity },
  { to: "/admin/app/practitioners", label: "Practitioners", Icon: Users },
  { to: "/admin/app/clients", label: "Clients", Icon: User },
  { to: "/admin/app/data-hub", label: "Data Hub", Icon: Database },
  { to: "/admin/app/yves-teach", label: "Teach Yves", Icon: GraduationCap },
  { to: "/admin/app/programs", label: "Programs", Icon: Sparkles },
  { to: "/admin/app/alerts", label: "Alerts", Icon: Bell },
  { to: "/admin/app/grading", label: "Grading", Icon: ClipboardCheck },
  { to: "/admin/app/settings", label: "Settings", Icon: SettingsIcon },
];

function AdminAppLayout() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        navigate({ to: "/admin/login" });
        return;
      }
      const { data: prof } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();
      if (!prof || prof.role !== "super_admin") {
        await supabase.auth.signOut();
        navigate({ to: "/admin/login" });
        return;
      }
      setReady(true);
    })();
  }, [navigate]);

  if (!ready) {
    return (
      <div
        className="safe-area"
        style={{
          minHeight: "100vh",
          background: "var(--navy)",
          padding: 24,
          color: "var(--white-muted)",
        }}
      >
        Loading…
      </div>
    );
  }

  return (
    <div
      className="safe-area app-frame app-frame--wide"
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
        className="app-nav app-nav--wide"
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
            activeProps={{ style: { color: "var(--blue-accent)" } }}
          >
            <Icon size={22} />
            <span style={{ fontSize: 11, fontFamily: "var(--font-ui)", fontWeight: 600 }}>
              {label}
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
