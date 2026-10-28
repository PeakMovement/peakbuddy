/**
 * The Monday summary (28 Oct 2026). Each practitioner with patients on
 * Buddy gets one WhatsApp on Monday morning: who is improving, who is worth a
 * look (quiet trend signals), who is worth booking in (progress stalled),
 * who has gone quiet, and who is new. "my week" asks for it any time.
 *
 * Practitioner-facing, so names are used. Never sent to patients.
 */
import { log } from "@/lib/log";
import { claimOnce, releaseClaim } from "@/lib/job-claims.server";
import { toSast } from "./clinic-hours";
import { trendSignal, type TrendPoint } from "./trends";
import type { SendEnv } from "./practitioner-status.server";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (t: string) => any };

export const WEEKLY_SUMMARY_JOB = "weekly_summary";
export const WEEKLY_SUMMARY_BUTTON = "prac_weekly_summary";
const DAY = 86_400_000;
/** Monday 07:45 to 10:00 SAST. */
const START = 7 * 60 + 45;
const END = 10 * 60;

export interface WeekPatient {
  id: string;
  name: string;
  joinedAt: string | null;
  checkins: TrendPoint[];
  scheduledDays: number[] | null;
}

export interface WeekSummary {
  practitioner: string;
  total: number;
  improving: Array<{ name: string; from: number; to: number }>;
  signals: Array<{ name: string; text: string }>;
  stalled: Array<{ name: string; around: number; weeks: number }>;
  quiet: Array<{ name: string; days: number }>;
  fresh: string[];
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Pure. */
export function summariseWeek(
  practitioner: string,
  patients: WeekPatient[],
  now: Date,
): WeekSummary {
  const out: WeekSummary = {
    practitioner,
    total: patients.length,
    improving: [],
    signals: [],
    stalled: [],
    quiet: [],
    fresh: [],
  };
  for (const p of patients) {
    const asc = [...p.checkins].sort((a, b) => a.at.localeCompare(b.at));
    const pains = asc
      .filter((c) => c.pain != null && now.getTime() - new Date(c.at).getTime() <= 15 * DAY)
      .map((c) => ({ at: c.at, pain: c.pain as number }));
    const last = asc[asc.length - 1];
    const daysSince = last ? Math.floor((now.getTime() - new Date(last.at).getTime()) / DAY) : null;
    const isNew = p.joinedAt && now.getTime() - new Date(p.joinedAt).getTime() <= 7 * DAY;

    if (isNew) out.fresh.push(first(p.name));
    const signal = trendSignal(asc, now);
    if (signal) out.signals.push({ name: first(p.name), text: signal.text });

    const quietAfter = p.scheduledDays && p.scheduledDays.length <= 2 ? 8 : 4;
    if (!isNew && (daysSince === null || daysSince > quietAfter)) {
      out.quiet.push({ name: first(p.name), days: daysSince ?? -1 });
      continue;
    }
    if (pains.length >= 3) {
      const spanDays = (now.getTime() - new Date(pains[0].at).getTime()) / DAY;
      const from = pains[0].pain;
      const to = pains[pains.length - 1].pain;
      const max = Math.max(...pains.map((x) => x.pain));
      const min = Math.min(...pains.map((x) => x.pain));
      if (from - to >= 2) out.improving.push({ name: first(p.name), from, to });
      else if (!signal && spanDays >= 13 && max - min <= 1 && to >= 4) {
        out.stalled.push({
          name: first(p.name),
          around: Math.round(pains.reduce((n, x) => n + x.pain, 0) / pains.length),
          weeks: Math.round(spanDays / 7),
        });
      }
    }
  }
  return out;
}

export function formatWeekSummary(s: WeekSummary): string {
  const lines = [
    `Your Buddy week, ${s.practitioner} (${s.total} patient${s.total === 1 ? "" : "s"})`,
  ];
  const section = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push("", `${title} (${items.length}):`, ...items.slice(0, 8).map((i) => `• ${i}`));
    if (items.length > 8) lines.push(`• and ${items.length - 8} more`);
  };
  section(
    "Worth a look",
    s.signals.map((x) => `${x.name}: ${x.text}`),
  );
  section(
    "Worth booking in",
    s.stalled.map((x) => `${x.name}: pain stuck around ${x.around} for ${x.weeks} weeks`),
  );
  section(
    "Improving",
    s.improving.map((x) => `${x.name}: pain ${x.from} → ${x.to}`),
  );
  section(
    "Gone quiet",
    s.quiet.map((x) =>
      x.days < 0 ? `${x.name}: no check-ins yet` : `${x.name}: last check-in ${x.days} days ago`,
    ),
  );
  section("New this week", s.fresh);
  if (lines.length === 1) lines.push("", "Nothing needs you this week. Everyone's ticking along.");
  if (s.stalled.length) {
    lines.push("", `Reply "book ${s.stalled[0].name} in" and I'll ask reception.`);
  }
  return lines.join("\n");
}

export function shortWeekSummary(s: WeekSummary): string {
  const bits = [
    s.signals.length ? `${s.signals.length} worth a look` : null,
    s.stalled.length ? `${s.stalled.length} worth booking in` : null,
    s.improving.length ? `${s.improving.length} improving` : null,
    s.quiet.length ? `${s.quiet.length} gone quiet` : null,
  ].filter(Boolean);
  return bits.length ? bits.join(", ") : "nothing needs you this week";
}

