import type { LucideIcon } from "lucide-react";
import { AlertCircle } from "lucide-react";

export function SkeletonCard({ height = 72 }: { height?: number }) {
  return <div className="skeleton" style={{ width: "100%", height }} />;
}

export function SkeletonList({ count = 4, height = 72 }: { count?: number; height?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} height={height} />
      ))}
    </div>
  );
}

export function ErrorCard({
  message = "Something went wrong. Please try again.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--red)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        textAlign: "center",
      }}
    >
      <AlertCircle color="var(--red)" size={28} />
      <p style={{ color: "var(--white)", fontFamily: "var(--font-ui)", fontSize: 14 }}>{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            minHeight: 44,
            padding: "8px 18px",
            background: "transparent",
            border: "1px solid var(--red)",
            color: "var(--red)",
            borderRadius: 8,
            fontFamily: "var(--font-ui)",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  Icon,
  title,
  subtitle,
}: {
  Icon: LucideIcon;
  title: string;
  subtitle?: string;
}) {
  return (
    <div
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 12,
        padding: "32px 20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        textAlign: "center",
      }}
    >
      <Icon size={36} color="var(--white-muted)" />
      <h3
        style={{
          fontFamily: "var(--font-hero)",
          fontWeight: 400,
          fontSize: 20,
          color: "var(--white)",
        }}
      >
        {title}
      </h3>
      {subtitle && (
        <p
          style={{
            color: "var(--white-muted)",
            fontSize: 13,
            fontFamily: "var(--font-ui)",
            maxWidth: 280,
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}
