import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BuddyLogo } from "@/components/CrosshairLogo";

export const Route = createFileRoute("/practitioner/pending")({
  head: () => ({ meta: [{ title: "Pending Approval — Buddy" }] }),
  component: PendingApproval,
});

function PendingApproval() {
  const navigate = useNavigate();
  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/practitioner/login" });
  };

  return (
    <main
      className="safe-area"
      style={{
        minHeight: "100vh",
        background: "var(--navy)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "64px 24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <BuddyLogo />
        <div
          style={{
            marginTop: 40,
            width: 80,
            height: 80,
            borderRadius: "50%",
            border: "2px solid var(--amber)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Clock size={36} color="var(--amber)" />
        </div>

        <h1
          style={{
            fontFamily: "var(--font-hero)",
            fontWeight: 400,
            fontSize: 28,
            color: "var(--white)",
            marginTop: 28,
            lineHeight: 1.2,
          }}
        >
          Your account is pending approval
        </h1>
        <p style={{ marginTop: 16, color: "var(--white-muted)", fontSize: 15, lineHeight: 1.55 }}>
          Your registration has been received. You will receive an email once your account has been
          approved by the Buddy team.
        </p>

        <button
          type="button"
          onClick={signOut}
          style={{
            marginTop: 40,
            minHeight: 48,
            width: "100%",
            background: "transparent",
            color: "var(--white)",
            border: "1px solid var(--navy-border)",
            borderRadius: 8,
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
