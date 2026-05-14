import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/practitioner/app")({
  component: PractitionerAppLayout,
});

function PractitionerAppLayout() {
  const navigate = useNavigate();
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) navigate({ to: "/practitioner/login" });
    })();
  }, [navigate]);

  return (
    <div className="safe-area" style={{ minHeight: "100vh", background: "var(--navy)" }}>
      <Outlet />
    </div>
  );
}
