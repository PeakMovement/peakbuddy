import { describe, it, expect } from "vitest";
import { buildRehabIcs } from "./calendar-feed";

describe("buildRehabIcs", () => {
  const base = "https://buddytracker.netlify.app";

  it("emits a valid recurring event with alarm from a weekly schedule", () => {
    const ics = buildRehabIcs({
      clientId: "c1",
      appBase: base,
      reminder: { enabled: true, frequency: "custom", time_of_day: "18:00", days_of_week: [1, 3, 5], timezone: "Africa/Johannesburg" },
    });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR");
    expect(ics).toContain("DTSTART;TZID=Africa/Johannesburg:");
    expect(ics).toContain("TRIGGER:-PT10M");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics.endsWith("\r\n")).toBe(true); // CRLF
  });

  it("uses FREQ=DAILY when all 7 days are selected", () => {
    const ics = buildRehabIcs({
      clientId: "c1",
      appBase: base,
      reminder: { enabled: true, frequency: "daily", time_of_day: "08:00", days_of_week: [0, 1, 2, 3, 4, 5, 6], timezone: "UTC" },
    });
    expect(ics).toContain("RRULE:FREQ=DAILY");
  });

  it("returns a valid empty calendar when there is no enabled reminder", () => {
    const ics = buildRehabIcs({ clientId: "c1", appBase: base, reminder: null });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
