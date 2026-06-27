import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { setClientId } from "@/lib/client-session";
import { BuddyLogo } from "@/components/CrosshairLogo";

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Signing you in — Buddy" }] }),
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("Signing you in…");

  useEffect(() => {
    let cancelled = false;

    const finish = async () => {
      // The Supabase JS client auto-parses the access token from the URL hash
      // (detectSessionInUrl is on by default) and persists the session.
      // We just need to wait briefly for it to settle, then resolve role.
      let attempt = 0;
      let userId: string | null = null;
      while (attempt < 20 && !cancelled) {
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          userId = data.user.id;
          break;
        }
        await new Promise((r) => setTimeout(r, 150));
        attempt++;
      }

      if (cancelled) return;
      if (!userId) {
        setMessage(
          "We couldn't finish signing you in. The link may have expired — please request a new one.",
        );
        return;
      }

      // Resolve role
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();

      const role = profile?.role ?? "client";

      if (role === "super_admin") {
        navigate({ to: "/admin/app/dashboard" });
        return;
      }

      if (role === "practitioner") {
        const { data: practice } = await supabase
          .from("practices")
          .select("onboarding_complete,is_approved")
          .eq("practitioner_id", userId)
          .maybeSingle();
        if (practice && practice.is_approved === false) {
          navigate({ to: "/practitioner/pending" });
          return;
        }
        if (practice?.onboarding_complete) {
          navigate({ to: "/practitioner/app/dashboard" });
        } else {
          navigate({ to: "/practitioner/onboarding" });
        }
        return;
      }

      // Client — resolve client row and stash id
      const { data: client } = await supabase
        .from("clients")
        .select("id")
        .eq("auth_user_id", userId)
        .maybeSingle();

      if (client) {
        setClientId(client.id);
        navigate({ to: "/client/app/checkin" });
      } else {
        setMessage(
          "Signed in, but no client record is linked to this email. Please contact your practitioner.",
        );
      }
    };

    void finish();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <main
      className="safe-area"
      style={{
        minHeight: "100vh",
        background: "var(--navy)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <BuddyLogo />
      <p
        style={{
          marginTop: 32,
          color: "var(--white)",
          fontFamily: "var(--font-ui)",
          fontSize: 15,
          maxWidth: 320,
          lineHeight: 1.5,
        }}
      >
        {message}
      </p>
    </main>
  );
}
