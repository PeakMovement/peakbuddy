import type { CSSProperties } from "react";
import {
  Flame,
  Heart,
  HeartPulse,
  Activity,
  Droplet,
  Moon,
  BatteryCharging,
  Footprints,
  Dumbbell,
  Map as MapIcon,
  Gauge,
  Watch,
} from "lucide-react";
import {
  metricsForProvider,
  readMetric,
  PROVIDER_LABEL,
  type MetricDef,
  type WearableProvider,
} from "@/lib/wearables/metric-registry";
import type { WearableSnapshot } from "@/lib/wearables/snapshot.functions";

// Dynamic wearable tile section for the client Progress page. Renders exactly the
// metrics the connected provider supplies (driven by the capability registry).
// No wearable connected → a subtle connect prompt (no blank/broken tiles).

const ICONS: Record<string, typeof Flame> = {
  flame: Flame,
  heart: Heart,
  "heart-pulse": HeartPulse,
  activity: Activity,
  droplet: Droplet,
  moon: Moon,
  "battery-charging": BatteryCharging,
  footprints: Footprints,
  dumbbell: Dumbbell,
  map: MapIcon,
  gauge: Gauge,
};

export function WearableTiles({ snapshot }: { snapshot: WearableSnapshot | null }) {
  // Still loading — render nothing (page shows its own loading).
  if (snapshot === null) return null;

  if (!snapshot.connected || !snapshot.provider) {
    return (
      <div style={{ marginTop: 24 }}>
        <div style={sectionLabel}>Wearable</div>
        <div style={connectCard}>
          <Watch size={18} color="var(--blue-accent)" aria-hidden />
          <div>
            <div style={{ color: "var(--white)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 600 }}>
              Connect a wearable
            </div>
            <div style={{ color: "var(--white-muted)", fontFamily: "var(--font-ui)", fontSize: 12.5, marginTop: 2 }}>
              Link your Oura, Garmin or Polar in Profile to see your body metrics here.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const provider = snapshot.provider as WearableProvider;
  const defs = metricsForProvider(provider);
  if (defs.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={sectionLabel}>{PROVIDER_LABEL[provider]} · your metrics</div>
      {snapshot.date && (
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 11.5,
            color: "var(--white-muted)",
            marginTop: -6,
            marginBottom: 12,
          }}
        >
          Latest reading: {formatReadingDate(snapshot.date)}
        </div>
      )}
      <div style={grid}>
        {defs.map((def) => (
          <Tile key={def.key} def={def} value={readMetric(def, snapshot.session)} />
        ))}
      </div>
    </div>
  );
}

function Tile({ def, value }: { def: MetricDef; value: string | null }) {
  const Icon = ICONS[def.icon] ?? Activity;
  const has = value !== null;
  return (
    <div style={tile}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Icon size={15} color={has ? "var(--blue-accent)" : "var(--white-muted)"} aria-hidden />
        <span style={tileLabel}>{def.label}</span>
      </div>
      {has ? (
        <div style={{ marginTop: 8 }}>
          <span style={tileValue}>{value}</span>
          {def.unit && <span style={tileUnit}> {def.unit}</span>}
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <span style={{ ...tileValue, color: "var(--white-muted)", fontSize: 18 }}>—</span>
          <span style={tileUnit}> no data yet</span>
        </div>
      )}
    </div>
  );
}

const sectionLabel: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--white-muted)",
  marginBottom: 12,
};
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const tile: CSSProperties = {
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 14,
  padding: "14px 16px",
};
const tileLabel: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  color: "var(--white-muted)",
  fontWeight: 600,
};
const tileValue: CSSProperties = {
  fontFamily: "var(--font-data)",
  fontSize: 24,
  fontWeight: 700,
  color: "var(--white)",
};
const tileUnit: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  color: "var(--white-muted)",
};
const connectCard: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  background: "rgba(74,141,240,0.08)",
  border: "1px dashed var(--navy-border)",
  borderRadius: 14,
  padding: "14px 16px",
};

function formatReadingDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const days = Math.floor((today.setHours(0, 0, 0, 0) - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default WearableTiles;
