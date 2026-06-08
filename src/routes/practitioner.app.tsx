import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LayoutGrid, Bell, UserPlus, Settings as SettingsIcon, User } from "lucide-react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/practitioner/app")({
  component: PractitionerAppLayout,
});

type Tab = { to: string; label: string; Icon: typeof LayoutGrid; badge?: boolean };
const tabs: Tab[] = [
  { to: "/practitioner/app/dashboard", label: "Dashboard", Icon: LayoutGrid },
  { to: "/practitioner/app/alerts", label: "Alerts", Icon: Bell, badge: true },
  { to: "/practitioner/app/add-client", label: "Add", Icon: UserPlus },
  { to: "/practitioner/app/settings", label: "Settings", Icon: SettingsIcon },
  { to: "/practitioner/app/profile", label: "Profile", Icon: User },
];

function PractitionerAppLayout() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!data.user) {
          navigate({ to: "/practitioner/login" });
          return;
        }
        const { data: prof } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", data.user.id)
          .maybeSingle();
        if (!prof || prof.role !== "practitioner") {
          await supabase.auth.signOut();
          navigate({ to: "/practitioner/login" });
          return;
        }
        const { data: practice } = await supabase
          .from("practices")
          .select("is_approved")
          .eq("practitioner_id", data.user.id)
          .maybeSingle();
        if (practice && practice.is_approved === false) {
          navigate({ to: "/practitioner/pending" });
          return;
        }
        setUserId(data.user.id);
      } catch {
        navigate({ to: "/practitioner/login" });
      }
    })();
  }, [navigate]);

  useEffect(() => {
    if (!userId) return;
    const fetchUnread = async () => {
      const { count } = await supabase
        .from("alerts")
        .select("*", { count: "exact", head: true })
        .eq("practitioner_id", userId)
        .eq("is_read", false);
      setUnread(count ?? 0);
    };
    fetchUnread();
    const id = setInterval(fetchUnread, 30000);
    return () => clearInterval(id);
  }, [userId]);

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
        {tabs.map(({ to, label, Icon, badge }) => (
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
              position: "relative",
            }}
            activeProps={{ style: { color: "var(--blue-accent)" } }}
          >
            <div style={{ position: "relative" }}>
              <Icon size={22} />
              {badge && unread > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -10,
                    background: "var(--red)",
                    color: "var(--white)",
                    fontFamily: "var(--font-data)",
                    fontSize: 10,
                    fontWeight: 700,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    padding: "0 4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    lineHeight: 1,
                  }}
                >
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </div>
            <span style={{ fontSize: 11, fontFamily: "var(--font-ui)", fontWeight: 600 }}>
              {label}
            </span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
