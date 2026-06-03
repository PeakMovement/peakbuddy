import buddyIcon from "@/assets/buddy-icon.png.asset.json";

/**
 * Buddy logo mark — the official "B" app icon.
 * Renders the brand image. Default 40px to match prior reticle sizing.
 */
export function CrosshairLogo({ size = 40 }: { size?: number }) {
  return (
    <img
      src={buddyIcon.url}
      alt="Buddy"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.22),
        display: "block",
      }}
    />
  );
}

/**
 * Full Buddy lockup: mark + wordmark + tagline.
 */
export function BuddyLogo({ markSize = 64 }: { markSize?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <CrosshairLogo size={markSize} />
      <div
        style={{
          marginTop: 16,
          fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontWeight: 600,
          fontSize: 32,
          lineHeight: 1,
          color: "var(--white)",
          letterSpacing: "0.05em",
        }}
      >
        Buddy
      </div>
      <div
        style={{
          marginTop: 10,
          fontFamily: "'Rajdhani', sans-serif",
          fontWeight: 400,
          fontSize: 13,
          color: "var(--white-muted)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        Health monitored daily.
      </div>
    </div>
  );
}
