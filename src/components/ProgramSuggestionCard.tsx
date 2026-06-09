import { ExternalLink, Sparkles } from "lucide-react";

type Props = {
  program: {
    id: string;
    name: string;
    description: string;
    external_url: string;
    image_url?: string | null;
  };
  reason: string;
  onDismiss?: () => void;
};

export function ProgramSuggestionCard({ program, reason, onDismiss }: Props) {
  return (
    <div
      style={{
        marginTop: 32,
        width: "100%",
        maxWidth: 420,
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 16,
        padding: 20,
        textAlign: "left",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "var(--blue-accent)",
          fontFamily: "var(--font-data)",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        <Sparkles size={14} />
        Recommended program
      </div>
      <h2
        style={{
          marginTop: 10,
          fontFamily: "var(--font-hero)",
          fontWeight: 400,
          fontSize: 20,
          color: "var(--white)",
        }}
      >
        {program.name}
      </h2>
      <p style={{ marginTop: 8, fontSize: 14, color: "var(--white-muted)", lineHeight: 1.4 }}>
        {program.description}
      </p>
      <p
        style={{
          marginTop: 12,
          fontSize: 12,
          color: "var(--white-muted)",
          fontStyle: "italic",
        }}
      >
        Why this? {reason}
      </p>
      <a
        href={program.external_url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          marginTop: 16,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          padding: "12px 16px",
          background: "var(--blue-accent)",
          color: "var(--navy)",
          borderRadius: 10,
          fontFamily: "var(--font-ui)",
          fontWeight: 600,
          fontSize: 15,
          textDecoration: "none",
        }}
      >
        Join program <ExternalLink size={16} />
      </a>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{
            marginTop: 10,
            width: "100%",
            background: "transparent",
            border: "none",
            color: "var(--white-muted)",
            fontFamily: "var(--font-ui)",
            fontSize: 13,
            cursor: "pointer",
            padding: 8,
          }}
        >
          Not now
        </button>
      )}
    </div>
  );
}
