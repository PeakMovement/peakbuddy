/**
 * Practice owner view on WhatsApp (10 Oct 2026, Justin). Owners and practice
 * admins ask Buddy about the whole practice:
 *
 *   "How many clients are using Buddy?"   usage numbers, by practitioner
 *   "Who's gone quiet?"                   clients with no check-in for 4+ days
 *   "Any red flags?"                      open red flag alerts, last 7 days
 *   "Practice overview"                   all three in one message
 *
 * A practitioner who isn't an owner or admin gets the same answers for their
 * own clients only.
 */
import { alertReason } from "./practitioner-alert.server";
import { ago, bucketOf, loadStatuses, type ClientStatus } from "./practitioner-status.server";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];
type Db = { from: (t: string) => any };

const DAY = 86_400_000;
const MAX_BODY = 3800;

export type AdminTopic = "overview" | "redflags" | "quiet" | "usage";

/* Which question it is: practitionerIntent in practitioner-status.server.ts. */

interface ClientRow {
  id: string;
  full_name: string | null;
  created_at: string | null;
  auth_user_id: string | null;
  practitioner_id: string | null;
}

export interface Scope {
  practice: boolean;
  label: string;
  clients: ClientRow[];
  names: Map<string, string>;
}

/** Owner, practice admin or super admin: the whole practice. Otherwise their own clients. */
export async function loadScope(adminIn: Admin, userId: string): Promise<Scope> {
  const admin = adminIn as unknown as Db;
  const cols = "id, full_name, created_at, auth_user_id, practitioner_id";
  const [{ data: owned }, { data: memberOf }, { data: prof }] = await Promise.all([
    admin.from("practices").select("id, practice_name").eq("practitioner_id", userId),
    admin
      .from("practice_members")
      .select("practice_id, role")
      .eq("user_id", userId)
      .eq("status", "active"),
    admin.from("profiles").select("role").eq("id", userId).maybeSingle(),
  ]);
  const ownedRows = (owned ?? []) as Array<{ id: string; practice_name: string | null }>;
  const ids = [
    ...ownedRows.map((p) => p.id),
    ...((memberOf ?? []) as Array<{ practice_id: string; role: string }>)
      .filter((m) => m.role === "owner" || m.role === "admin")
      .map((m) => m.practice_id),
  ];
  const superAdmin = (prof as { role?: string } | null)?.role === "super_admin";

  let clients: ClientRow[] = [];
  let practice = false;
  let label = "your clients";
  if (ids.length) {
    const { data } = await admin.from("clients").select(cols).in("practice_id", ids).limit(2000);
    clients = (data ?? []) as ClientRow[];
    practice = true;
    label = String(ownedRows[0]?.practice_name ?? "").trim() || "the practice";
  } else if (superAdmin) {
    const { data } = await admin.from("clients").select(cols).limit(2000);
    clients = (data ?? []) as ClientRow[];
    practice = true;
    label = "all practices";
  } else {
    const { data } = await admin
      .from("clients")
      .select(cols)
      .eq("practitioner_id", userId)
      .limit(2000);
    clients = (data ?? []) as ClientRow[];
  }

  const pracIds = [...new Set(clients.map((c) => c.practitioner_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (pracIds.length) {
    const { data: profs } = await admin
      .from("profiles")
      .select("id, full_name")
      .in("id", pracIds)
      .limit(500);
    for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null }>) {
      names.set(
        p.id,
        String(p.full_name ?? "")
          .trim()
          .split(/\s+/)[0] || "Unknown",
      );
    }
  }
  return { practice, label, clients, names };
}

interface OpenFlag {
  clientId: string;
  urgency: string;
  at: string;
  message: string | null;
}

async function loadRedFlags(
  adminIn: Admin,
  clientIds: string[],
  now: Date,
): Promise<{ open: OpenFlag[]; reviewed: number }> {
  const admin = adminIn as unknown as Db;
  if (!clientIds.length) return { open: [], reviewed: 0 };
  const since = new Date(now.getTime() - 7 * DAY).toISOString();
  const { data } = await admin
    .from("alerts")
    .select("client_id, urgency, created_at, message, is_read, reviewed_at")
    .eq("alert_type", "red_flag")
    .in("client_id", clientIds)
    .gte("created_at", since)
    .limit(1000);
  const rows = (data ?? []) as Array<Record<string, any>>;
  const open = rows
    .filter((a) => !a.is_read && !a.reviewed_at)
    .map((a) => ({
      clientId: a.client_id as string,
      urgency: String(a.urgency ?? "routine"),
      at: a.created_at as string,
      message: (a.message as string | null) ?? null,
    }));
  const rank: Record<string, number> = { emergency: 5, urgent: 4, soon: 3, monitor: 2, routine: 1 };
  open.sort(
    (a, b) =>
      (rank[b.urgency] ?? 0) - (rank[a.urgency] ?? 0) ||
      new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
  return { open, reviewed: rows.length - open.length };
}

const URGENCY_WORD: Record<string, string> = {
  emergency: "EMERGENCY",
  urgent: "urgent",
  soon: "same day",
  monitor: "monitor",
  routine: "routine",
};

function clip(s: string): string {
  return s.length <= MAX_BODY
    ? s
    : `${s.slice(0, MAX_BODY - 40).replace(/\n[^\n]*$/, "")}\n...and more in the Buddy app.`;
}

export function formatUsage(
  scope: Scope,
  statuses: ClientStatus[],
  now: Date,
  short = false,
): string {
  const weekAgo = now.getTime() - 7 * DAY;
  const current = statuses.filter((s) => bucketOf(s, now) !== "inactive");
  const checkedThisWeek = statuses.filter(
    (s) => s.checkins[0] && new Date(s.checkins[0].at).getTime() >= weekAgo,
  ).length;
  const joinedThisWeek = scope.clients.filter(
    (c) => c.created_at && new Date(c.created_at).getTime() >= weekAgo,
  ).length;
  const wa = statuses.filter((s) => s.channel === "whatsapp").length;
  const app = statuses.filter((s) => s.channel === "app").length;
  const none = statuses.length - wa - app;

  const lines = [
    `*Buddy usage, ${scope.label}*`,
    `• ${statuses.length} client${statuses.length === 1 ? "" : "s"} on Buddy, ${current.length} current`,
    `• ${checkedThisWeek} checked in this week, ${joinedThisWeek} joined this week`,
    `• ${wa} on WhatsApp, ${app} on the app only, ${none} not set up yet`,
  ];
  if (!short && scope.practice) {
    const byPrac = new Map<string, number>();
    const pracOf = new Map(scope.clients.map((c) => [c.id, c.practitioner_id]));
    for (const s of current) {
      const p = pracOf.get(s.id);
      const n = (p && scope.names.get(p)) || "Unassigned";
      byPrac.set(n, (byPrac.get(n) ?? 0) + 1);
    }
    if (byPrac.size) {
      lines.push(
        "",
        "Current clients by practitioner:",
        [...byPrac.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([n, c]) => `${n} ${c}`)
          .join(", "),
      );
    }
  }
  return lines.join("\n");
}

export function formatQuiet(
  scope: Scope,
  statuses: ClientStatus[],
  now: Date,
  short = false,
): string {
  const quiet = statuses.filter((s) => bucketOf(s, now) === "quiet");
  if (!quiet.length)
    return `*Gone quiet*\nNobody has gone quiet. Every current client checked in within the last 4 days.`;
  const pracOf = new Map(scope.clients.map((c) => [c.id, c.practitioner_id]));
  quiet.sort((a, b) => {
    const ta = a.checkins[0] ? new Date(a.checkins[0].at).getTime() : 0;
    const tb = b.checkins[0] ? new Date(b.checkins[0].at).getTime() : 0;
    return ta - tb;
  });
  const lines = [`*Gone quiet (${quiet.length})*, no check-in for 4 days or more:`];
  const shown = short ? quiet.slice(0, 5) : quiet;
  for (const s of shown) {
    const p = pracOf.get(s.id);
    const who = scope.practice && p ? ` (${scope.names.get(p) ?? "Unknown"})` : "";
    const when = s.checkins[0] ? `last check-in ${ago(s.checkins[0].at, now)}` : "no check-in yet";
    lines.push(`• ${s.name}${who}: ${when}`);
  }
  if (shown.length < quiet.length)
    lines.push(
      `...and ${quiet.length - shown.length} more. Ask "who's gone quiet?" for the full list.`,
    );
  return lines.join("\n");
}

export function formatRedFlags(
  scope: Scope,
  flags: { open: OpenFlag[]; reviewed: number },
  now: Date,
  short = false,
): string {
  if (!flags.open.length) {
    return `*Red flags*\nNo open red flags in the last 7 days.${flags.reviewed ? ` ${flags.reviewed} were raised and have been reviewed.` : ""}`;
  }
  const nameOf = new Map(scope.clients.map((c) => [c.id, String(c.full_name ?? "").trim()]));
  const pracOf = new Map(scope.clients.map((c) => [c.id, c.practitioner_id]));
  const lines = [`*Open red flags (${flags.open.length})*, last 7 days, not yet reviewed:`];
  const shown = short ? flags.open.slice(0, 5) : flags.open;
  for (const f of shown) {
    const p = pracOf.get(f.clientId);
    const who = scope.practice && p ? ` (${scope.names.get(p) ?? "Unknown"})` : "";
    const why = alertReason(f.message);
    lines.push(
      `• ${nameOf.get(f.clientId) || "A client"}${who}: ${URGENCY_WORD[f.urgency] ?? f.urgency}, ${ago(f.at, now)}. ${why}`,
    );
  }
  if (shown.length < flags.open.length)
    lines.push(
      `...and ${flags.open.length - shown.length} more. Ask "any red flags?" for all of them.`,
    );
  if (flags.reviewed)
    lines.push(
      `${flags.reviewed} other${flags.reviewed === 1 ? "" : "s"} this week already reviewed.`,
    );
  return lines.join("\n");
}

/** The answer to an owner question, as one WhatsApp message. */
export async function adminAnswer(
  adminIn: Admin,
  userId: string,
  topic: AdminTopic,
  now: Date,
): Promise<string> {
  const scope = await loadScope(adminIn, userId);
  if (!scope.clients.length) {
    return scope.practice
      ? "There are no clients on Buddy at the practice yet."
      : "You don't have any clients on Buddy yet.";
  }
  if (topic === "redflags") {
    const flags = await loadRedFlags(
      adminIn,
      scope.clients.map((c) => c.id),
      now,
    );
    return clip(formatRedFlags(scope, flags, now));
  }
  const statuses = await loadStatuses(adminIn, scope.clients, now);
  if (topic === "usage") return clip(formatUsage(scope, statuses, now));
  if (topic === "quiet") return clip(formatQuiet(scope, statuses, now));
  const flags = await loadRedFlags(
    adminIn,
    scope.clients.map((c) => c.id),
    now,
  );
  return clip(
    [
      formatRedFlags(scope, flags, now, true),
      formatUsage(scope, statuses, now, true),
      formatQuiet(scope, statuses, now, true),
    ].join("\n\n"),
  );
}
