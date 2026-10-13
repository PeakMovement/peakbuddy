/**
 * Practitioner-only reads for the capability tools. Heidi text is read from
 * heidi_records and put in the reply. It is not written to patient_memory
 * and it is not sent to a model.
 */
import { log } from "@/lib/log";
import {
  caseBrief,
  formatOwnerScorecard,
  initialsOf,
  ownerScorecard,
  whoImproved,
} from "@/lib/capabilities";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

interface Chain extends PromiseLike<{ data: unknown; error: { message?: string } | null }> {
  select: (columns?: string) => Chain;
  eq: (column: string, value: unknown) => Chain;
  in: (column: string, value: unknown[]) => Chain;
  gte: (column: string, value: unknown) => Chain;
  order: (column: string, opts?: { ascending: boolean }) => Chain;
  limit: (count: number) => Chain;
  maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
  update: (values: Record<string, unknown>) => Chain;
}

function db(admin: Admin): { from: (table: string) => Chain } {
  return admin as unknown as { from: (table: string) => Chain };
}

function rowsOf<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

export async function replyCaseBrief(
  adminIn: Admin,
  client: { id: string; full_name: string | null },
): Promise<string> {
  const admin = db(adminIn);
  const name = (client.full_name || "This client").trim();
  const [heidiRes, checkRes, wearRes, clientRes] = await Promise.all([
    admin
      .from("heidi_records")
      .select("summary, newest_note_at")
      .eq("client_id", client.id)
      .order("fetched_at", { ascending: false })
      .limit(1),
    admin
      .from("check_ins")
      .select("created_at, pain_level, sleep_quality, energy_level, stress_level")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(7),
    admin
      .from("wearable_sessions")
      .select("sleep_score, date")
      .eq("client_id", client.id)
      .order("date", { ascending: false })
      .limit(1),
    admin.from("clients").select("goal").eq("id", client.id).maybeSingle(),
  ]);
  const heidi = rowsOf<{ summary?: string; newest_note_at?: string | null }>(heidiRes.data)[0];
  const checkins = rowsOf<{
    created_at: string;
    pain_level: number | null;
    sleep_quality: number | null;
    energy_level: number | null;
    stress_level: number | null;
  }>(checkRes.data);
  const wear = rowsOf<{ sleep_score?: number | null }>(wearRes.data)[0];
  const goal = (clientRes.data as { goal?: string | null } | null)?.goal ?? null;
  const brief = caseBrief({
    clientName: name,
    heidiNote: heidi?.summary ?? null,
    heidiDate: heidi?.newest_note_at ?? null,
    checkins: checkins.map((c) => ({
      at: c.created_at,
      pain: c.pain_level,
      sleep: c.sleep_quality,
      energy: c.energy_level,
      stress: c.stress_level,
    })),
    wearable: wear ? { sleepScore: wear.sleep_score ?? null, loadRatio: null } : null,
    goal,
  });
  if (brief.storedInPatientMemory || brief.sentToModel) {
    log.warn("case brief refused: boundary broken");
    return "I couldn't prepare that brief.";
  }
  return brief.text;
}

export async function replyWhoImproved(
  adminIn: Admin,
  clients: Array<{ id: string; full_name: string | null }>,
  now: Date,
): Promise<string> {
  if (!clients.length) return "You don't have any clients on Buddy yet.";
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const { data } = await db(adminIn)
    .from("check_ins")
    .select("client_id, created_at, pain_level")
    .in(
      "client_id",
      clients.map((c) => c.id),
    )
    .gte("created_at", since)
    .limit(2000);
  const rows = rowsOf<{ client_id: string; created_at: string; pain_level: number | null }>(data);
  const byId = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byId.get(row.client_id) ?? [];
    list.push(row);
    byId.set(row.client_id, list);
  }
  return whoImproved(
    clients.map((c) => {
      const ordered = (byId.get(c.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
      return {
        name: (c.full_name || "A client").trim(),
        painThen: ordered[0]?.pain_level ?? null,
        painNow: ordered[ordered.length - 1]?.pain_level ?? null,
      };
    }),
  );
}

export async function replyScorecard(
  adminIn: Admin,
  userId: string,
  clients: Array<{ id: string; full_name: string | null; practitioner_id?: string | null }>,
  now: Date,
): Promise<string> {
  const { loadScope } = await import("./practitioner-admin.server");
  const scope = await loadScope(adminIn, userId);
  const names = scope.names;
  if (!clients.length) return "There are no clients on Buddy yet.";
  const { data } = await db(adminIn)
    .from("check_ins")
    .select("client_id, created_at")
    .in(
      "client_id",
      clients.map((c) => c.id),
    )
    .order("created_at", { ascending: false })
    .limit(3000);
  const latest = new Map<string, string>();
  for (const row of rowsOf<{ client_id: string; created_at: string }>(data)) {
    if (!latest.has(row.client_id)) latest.set(row.client_id, row.created_at);
  }
  const { data: people } = await db(adminIn)
    .from("clients")
    .select("id, primary_complaint, practitioner_id")
    .in(
      "id",
      clients.map((c) => c.id),
    )
    .limit(2000);
  const meta = new Map(
    rowsOf<{ id: string; primary_complaint: string | null; practitioner_id: string | null }>(
      people,
    ).map((r) => [r.id, r]),
  );
  const card = ownerScorecard(
    clients.map((c) => {
      const row = meta.get(c.id);
      const at = latest.get(c.id);
      const days = at ? Math.floor((now.getTime() - new Date(at).getTime()) / 86_400_000) : null;
      const prac = row?.practitioner_id ? (names.get(row.practitioner_id) ?? "") : "";
      return {
        initials: initialsOf(prac || c.full_name || "?"),
        complaint: row?.primary_complaint?.trim() || "Unlabelled",
        daysSinceCheckIn: days,
      };
    }),
  );
  return formatOwnerScorecard(card);
}

export async function saveProgrammeReminder(
  adminIn: Admin,
  clientId: string,
  days: number[],
  optedIn: boolean,
): Promise<boolean> {
  const values: Record<string, unknown> = {
    programme_reminder_days: days,
  };
  if (optedIn) values.programme_reminder_opt_in = true;
  const { error } = await db(adminIn).from("clients").update(values).eq("id", clientId);
  return !error;
}

export async function saveClientGoal(
  adminIn: Admin,
  clientId: string,
  goal: string,
): Promise<boolean> {
  const { error } = await db(adminIn)
    .from("clients")
    .update({ goal: goal.slice(0, 200) })
    .eq("id", clientId);
  return !error;
}
