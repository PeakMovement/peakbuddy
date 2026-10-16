/**
 * Opt-in outreach that can reopen the 24 hour window.
 * Off until BUDDY_PROACTIVE_OUTREACH is exactly "1".
 * At most one send per patient per 7 days. Outside the window, a named
 * template or nothing. Never free text outside the window.
 */
import { log } from "@/lib/log";
import { BUDDY_FLAGS, patientFlag } from "@/lib/buddy-flags";
import { dueOutreach, OUTREACH_TEMPLATES, type OutreachKind } from "./proactive-context";
import { sendLogged, windowOpen, type SendEnv } from "./practitioner-status.server";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

const DAY_MS = 24 * 60 * 60 * 1000;

function sastDate(d: Date): string {
  return new Date(d.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function firstName(full: string | null): string {
  return String(full ?? "").trim().split(/\s+/)[0] || "there";
}

export async function runProactiveOutreach(
  adminIn: Admin,
  env: SendEnv,
  now: Date,
): Promise<{ sent: number; skipped: number }> {
  if (!patientFlag(BUDDY_FLAGS.proactiveOutreach)) return { sent: 0, skipped: 0 };
  const admin = adminIn as unknown as {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: unknown) => Promise<{ data: unknown; error: { message?: string } | null }>;
        in: (col: string, values: unknown[]) => {
          order: (col: string, opts?: unknown) => {
            limit: (n: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
          };
          limit: (n: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
        };
        limit: (n: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
      };
      insert: (row: unknown) => Promise<{ error: { code?: string; message?: string } | null }>;
    };
  };
  let sent = 0;
  let skipped = 0;
  try {
    const { data: clients, error } = await admin
      .from("clients")
      .select("id, full_name, practice_id, outreach_opt_in, discharged_at, next_appointment")
      .eq("outreach_opt_in", true);
    if (error || !Array.isArray(clients)) return { sent: 0, skipped: 0 };
    const today = sastDate(now);
    const yesterday = sastDate(new Date(now.getTime() - DAY_MS));
    for (const client of (clients as Array<Record<string, unknown>>).slice(0, 40)) {
      const id = String(client.id ?? "");
      if (!id) {
        skipped++;
        continue;
      }
      const outcome = await sendOne(admin, env, client, id, today, yesterday, now);
      if (outcome === "sent") sent++;
      else skipped++;
    }
  } catch (e) {
    log.warn("proactive outreach failed", { error: e instanceof Error ? e.message : "unknown" });
  }
  return { sent, skipped };
}

async function sendOne(
  admin: {
    from: (table: string) => {
      select: (cols: string) => {
        eq: (col: string, value: unknown) => Promise<{ data: unknown; error: { message?: string } | null }> & {
          order?: unknown;
          limit?: (n: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
        };
        in: (col: string, values: unknown[]) => {
          order: (col: string, opts?: unknown) => {
            limit: (n: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
          };
        };
      };
      insert: (row: unknown) => Promise<{ error: { code?: string; message?: string } | null }>;
    };
  },
  env: SendEnv,
  client: Record<string, unknown>,
  id: string,
  today: string,
  yesterday: string,
  now: Date,
): Promise<"sent" | "skipped"> {
  const convQuery = admin.from("whatsapp_conversations").select("phone, opted_out_at, state").eq("client_id", id) as {
    limit: (n: number) => Promise<{ data: unknown }>;
  };
  const { data: convs } = await convQuery.limit(1);
  const conv = ((convs ?? []) as Array<Record<string, unknown>>)[0];
  const phone = String(conv?.phone ?? "").replace(/\D/g, "");
  if (!phone || conv?.opted_out_at || conv?.state === "opted_out") return "skipped";

  const sendsQuery = admin.from("outreach_sends").select("kind, sent_on").eq("client_id", id) as {
    limit: (n: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
  const { data: prior, error: priorError } = await sendsQuery.limit(30);
  if (priorError) return "skipped";
  const rows = (prior ?? []) as Array<{ kind: OutreachKind; sent_on: string }>;
  const last = rows.map((r) => r.sent_on).sort().at(-1);
  const checksQuery = admin
    .from("check_ins")
    .select("pain_level, notes, created_at")
    .eq("client_id", id) as unknown as {
    order: (col: string, opts?: unknown) => {
      limit: (n: number) => Promise<{ data: unknown }>;
    };
  };
  const { data: checks } = await checksQuery.order("created_at", { ascending: false }).limit(40);
  const checkRows = (checks ?? []) as Array<{ pain_level: number | null; notes: string | null; created_at: string }>;
  const yday = checkRows.filter((c) => sastDate(new Date(c.created_at)) === yesterday);
  const previousPain = checkRows.find((c) => sastDate(new Date(c.created_at)) < yesterday)?.pain_level;
  const flare =
    yday.some((c) => /flare|worse|swollen/i.test(c.notes ?? "")) ||
    yday.some((c) => c.pain_level != null && previousPain != null && c.pain_level - previousPain >= 2);
  const appointment = client.next_appointment ? sastDate(new Date(String(client.next_appointment))) : "";
  const streak = streakEnding(checkRows, today, yesterday);
  const open = await windowOpen(admin as never, phone, now);
  const due = dueOutreach({
    optIn: client.outreach_opt_in === true,
    now,
    lastOutreachAt: last ? new Date(`${last}T00:00:00Z`) : null,
    sessionYesterday: appointment === yesterday,
    flareYesterday: flare,
    streak,
    dischargedAt: client.discharged_at ? new Date(String(client.discharged_at)) : null,
    alreadySent: rows.map((r) => r.kind),
    windowOpen: open,
  });
  if (!due) return "skipped";
  const spec = OUTREACH_TEMPLATES[due.kind];
  const template = due.useTemplate ? process.env[spec.env]?.trim() : "";
  if (due.useTemplate && !template) return "skipped";
  const practice = await practiceName(admin, client.practice_id);
  const name = firstName(typeof client.full_name === "string" ? client.full_name : null);
  const inserted = await admin.from("outreach_sends").insert({
    client_id: id,
    kind: due.kind,
    sent_on: today,
  });
  if (inserted.error) return "skipped";
  if (due.useTemplate) {
    const variables = due.kind === "milestone" ? [name, practice, String(streak)] : [name, practice];
    const payloads =
      due.kind === "day_after"
        ? ["start_checkin", "outreach_later"]
        : due.kind === "flare"
          ? ["start_checkin", "outreach_ok"]
          : due.kind === "discharge_check"
            ? ["start_checkin", "outreach_stop"]
            : ["start_checkin"];
    const ok = await sendLogged(
      admin as never,
      env,
      {
        kind: "template",
        to: phone,
        templateName: template ?? "",
        languageCode: "en",
        variables,
        buttonPayloads: payloads,
      },
      `[outreach ${due.kind}]`,
    );
    return ok ? "sent" : "skipped";
  }
  const body =
    due.kind === "milestone"
      ? `Hi ${name}, it's Buddy from ${practice}. That's ${streak} check ins in a row. Reply if you want to log today.`
      : spec.fallbackInWindow(name, practice);
  const ok = await sendLogged(admin as never, env, { kind: "text", to: phone, body }, body);
  return ok ? "sent" : "skipped";
}

function streakEnding(
  rows: Array<{ created_at: string }>,
  today: string,
  yesterday: string,
): number {
  const days = new Set(rows.map((r) => sastDate(new Date(r.created_at))));
  let cursor = days.has(today) ? today : days.has(yesterday) ? yesterday : "";
  if (!cursor) return 0;
  let n = 0;
  let at = new Date(`${cursor}T12:00:00Z`);
  while (days.has(sastDate(at)) && n < 60) {
    n++;
    at = new Date(at.getTime() - DAY_MS);
  }
  return n;
}

async function practiceName(
  admin: { from: (table: string) => { select: (cols: string) => { eq: (col: string, value: unknown) => unknown } } },
  practiceId: unknown,
): Promise<string> {
  if (!practiceId) return "your physio";
  const query = admin.from("practices").select("practice_name").eq("id", practiceId) as {
    limit: (n: number) => Promise<{ data: unknown }>;
  };
  const { data } = await query.limit(1);
  const name = String(((data ?? []) as Array<{ practice_name?: string }>)[0]?.practice_name ?? "").trim();
  return name || "your physio";
}
