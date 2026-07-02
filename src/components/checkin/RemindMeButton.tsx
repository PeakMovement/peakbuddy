import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { getMyReminder } from "@/lib/checkin-reminders.functions";
import { ReminderScheduleModal } from "./ReminderScheduleModal";

type Reminder = {
  enabled: boolean;
  frequency: string;
  time_of_day: string;
  days_of_week: number[];
} | null;

function summarize(r: Reminder): string {
  if (!r || !r.enabled) return "Off";
  const t = String(r.time_of_day).slice(0, 5);
  if (r.frequency === "daily") return `Daily · ${t}`;
  if (r.frequency === "morning") return `Mornings · ${t}`;
  if (r.frequency === "evening") return `Evenings · ${t}`;
  const count = r.days_of_week?.length ?? 0;
  return `${count} day${count === 1 ? "" : "s"} · ${t}`;
}

export function RemindMeButton() {
  const [open, setOpen] = useState(false);
  const [reminder, setReminder] = useState<Reminder>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await getMyReminder();
        setReminder((r.reminder as Reminder) ?? null);
      } catch { /* ignore */ }
    })();
  }, []);

  const summary = summarize(reminder);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Set check-in reminder"
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 12px",
          background: "rgba(122,168,255,0.08)",
          border: "1px solid rgba(122,168,255,0.24)",
          borderRadius: 10,
          color: "var(--white)",
          fontFamily: "var(--font-data)",
          fontSize: 12,
          cursor: "pointer",
          lineHeight: 1.2,
          textAlign: "left",
        }}
      >
        <Bell size={14} color="var(--cold-blue, #7aa8ff)" />
        <span style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: 11, color: "var(--white-muted)", letterSpacing: 0.5 }}>
            Remind me
          </span>
          <span style={{ fontSize: 12 }}>{summary}</span>
        </span>
      </button>
      <ReminderScheduleModal
        open={open}
        onClose={() => setOpen(false)}
        onSaved={(r) => setReminder(r as Reminder)}
      />
    </>
  );
}