export async function loadWeek(
  adminIn: Admin,
  practitionerId: string,
  now: Date,
): Promise<WeekPatient[]> {
  const admin = adminIn as unknown as Db;
  const { withoutArchived } = await import("@/lib/client-archive.server");
  const { data: clients } = (await withoutArchived((f) => {
    const q = admin
      .from("clients")
      .select("id, full_name, created_at, discharged_at")
      .eq("practitioner_id", practitionerId);
    return (f ? q.is("archived_at", null) : q).limit(500);
  })) as {
    data: Array<{
      id: string;
      full_name: string | null;
      created_at: string | null;
      discharged_at?: string | null;
    }> | null;
  };
  const active = (clients ?? []).filter((c) => !c.discharged_at);
  if (!active.length) return [];
  const ids = active.map((c) => c.id);
  const since = new Date(now.getTime() - 30 * DAY).toISOString();
  const [{ data: cis }, { data: rems }] = await Promise.all([
    admin
      .from("check_ins")
      .select("client_id, created_at, pain_level, sleep_quality, energy_level")
      .in("client_id", ids)
      .gte("created_at", since)
      .limit(5000),
    admin
      .from("checkin_reminders")
      .select("client_id, days_of_week, enabled")
      .in("client_id", ids)
      .limit(1000),
  ]);
  const byClient = new Map<string, TrendPoint[]>();
  for (const r of (cis ?? []) as Array<Record<string, any>>) {
    const list = byClient.get(r.client_id) ?? [];
    list.push({
      at: r.created_at,
      pain: r.pain_level ?? null,
      sleep: r.sleep_quality ?? null,
      energy: r.energy_level ?? null,
    });
    byClient.set(r.client_id, list);
  }
  const days = new Map<string, number[] | null>();
  for (const r of (rems ?? []) as Array<Record<string, any>>) {
    days.set(r.client_id, r.enabled && Array.isArray(r.days_of_week) ? r.days_of_week : null);
  }
  return active.map((c) => ({
    id: c.id,
    name: String(c.full_name ?? "").trim() || "A patient",
    joinedAt: c.created_at,
    checkins: byClient.get(c.id) ?? [],
    scheduledDays: days.get(c.id) ?? null,
  }));
}

export function weeklySummaryDue(now: Date): boolean {
  const m = toSast(now);
  return m.weekday === 1 && m.minuteOfDay >= START && m.minuteOfDay < END;
}

export async function buildWeekText(
  adminIn: Admin,
  practitionerId: string,
  now: Date,
): Promise<string> {
  const { practitionerContact } = await import("./practitioner-status.server");
  const name = (await practitionerContact(adminIn, practitionerId)).firstName || "there";
  return formatWeekSummary(summariseWeek(name, await loadWeek(adminIn, practitionerId, now), now));
}

/** Minute job. Monday mornings, once per practitioner. */
export async function runWeeklySummaries(adminIn: Admin, env: SendEnv, now: Date): Promise<void> {
  if (!weeklySummaryDue(now)) return;
  const admin = adminIn as unknown as Db;
  const date = toSast(now).date;
  const { data: owners } = await admin.from("clients").select("practitioner_id").limit(5000);
  const ids = [
    ...new Set(
      ((owners ?? []) as Array<{ practitioner_id: string | null }>)
        .map((r) => r.practitioner_id)
        .filter(Boolean) as string[],
    ),
  ];
  const { practitionerContact, sendLogged, windowOpen } =
    await import("./practitioner-status.server");
  for (const id of ids) {
    const contact = await practitionerContact(adminIn, id);
    if (!contact.phone) continue;
    if (!(await claimOnce(adminIn, WEEKLY_SUMMARY_JOB, id, date))) continue;
    const patients = await loadWeek(adminIn, id, now);
    if (!patients.length) continue;
    const summary = summariseWeek(contact.firstName || "there", patients, now);
    let ok = false;
    if (await windowOpen(adminIn, contact.phone, now)) {
      const body = formatWeekSummary(summary);
      ok = await sendLogged(
        adminIn,
        env,
        { kind: "text", to: contact.phone, body },
        "[weekly summary]",
      );
    } else {
      const template = process.env.WHATSAPP_WEEKLY_SUMMARY_TEMPLATE?.trim();
      if (!template) {
        log.warn("weekly summary skipped: window closed and no template", { id });
        continue;
      }
      ok = await sendLogged(
        adminIn,
        env,
        {
          kind: "template",
          to: contact.phone,
          templateName: template,
          languageCode: process.env.WHATSAPP_WEEKLY_SUMMARY_TEMPLATE_LANG?.trim() || "en",
          variables: [contact.firstName || "there", shortWeekSummary(summary)],
          buttonPayloads: [WEEKLY_SUMMARY_BUTTON],
        },
        `[weekly summary template ${template}]`,
      );
    }
    if (!ok) await releaseClaim(adminIn, WEEKLY_SUMMARY_JOB, id, date);
  }
}

export function isWeekAsk(text: string): boolean {
  return /\b(?:my|the)\s+week\b|\bweekly\s+summary\b|\bmonday\s+summary\b|\bweek\s+(?:summary|overview)\b/i.test(
    String(text ?? ""),
  );
}
