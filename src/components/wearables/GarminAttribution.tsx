import garminLogo from "@/assets/garmin-logo.webp.asset.json";

/**
 * Official Garmin logo, rendered on a white chip per Garmin's GCDP Brand
 * Guidelines (the wordmark + blue triangle must appear on a light background
 * with adequate clear space; no color inversion).
 *
 * Used wherever Garmin data appears in Buddy, to satisfy the branding /
 * attribution requirement for Garmin Health API production review.
 */
export function GarminAttribution({
  size = "sm",
  showPoweredBy = false,
}: {
  size?: "sm" | "md";
  showPoweredBy?: boolean;
}) {
  const height = size === "md" ? 22 : 14;
  const padY = size === "md" ? 6 : 4;
  const padX = size === "md" ? 10 : 7;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-ui)",
        fontSize: size === "md" ? 12 : 11,
        color: "var(--white-muted)",
      }}
    >
      {showPoweredBy && <span style={{ letterSpacing: "0.06em" }}>Powered by</span>}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          background: "#ffffff",
          borderRadius: 6,
          padding: `${padY}px ${padX}px`,
          lineHeight: 0,
        }}
      >
        <img
          src={garminLogo.url}
          alt="Garmin"
          height={height}
          style={{ height, width: "auto", display: "block" }}
        />
      </span>
    </span>
  );
}

export default GarminAttribution;
