import { createFileRoute, Link } from "@tanstack/react-router";
import { BuddyLogo } from "@/components/CrosshairLogo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Buddy — Your health. Monitored daily." },
      {
        name: "description",
        content:
          "Buddy is a clinical health monitoring companion connecting clients and practitioners with daily check-ins.",
      },
      { property: "og:title", content: "Buddy — Your health. Monitored daily." },
      {
        property: "og:description",
        content: "Daily clinical health monitoring for clients and practitioners.",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
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
        padding: "32px 24px",
      }}
    >
      {/* TEMP ADMIN ACCESS — remove this entire block (Link + comments) to disable the admin shortcut on the homepage. Added so the admin portal is reachable from the iOS app until a permanent entry point exists. */}
      <Link
        to="/admin/login"
        aria-label="Admin login"
        style={{
          position: "fixed",
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          right: 16,
          zIndex: 50,
          padding: "8px 14px",
          borderRadius: 999,
          background: "var(--navy-card)",
          color: "var(--white-muted)",
          border: "1px solid var(--navy-border)",
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: 13,
          letterSpacing: "0.04em",
          textDecoration: "none",
        }}
      >
        Admin
      </Link>
      {/* END TEMP ADMIN ACCESS */}

      <div
        style={{
          width: "100%",
          maxWidth: 360,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <BuddyLogo />

        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 56,
          }}
        >
          <Link
            to="/client/login"
            style={{
              minHeight: 48,
              width: "100%",
              borderRadius: 8,
              background: "var(--blue-accent)",
              color: "var(--white)",
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 16,
              letterSpacing: "0.02em",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textDecoration: "none",
              border: "1px solid var(--blue-accent)",
            }}
          >
            I am a client
          </Link>

          <Link
            to="/practitioner/login"
            style={{
              minHeight: 48,
              width: "100%",
              borderRadius: 8,
              background: "transparent",
              color: "var(--white)",
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              fontSize: 16,
              letterSpacing: "0.02em",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              textDecoration: "none",
              border: "1px solid var(--navy-border)",
            }}
          >
            I am a practitioner
          </Link>
        </div>
      </div>
    </main>
  );
}
