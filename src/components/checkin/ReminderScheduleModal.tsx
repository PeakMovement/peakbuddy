import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import {
  getMyReminder,
  upsertMyReminder,
  disableMyReminder,
} from "@/lib/checkin-reminders.functions";
import { registerPushToken, registerWebPushToken } from "@/lib/push";
import { log } from "@/lib/log";

type Frequency = "daily" | "morning" | "evening" | "custom";
type Reminder = {
  enabled: boolean;
  frequency: Frequency;
  time_of_day: string;
  days_of_week: number[];
  timezone: string;
};

const DAYS = [
  { i: 1, l: "Mon" },
  { i: 2, l: "Tue" },
  { i: 3, l: "Wed" },
  { i: 4, l: "Thu" },
  { i: 5, l: "Fri" },
  { i: 6, l: "Sat" },
  { i: 0, l: "Sun" },
];

function localTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch { return "UTC"; }
}

export function ReminderScheduleModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (r: Reminder | null) => void;
}) {
  const [frequency, setFrequency] = useState<Frequency>("daily");
  const [time, setTime] = useState("08:00");
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [saving, setSaving] = useState(false);
  const [permMessage, setPermMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const r = await getMyReminder();
        if (r.reminder) {
          setFrequency((r.reminder.frequency as Frequency) ?? "daily");
          setTime(String(r.reminder.time_of_day).slice(0, 5));
          setDays(r.reminder.days_of_week ?? [0, 1, 2, 3, 4, 5, 6]);
        }
      } catch (e) { log.warn("load reminder", e); }
    })();
  }, [open]);

  if (!open) return null;

  const handleFrequency = (f: Frequency) => {
    setFrequency(f);
    if (f === "morning") setTime("08:00");
    if (f === "evening") setTime("19:00");
    if (f === "daily" && (time === "" )) setTime("08:00");
  };

  const toggleDay = (i: number) => {
    setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()));
  };

  const save = async () => {
    setSaving(true);
    setPermMessage(null);
    try {
      // Native (Despia) push permission + token.
      try { await registerPushToken(); } catch (e) { log.warn("push perm", e); }
      // Web / installed-PWA push — otherwise browser users set a reminder but
      // never get a notification. Safe here: this runs from the Save gesture.
      try { await registerWebPushToken(); } catch (e) { log.warn("web push perm", e); }

      const daysFinal = frequency === "custom" ? days : [0, 1, 2, 3, 4, 5, 6];
      const payload: Reminder = {
        enabled: true,
        frequency,
        time_of_day: time.length === 5 ? `${time}:00` : time,
        days_of_week: daysFinal,
        timezone: localTz(),
      };
      await upsertMyReminder({ data: payload });
      onSaved(payload);
      onClose();
    } catch (e) {
      log.error("save reminder", e);
      setPermMessage("Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const disable = async () => {
    setSaving(true);
    try {
      await disableMyReminder();
      onSaved(null);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0, background: "rgba(6,10,24,0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200, padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 440,
          background: "var(--void-navy, #0d1530)",
          border: "1px solid rgba(122,168,255,0.18)",
          borderRadius: 16, padding: 20, color: "var(--white)",
          fontFamily: "var(--font-data)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Bell size={18} color="var(--cold-blue, #7aa8ff)" />
            <h2 style={{ fontFamily: "var(--font-hero)", fontSize: 18, margin: 0 }}>
              Check-in reminders
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" style={btnIcon}>
            <X size={18} />
          </button>
        </div>

        <p style={{ fontSize: 12, color: "var(--white-muted)", marginTop: 8 }}>
          Get a gentle push when it's time to log your symptoms.
        </p>

        <div style={{ marginTop: 16 }}>
          <label style={label}>Frequency</label>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6, marginTop: 8 }}>
            {(["daily", "morning", "evening", "custom"] as Frequency[]).map((f) => (
              <button key={f} onClick={() => handleFrequency(f)} style={chip(frequency === f)}>
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={label}>Time</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            style={{
              marginTop: 8, width: "100%", padding: "10px 12px",
              background: "rgba(122,168,255,0.08)",
              border: "1px solid rgba(122,168,255,0.24)",
              borderRadius: 10, color: "var(--white)",
              fontFamily: "var(--font-data)", fontSize: 15,
            }}
          />
        </div>

        {frequency === "custom" && (
          <div style={{ marginTop: 16 }}>
            <label style={label}>Days</label>
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {DAYS.map((d) => (
                <button key={d.i} onClick={() => toggleDay(d.i)} style={chip(days.includes(d.i))}>
                  {d.l}
                </button>
              ))}
            </div>
          </div>
        )}

        {permMessage && (
          <p style={{ marginTop: 12, fontSize: 12, color: "var(--amber,#f9a825)" }}>
            {permMessage}
          </p>
        )}

        <div style={{ marginTop: 20, display: "flex", gap: 8, justifyContent: "space-between" }}>
          <button onClick={disable} disabled={saving} style={btnGhost}>
            Turn off
          </button>
          <button onClick={save} disabled={saving} style={btnPrimary}>
            {saving ? "Saving…" : "Save reminder"}
          </button>
        </div>
      </div>
    </div>
  );
}

const label: React.CSSProperties = {
  fontSize: 11, letterSpacing: 1, textTransform: "uppercase",
  color: "var(--white-muted)",
};
const btnIcon: React.CSSProperties = {
  background: "transparent", border: "none", color: "var(--white-muted)", cursor: "pointer",
};
const chip = (active: boolean): React.CSSProperties => ({
  padding: "8px 10px",
  background: active ? "var(--cold-blue, #7aa8ff)" : "rgba(122,168,255,0.08)",
  color: active ? "#001033" : "var(--white)",
  border: `1px solid ${active ? "var(--cold-blue, #7aa8ff)" : "rgba(122,168,255,0.24)"}`,
  borderRadius: 8, fontSize: 12, cursor: "pointer",
  fontFamily: "var(--font-data)",
});
const btnGhost: React.CSSProperties = {
  padding: "10px 14px", background: "transparent",
  border: "1px solid rgba(255,255,255,0.15)", borderRadius: 10,
  color: "var(--white-muted)", cursor: "pointer", fontFamily: "var(--font-data)",
};
const btnPrimary: React.CSSProperties = {
  padding: "10px 18px", background: "var(--cold-blue, #7aa8ff)",
  border: "none", borderRadius: 10, color: "#001033",
  cursor: "pointer", fontWeight: 600, fontFamily: "var(--font-data)",
};
