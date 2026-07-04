import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { CalendarPlus, Copy, Check } from "lucide-react";
import { getCalendarFeedUrl } from "@/lib/calendar-feed.functions";

/** Lets a client subscribe their calendar to their rehab reminders (one-way iCal feed). */
export function CalendarFeedCard() {
  const [feed, setFeed] = useState<{ url: string; webcal: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getCalendarFeedUrl()
      .then((r) => setFeed(r))
      .catch(() => {});
  }, []);

  if (!feed) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(feed.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <CalendarPlus size={18} color="var(--blue-accent)" aria-hidden />
        <span style={title}>Rehab reminders in your calendar</span>
      </div>
      <p style={body}>
        Add your rehab reminders to your phone's calendar. It stays in sync and reminds you natively,
        no need to open Buddy.
      </p>
      <a href={feed.webcal} style={primaryBtn}>
        <CalendarPlus size={16} /> Add to my calendar
      </a>
      <button type="button" onClick={copy} style={copyBtn} aria-label="Copy calendar link">
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy link instead"}
      </button>
      <p style={hint}>
        On iPhone the button subscribes in Apple Calendar. For Google Calendar, copy the link and add
        it under Other calendars, From URL.
      </p>
    </div>
  );
}

const card: CSSProperties = {
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 14,
  padding: 16,
};
const title: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 700,
  color: "var(--white)",
  fontSize: 15,
};
const body: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 13.5,
  lineHeight: 1.5,
  color: "var(--white-muted)",
  margin: "8px 0 14px",
};
const primaryBtn: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 46,
  width: "100%",
  background: "var(--blue-accent)",
  color: "var(--white)",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 15,
  textDecoration: "none",
};
const copyBtn: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 40,
  width: "100%",
  marginTop: 8,
  background: "transparent",
  color: "var(--white-muted)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};
const hint: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  lineHeight: 1.5,
  color: "var(--white-muted)",
  marginTop: 12,
  opacity: 0.85,
};
