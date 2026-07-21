import type { CSSProperties } from "react";
import garminTag from "@/assets/garmin-tag-white.png.asset.json";

/**
 * Garmin brand attribution, required by the Garmin Health API GCDP Brand
 * Guidelines wherever we render Garmin-sourced data.
 *
 * - variant="text" (default): a small, muted "Garmin {model}" caption used
 *   directly beneath or beside the title of any screen showing Garmin data.
 * - variant="logo": the official white Garmin tag image followed by the
 *   device model — used ONLY on the Garmin dashboard/connect card header.
 *
 * When no device model is known, we render just "Garmin".
 * The logo asset must NEVER be recoloured, stretched, cropped, rotated or
 * animated; the natural aspect ratio is preserved by `width: auto`.
 */
export function GarminAttribution({
  deviceModel,
  variant = "text",
  size = "sm",
}: {
  deviceModel?: string | null;
  variant?: "text" | "logo";
  size?: "sm" | "md";
}) {
  const label = deviceModel ? `Garmin ${deviceModel}` : "Garmin";
  const fontSize = size === "md" ? 12.5 : 11.5;

  if (variant === "logo") {
    const logoHeight = size === "md" ? 20 : 16;
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-ui)",
          fontSize,
          color: "var(--white-muted)",
        }}
      >
        <img
          src={garminTag.url}
          alt="Garmin"
          height={logoHeight}
          style={{ height: logoHeight, width: "auto", display: "block" }}
        />
        {deviceModel && <span style={{ color: "var(--white)" }}>{deviceModel}</span>}
      </span>
    );
  }

  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: "var(--font-ui)",
        fontSize,
        color: "var(--white-muted)",
        letterSpacing: "0.02em",
      }}
    >
      {label}
    </span>
  );
}

/**
 * Required Yves caption anywhere Garmin-sourced data is used as an input to
 * the Yves assistant. Wording is fixed by Garmin's brand guidelines — do not
 * change it, and do not imply Garmin built, endorses or approves Yves.
 */
export function YvesGarminCaption({ style }: { style?: CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: 11.5,
        lineHeight: 1.4,
        color: "var(--white-muted)",
        opacity: 0.9,
        ...style,
      }}
    >
      Insights derived in part from Garmin device-sourced data.
    </div>
  );
}

export default GarminAttribution;
