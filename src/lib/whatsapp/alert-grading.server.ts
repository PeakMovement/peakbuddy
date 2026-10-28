/**
 * The learning loop (28 Oct 2026). Buddy's calibration (calibration.ts)
 * turns "real concern / false alarm" grades into per-category precision, but
 * it only learns if alerts get graded. So after a red flag, Buddy asks the
 * treating practitioner once, inside their WhatsApp window and between
 * 08:00 and 19:00, with three buttons. One tap grades it.
 *
 * Grades feed the report Justin sees. They never change a red flag rule by
 * themselves: any change to what counts as a red flag needs his yes.
 */
import { claimOnce } from "@/lib/job-claims.server";
import { toSast } from "./clinic-hours";
import type { SendEnv } from "./practitioner-status.server";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (t: string) => any };

export const GRADE_JOB = "grade_ask";
const MIN_AGE_MS = 30 * 60_000;
const MAX_AGE_MS = 7 * 24 * 3600_000;

export type Grade = "confirmed" | "false_alarm" | "already_aware";
const GRADE_CODE: Record<Grade, string> = { confirmed: "c", false_alarm: "f", already_aware: "a" };

export function gradeButtonId(grade: Grade, alertId: string): string {
  return `prac_grade_${GRADE_CODE[grade]}_${alertId}`;
}

export function readGradeButton(
  replyId: string | null | undefined,
): { grade: Grade; alertId: string } | null {
  const m = String(replyId ?? "").match(/^prac_grade_([cfa])_([0-9a-f-]{36})$/);
  if (!m) return null;
  const grade = (Object.entries(GRADE_CODE).find(([, c]) => c === m[1])?.[0] ??
    null) as Grade | null;
  return grade ? { grade, alertId: m[2] } : null;
}

export function gradeQuestion(patient: string, raisedAt: string) {
  const day = new Date(raisedAt).toLocaleDateString("en-ZA", {
    weekday: "long",
    timeZone: "Africa/Johannesburg",
  });
  return (alertId: string) => ({
    kind: "buttons" as const,
    body: `Quick one, to help Buddy learn: was ${patient}'s red flag on ${day} a real concern?`,
    buttons: [
      { id: gradeButtonId("confirmed", alertId), title: "Real concern" },
      { id: gradeButtonId("false_alarm", alertId), title: "False alarm" },
      { id: gradeButtonId("already_aware", alertId), title: "Already knew" },
    ],
  });
}

/** Minute job: ask about one ungraded red flag per practitioner, at most. */
export async function runGradeAsks(adminIn: Admin, env: SendEnv, now: Date): Promise<number> {
  const m = toSast(now).minuteOfDay;
  if (m < 8 * 60 || m >= 19 * 60) return 0;
  const admin = adminIn as unknown as Db;
  const { data } = await admin
    .from("alerts")
    .select("id, client_id, practitioner_id, created_at, outcome")
    .eq("alert_type", "red_flag")
    .is("outcome", null)
    .gte("created_at", new Date(now.getTime() - MAX_AGE_MS).toISOString())
    .lte("created_at", new Date(now.getTime() - MIN_AGE_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(30);
  const rows = (data ?? []) as Array<{
    id: string;
    client_id: string;
    practitioner_id: string;
    created_at: string;
  }>;
  const asked = new Set<string>();
  let sent = 0;
  const { practitionerContact, sendLogged, windowOpen } =
    await import("./practitioner-status.server");
  for (const a of rows) {
    if (asked.has(a.practitioner_id)) continue;
    const contact = await practitionerContact(adminIn, a.practitioner_id);
    if (!contact.phone || !(await windowOpen(adminIn, contact.phone, now))) continue;
    if (!(await claimOnce(adminIn, GRADE_JOB, a.id, a.created_at.slice(0, 10)))) continue;
    asked.add(a.practitioner_id);
    const { data: c } = await admin
      .from("clients")
      .select("full_name")
      .eq("id", a.client_id)
      .maybeSingle();
    const patient =
      String((c as { full_name?: string | null } | null)?.full_name ?? "").trim() || "a patient";
    const msg = gradeQuestion(patient, a.created_at)(a.id);
    if (await sendLogged(adminIn, env, { ...msg, to: contact.phone }, "[grade ask]")) sent++;
  }
  return sent;
}

/** A tap on one of the three buttons. Only the treating practitioner, an owner or the admin. */
export async function applyGrade(
  adminIn: Admin,
  userId: string,
  input: { grade: Grade; alertId: string },
  now: Date,
): Promise<"saved" | "not_yours" | "missing"> {
  const admin = adminIn as unknown as Db;
  const { data: a } = await admin
    .from("alerts")
    .select("id, practitioner_id, client_id")
    .eq("id", input.alertId)
    .maybeSingle();
  const alert = a as { id: string; practitioner_id: string; client_id: string } | null;
  if (!alert) return "missing";
  if (alert.practitioner_id !== userId) {
    const { data: prof } = await admin
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();
    const { data: own } = await admin
      .from("practices")
      .select("id")
      .eq("practitioner_id", userId)
      .limit(1);
    const ok =
      (prof as { role?: string } | null)?.role === "super_admin" ||
      ((own ?? []) as unknown[]).length > 0;
    if (!ok) return "not_yours";
  }
  await admin
    .from("alerts")
    .update({
      outcome: input.grade,
      outcome_at: now.toISOString(),
      outcome_by: userId,
      is_read: true,
      reviewed_at: now.toISOString(),
      reviewed_by: userId,
    })
    .eq("id", alert.id);
  return "saved";
}

export const GRADE_THANKS: Record<Grade, string> = {
  confirmed: "Thanks, noted as a real concern. That helps Buddy learn which alerts matter.",
  false_alarm:
    "Thanks, noted as a false alarm. Justin sees which kinds of alerts are too jumpy; nothing changes without him.",
  already_aware: "Thanks, noted that you already knew.",
};

/** One line for the admin report: grading coverage and any noisy category. */
export async function detectionReviewLine(adminIn: Admin, now: Date): Promise<string | null> {
  const admin = adminIn as unknown as Db;
  const { data } = await admin
    .from("alerts")
    .select("red_flag_category, outcome")
    .eq("alert_type", "red_flag")
    .gte("created_at", new Date(now.getTime() - 90 * 24 * 3600_000).toISOString())
    .limit(2000);
  const rows = (data ?? []) as Array<{ red_flag_category: string | null; outcome: string | null }>;
  if (!rows.length) return null;
  const graded = rows.filter((r) => r.outcome === "confirmed" || r.outcome === "false_alarm");
  const { computeCalibration } = await import("@/lib/calibration");
  const cal = computeCalibration(
    rows.map((r) => ({ category: r.red_flag_category, outcome: r.outcome })),
    now,
  );
  const noisy = cal.categories.filter((c) => c.suggestion === "raise");
  const parts = [`Red flags graded (90 days): ${graded.length} of ${rows.length}.`];
  for (const c of noisy.slice(0, 2)) {
    parts.push(
      `"${c.category}" was a false alarm ${c.falseAlarm} of ${c.n} times. Worth reviewing that rule.`,
    );
  }
  return parts.join(" ");
}
