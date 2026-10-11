/**
 * Practitioner inbox on WhatsApp (11 Oct 2026, after Justin's chat where
 * "Let's see Lauren's message" and "who has checked in this week?" got
 * "Sorry, I didn't quite get that"):
 *
 *   - read a client's open messages and alerts in full, or all of yours
 *   - mark them reviewed from WhatsApp (prac_rev_<alert id>, prac_revall_<client id>)
 *   - who checked in today / this week / since a day, with pain
 *
 * Open means the same as everywhere else in practitioner mode: not read,
 * not reviewed, last 14 days, and red flags, client messages or anything
 * above routine.
 */
import { alertKind, ago, type AlertKind } from "./practitioner-status.server";
import { cleanAlertText, type CheckedInRange } from "./practitioner-inbox-text";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (t: string) => any };

const DAY = 86_400_000;
const MAX_BODY = 3800;

export interface PatientRef {
  id: string;
  full_name: string | null;
}

export interface OpenAlert {
  id: string;
  clientId: string;
  kind: AlertKind;
  urgency: string;
  at: string;
  message: string | null;
}

const KIND_LABEL: Record<AlertKind, string> = {
  red_flag: "Red flag",
  question: "Question",
  call_request: "Call request",
  message: "Message",
  pattern: "Pattern alert",
  other: "Alert",
};

const URGENCY_WORD: Record<string, string> = {
  emergency: "emergency",
  urgent: "urgent",
  soon: "same day",
};

