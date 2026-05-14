import { createFileRoute, Link } from "@tanstack/react-router";

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

function CrosshairLogo() {
  return (
    <svg
      width="72"
      height="72"
      viewBox="0 0 72 72"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="36" cy="36" r="30" stroke="var(--blue-cold)" strokeWidth="1.5" />
      <circle cx="36" cy="36" r="18" stroke="var(--blue-cold)" strokeWidth="1" opacity="0.6" />
      <circle cx="36" cy="36" r="2.5" fill="var(--blue-cold)" />
      <line x1="36" y1="0" x2="36" y2="14" stroke="var(--blue-cold)" strokeWidth="1.5" />
      <line x1="36" y1="58" x2="36" y2="72" stroke="var(--blue-cold)" strokeWidth="1.5" />
      <line x1="0" y1="36" x2="14" y2="36" stroke="var(--blue-cold)" strokeWidth="1.5" />
      <line x1="58" y1="36" x2="72" y2="36" stroke="var(--blue-cold)" strokeWidth="1.5" />
    </svg>
  );
}

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
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <CrosshairLogo />

        <h1
          style={{
            fontFamily: "var(--font-hero)",
            fontWeight: 400,
            fontSize: 64,
            lineHeight: 1,
            color: "var(--white)",
            marginTop: 28,
            letterSpacing: "-0.01em",
          }}
        >
          Buddy
        </h1>

        <p
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 400,
            fontSize: 16,
            color: "var(--white-muted)",
            marginTop: 12,
            letterSpacing: "0.02em",
            textAlign: "center",
          }}
        >
          Your health. Monitored daily.
        </p>

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
