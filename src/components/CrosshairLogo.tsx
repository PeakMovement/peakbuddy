/**
 * Buddy logo mark — precision monitoring reticle.
 * Two concentric circles + four cardinal tick marks. No crosshair lines.
 *
 * Default size 40px (per design spec). Internals are scaled from a 40-unit
 * viewBox so passing a different `size` keeps proportions exact.
 */
export function CrosshairLogo({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Outer ring — thin stroke, 40px diameter (r=19.25 leaves room for stroke) */}
      <circle cx="20" cy="20" r="19.25" stroke="var(--blue-cold)" strokeWidth="1.5" />

      {/* Cardinal tick marks — 4px long, 1.5px stroke, just inside the ring */}
      {/* 12 o'clock */}
      <line x1="20" y1="3" x2="20" y2="7" stroke="var(--blue-cold)" strokeWidth="1.5" strokeLinecap="round" />
      {/* 3 o'clock */}
      <line x1="33" y1="20" x2="37" y2="20" stroke="var(--blue-cold)" strokeWidth="1.5" strokeLinecap="round" />
      {/* 6 o'clock */}
      <line x1="20" y1="33" x2="20" y2="37" stroke="var(--blue-cold)" strokeWidth="1.5" strokeLinecap="round" />
      {/* 9 o'clock */}
      <line x1="3" y1="20" x2="7" y2="20" stroke="var(--blue-cold)" strokeWidth="1.5" strokeLinecap="round" />

      {/* Inner dot — filled, 8px diameter (r=4) */}
      <circle cx="20" cy="20" r="4" fill="var(--blue-accent)" />
    </svg>
  );
}

/**
 * Full Buddy lockup: mark + wordmark + tagline.
 * Use anywhere the brand should appear as a centered block.
 */
export function BuddyLogo({ markSize = 40 }: { markSize?: number }) {
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
