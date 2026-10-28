/**
 * The daily Buddy report (28 Oct 2026, Justin: "I don't even know if the
 * check-ins are happening").
 *
 * Every evening at 19:30 SAST, each super admin gets one WhatsApp: check-ins
 * due, sent, failed and answered, what was saved, red flags, messages Buddy
 * could not handle, AI calls and failures, and any job that has stopped.
 * Counts only, never a patient's name or words.
 *
 * Inside the 24 hour window it's a plain message. Outside it, the
 * buddy_daily_report template (WHATSAPP_DAILY_REPORT_TEMPLATE) with a
 * "Show report" button; tapping it sends the full report.
 * "buddy report" on WhatsApp asks for it any time.
 */
import { log } from "@/lib/log";
import { claimOnce, releaseClaim } from "@/lib/job-claims.server";
import { toSast } from "./clinic-hours";
import type { SendEnv } from "./practitioner-status.server";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (t: string) => any };

export const DAILY_REPORT_JOB = "daily_report";
export const DAILY_REPORT_BUTTON = "prac_daily_report";
/** 19:30 SAST: after the 18:00 reminders have had time to be answered. */
export const DAILY_REPORT_MINUTE = 19 * 60 + 30;
const SEND_UNTIL_MINUTE = 22 * 60;

export interface DailyReport {
  date: string;
  due: number;
  sent: number;
  failed: number;
  windowClosed: number;
  replied: number;
  saved: number;
  savedWhatsApp: number;
  redFlags: number;
  redFlagsUnread: number;
  inbound: number;
  inboundFailed: number;
  aiCalls: number;
  aiFailed: number;
  problems: Array<{ label: string; problem: string }>;
}

function sastStart(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - 2 * 3600_000).toISOString();
}

/** Sums "calls=N failed=M" across the AI usage heartbeats. */
export function sumAiUsage(details: Array<string | null | undefined>): {
  calls: number;
  failed: number;
} {
  let calls = 0;
  let failed = 0;
  for (const d of details) {
    for (const m of String(d ?? "").matchAll(/calls=(\d+)\s+failed=(\d+)/g)) {
      calls += Number(m[1]);
      failed += Number(m[2]);
    }
  }
  return { calls, failed };
}