export async function loadOpenAlerts(
  adminIn: Admin,
  clientIds: string[],
  now: Date,
): Promise<OpenAlert[]> {
  const admin = adminIn as unknown as Db;
  if (!clientIds.length) return [];
  const since = new Date(now.getTime() - 14 * DAY).toISOString();
  const { data } = await admin
    .from("alerts")
    .select("id, client_id, alert_type, urgency, created_at, is_read, reviewed_at, message")
    .in("client_id", clientIds)
    .gte("created_at", since)
    .limit(2000);
  return ((data ?? []) as Array<Record<string, any>>)
    .filter((a) => !a.is_read && !a.reviewed_at)
    .filter(
      (a) =>
        ["red_flag", "client_contact_request"].includes(a.alert_type) || a.urgency !== "routine",
    )
    .map((a) => ({
      id: a.id as string,
      clientId: a.client_id as string,
      kind: alertKind(a.alert_type, a.message),
      urgency: String(a.urgency ?? "routine"),
      at: a.created_at as string,
      message: (a.message as string | null) ?? null,
    }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

function heading(a: OpenAlert, now: Date): string {
  const urgent =
    a.kind === "red_flag" && URGENCY_WORD[a.urgency] ? ` (${URGENCY_WORD[a.urgency]})` : "";
  return `${KIND_LABEL[a.kind]}${urgent}, ${ago(a.at, now)}`;
}

function clip(s: string): string {
  return s.length <= MAX_BODY
    ? s
    : `${s.slice(0, MAX_BODY - 40).replace(/\n[^\n]*$/, "")}\n...and more in the Buddy app.`;
}

/** One client's open messages and alerts, in full. */
export function formatClientMessages(name: string, alerts: OpenAlert[], now: Date): string {
  if (!alerts.length) return `Nothing open for ${name}. Everything has been reviewed.`;
  const lines = [`*${name}: ${alerts.length} open*`];
  alerts.slice(0, 8).forEach((a, i) => {
    lines.push("", `${i + 1}. ${heading(a, now)}`, cleanAlertText(a.message));
  });
  if (alerts.length > 8) lines.push("", `...and ${alerts.length - 8} more in the Buddy app.`);
  return clip(lines.join("\n"));
}

/** A few lines for the client card ("how is Lauren doing"). */
export function formatAlertLines(alerts: OpenAlert[], now: Date, max = 3): string[] {
  if (!alerts.length) return [];
  const lines = ["", `*Open (${alerts.length})*`];
  for (const a of alerts.slice(0, max)) {
    lines.push(`• ${heading(a, now)}: ${cleanAlertText(a.message, 220)}`);
  }
  if (alerts.length > max) lines.push(`...and ${alerts.length - max} more. Tap See all.`);
  return lines;
}

/** All open items across the practitioner's clients, newest client first. */
export function formatInbox(
  firstName: string,
  patients: PatientRef[],
  alerts: OpenAlert[],
  now: Date,
): string {
  if (!alerts.length) return `Nothing waiting for you, ${firstName}. Everything has been reviewed.`;
  const nameOf = new Map(
    patients.map((p) => [p.id, String(p.full_name ?? "").trim() || "A client"]),
  );
  const byClient = new Map<string, OpenAlert[]>();
  for (const a of alerts) byClient.set(a.clientId, [...(byClient.get(a.clientId) ?? []), a]);
  const lines = [
    `${alerts.length} open item${alerts.length === 1 ? "" : "s"} for ${byClient.size} client${byClient.size === 1 ? "" : "s"}, newest first:`,
  ];
  let shown = 0;
  for (const [clientId, list] of byClient) {
    if (shown >= 10) break;
    shown++;
    lines.push("", `*${nameOf.get(clientId)}* (${list.length})`);
    for (const a of list.slice(0, 2))
      lines.push(`• ${heading(a, now)}: ${cleanAlertText(a.message, 160)}`);
    if (list.length > 2) lines.push(`• ...and ${list.length - 2} more`);
  }
  if (byClient.size > shown)
    lines.push("", `...and ${byClient.size - shown} more clients in the Buddy app.`);
  lines.push(
    "",
    `Send a name, for example "${firstWord(nameOf.get([...byClient.keys()][0]))}'s messages", to read one client's in full and mark them reviewed.`,
  );
  return clip(lines.join("\n"));
}

function firstWord(s: string | undefined): string {
  return String(s ?? "Sam").split(/\s+/)[0] || "Sam";
}

/** Mark alerts reviewed. Only ids that are open and belong to the given clients. Returns how many. */
export async function markReviewed(
  adminIn: Admin,
  alertIds: string[],
  allowedClientIds: string[],
  userId: string,
  now: Date,
): Promise<number> {
  const admin = adminIn as unknown as Db;
  if (!alertIds.length || !allowedClientIds.length) return 0;
  const { data } = await admin
    .from("alerts")
    .update({ is_read: true, reviewed_at: now.toISOString(), reviewed_by: userId })
    .in("id", alertIds)
    .in("client_id", allowedClientIds)
    .is("reviewed_at", null)
    .select("id");
  return ((data ?? []) as unknown[]).length;
}

export interface CheckinRow {
  clientId: string;
  at: string;
  pain: number | null;
}

export async function loadCheckins(
  adminIn: Admin,
  clientIds: string[],
  range: CheckedInRange,
  now: Date,
): Promise<CheckinRow[]> {
  const admin = adminIn as unknown as Db;
  if (!clientIds.length) return [];
  const { data } = await admin
    .from("check_ins")
    .select("client_id, pain_level, created_at")
    .in("client_id", clientIds)
    .gte("created_at", new Date(range.since).toISOString())
    .lt("created_at", new Date(range.until ?? now.getTime() + 60_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(3000);
  return ((data ?? []) as Array<Record<string, any>>)
    .map((r) => ({ clientId: r.client_id, at: r.created_at, pain: r.pain_level ?? null }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/**
 * "Checked in this week (6 of 9)". Who didn't is listed only among clients
 * who were current (checked in within 60 days or joined in the last 30).
 */
export function formatCheckedIn(
  range: CheckedInRange,
  clients: Array<PatientRef & { created_at?: string | null }>,
  rows: CheckinRow[],
  recentlyActive: Set<string>,
  now: Date,
  practice = false,
): string {
  const nameOf = new Map(
    clients.map((c) => [c.id, String(c.full_name ?? "").trim() || "A client"]),
  );
  const byClient = new Map<string, CheckinRow[]>();
  for (const r of rows) byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), r]);
  const current = clients.filter((c) => recentlyActive.has(c.id) || byClient.has(c.id));
  const who = practice ? "at the practice" : "of your clients";
  if (!byClient.size) {
    return `Nobody ${who} has checked in ${range.label} yet.${current.length ? ` ${current.length} current client${current.length === 1 ? "" : "s"} could.` : ""}`;
  }
  const lines = [
    `*Checked in ${range.label} (${byClient.size} of ${Math.max(current.length, byClient.size)})*`,
  ];
  for (const [clientId, list] of byClient) {
    const latest = list[0];
    const pain = latest.pain != null ? `, pain ${latest.pain}` : "";
    const more = list.length > 1 ? ` (${list.length} check-ins)` : "";
    lines.push(`• ${nameOf.get(clientId)}: ${ago(latest.at, now)}${pain}${more}`);
  }
  const missing = current.filter((c) => !byClient.has(c.id)).map((c) => nameOf.get(c.id)!);
  if (missing.length) {
    const shown = missing.slice(0, 8);
    lines.push(
      "",
      `Not yet: ${shown.join(", ")}${missing.length > shown.length ? ` and ${missing.length - shown.length} more` : ""}.`,
    );
  }
  return clip(lines.join("\n"));
}