export async function buildDailyReport(adminIn: Admin, now: Date): Promise<DailyReport> {
  const admin = adminIn as unknown as Db;
  const date = toSast(now).date;
  const since = sastStart(date);
  const { loadDeliverySummary } = await import("./checkin-delivery.server");
  const { runJobHealthCheck } = await import("@/lib/job-runs.server");

  const [delivery, ins, alerts, inbound, ai, health] = await Promise.all([
    loadDeliverySummary(adminIn, now).catch(() => null),
    admin.from("check_ins").select("source").gte("created_at", since).limit(5000),
    admin
      .from("alerts")
      .select("is_read")
      .eq("alert_type", "red_flag")
      .gte("created_at", since)
      .limit(500),
    admin.from("whatsapp_inbound").select("status").gte("received_at", since).limit(5000),
    admin
      .from("job_runs")
      .select("detail")
      .eq("job", "whatsapp-ai-usage")
      .gte("ran_at", since)
      .limit(2000),
    runJobHealthCheck(adminIn, now, { email: false, prune: false }).catch(() => null),
  ]);
  const checkins = (ins.data ?? []) as Array<{ source?: string | null }>;
  const flags = (alerts.data ?? []) as Array<{ is_read?: boolean | null }>;
  const inRows = (inbound.data ?? []) as Array<{ status?: string | null }>;
  const usage = sumAiUsage(
    ((ai.data ?? []) as Array<{ detail?: string | null }>).map((r) => r.detail),
  );
  return {
    date,
    due: delivery?.due ?? 0,
    sent: delivery?.sent ?? 0,
    failed: delivery?.failed ?? 0,
    windowClosed: delivery?.windowClosed ?? 0,
    replied: delivery?.replied ?? 0,
    saved: checkins.length,
    savedWhatsApp: checkins.filter((c) => c.source === "whatsapp").length,
    redFlags: flags.length,
    redFlagsUnread: flags.filter((f) => !f.is_read).length,
    inbound: inRows.length,
    inboundFailed: inRows.filter((r) => r.status === "failed").length,
    aiCalls: usage.calls,
    aiFailed: usage.failed,
    problems: (health?.problems ?? []).map((p) => ({ label: p.label, problem: p.problem })),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function formatDailyReport(r: DailyReport): string {
  const day = new Date(`${r.date}T12:00:00Z`).toLocaleDateString("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const healthy = !r.problems.length && !r.failed && !r.inboundFailed && !r.aiFailed;
  const lines = [
    `Buddy today (${day})${healthy ? ": all good" : ""}`,
    "",
    `Check-ins: ${r.due} due, ${r.sent} sent${r.failed ? `, ${r.failed} failed` : ""}${r.windowClosed ? `, ${r.windowClosed} couldn't be sent (WhatsApp window closed)` : ""}, ${r.replied} answered.`,
    `Saved: ${plural(r.saved, "check-in")}${r.saved ? ` (${r.savedWhatsApp} on WhatsApp)` : ""}.`,
    `Red flags: ${r.redFlags}${r.redFlags ? ` (${r.redFlagsUnread} not opened yet)` : ""}.`,
    `Messages in: ${r.inbound}${r.inboundFailed ? `, ${r.inboundFailed} Buddy couldn't handle` : ""}.`,
    `AI: ${plural(r.aiCalls, "call")}${r.aiFailed ? `, ${r.aiFailed} failed` : ""}.`,
  ];
  if (r.problems.length) {
    lines.push("", "Needs a look:");
    for (const p of r.problems.slice(0, 6)) lines.push(`• ${p.label}: ${p.problem}`);
  }
  return lines.join("\n");
}

/** The one line the template carries when the window is closed. */
export function shortDailyReport(r: DailyReport): string {
  const bits = [
    `${r.sent} of ${r.due} check-ins sent`,
    `${r.replied} answered`,
    `${r.redFlags} red flag${r.redFlags === 1 ? "" : "s"}`,
  ];
  const issues =
    r.problems.length + (r.failed ? 1 : 0) + (r.inboundFailed ? 1 : 0) + (r.aiFailed ? 1 : 0);
  bits.push(issues ? `${issues} thing${issues === 1 ? "" : "s"} to look at` : "nothing broken");
  return bits.join(", ");
}

export function dailyReportDue(now: Date): boolean {
  const m = toSast(now).minuteOfDay;
  return m >= DAILY_REPORT_MINUTE && m < SEND_UNTIL_MINUTE;
}

/** Minute job. Sends at most once per admin per day. */
export async function runDailyReport(adminIn: Admin, env: SendEnv, now: Date): Promise<void> {
  if (!dailyReportDue(now)) return;
  const admin = adminIn as unknown as Db;
  const date = toSast(now).date;
  const { data: admins } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "super_admin")
    .limit(5);
  const ids = ((admins ?? []) as Array<{ id: string }>).map((a) => a.id);
  if (!ids.length) return;
  let report: DailyReport | null = null;
  const { practitionerContact, sendLogged, windowOpen } =
    await import("./practitioner-status.server");
  for (const id of ids) {
    if (!(await claimOnce(adminIn, DAILY_REPORT_JOB, id, date))) continue;
    const contact = await practitionerContact(adminIn, id);
    if (!contact.phone) continue;
    report ??= await buildDailyReport(adminIn, now);
    let ok = false;
    if (await windowOpen(adminIn, contact.phone, now)) {
      const body = formatDailyReport(report);
      ok = await sendLogged(
        adminIn,
        env,
        { kind: "text", to: contact.phone, body },
        "[daily report]",
      );
    } else {
      const template = process.env.WHATSAPP_DAILY_REPORT_TEMPLATE?.trim();
      if (!template) {
        log.warn("daily report skipped: window closed and no template", { id });
        continue;
      }
      ok = await sendLogged(
        adminIn,
        env,
        {
          kind: "template",
          to: contact.phone,
          templateName: template,
          languageCode: process.env.WHATSAPP_DAILY_REPORT_TEMPLATE_LANG?.trim() || "en",
          variables: [contact.firstName, shortDailyReport(report)],
          buttonPayloads: [DAILY_REPORT_BUTTON],
        },
        `[daily report template ${template}]`,
      );
    }
    if (!ok) await releaseClaim(adminIn, DAILY_REPORT_JOB, id, date);
  }
}

export function isDailyReportAsk(text: string): boolean {
  return /\b(?:buddy|daily|health|system)\s+report\b|\bhow(?:'s| is)\s+buddy\s+(?:doing|running|going)\b|\bis\s+buddy\s+(?:working|ok|okay|running)\b/i.test(
    String(text ?? "").trim(),
  );
}
