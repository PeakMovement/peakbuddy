/**
 * What Buddy knows about the patient it is talking to, as a short card for
 * the conversational model (stage 1 of the context build, 9 Oct 2026).
 *
 * Facts only, already recorded in Buddy: who treats them, what the practice
 * recorded they are being seen for, how check-ins have gone, their programme,
 * their watch data, and everyday things they have told Buddy. Nothing here is
 * interpreted; the model is told never to draw clinical conclusions from it.
 *
 * loadPatientContext reads; renderPatientContext is pure and tested.
 */
type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

const DAY = 86_400_000;

export interface CheckInPoint {
  at: string;
  pain: number | null;
  sleep: number | null;
  energy: number | null;
  note: string | null;
  source: string | null;
}

export interface WearableDay {
  date: string;
  steps: number | null;
  sleepSeconds: number | null;
  restingHr: number | null;
  sessionType: string | null;
  distanceKm: number | null;
  durationMinutes: number | null;
}

export interface PatientContext {
  firstName: string;
  practitionerName: string | null;
  practitionerProfession: string | null;
  seenFor: string | null;
  inCareSince: string | null;
  programmeName: string | null;
  programmeStatus: string | null;
  reminderTime: string | null;
  checkIns: CheckInPoint[];
  wearableDevice: string | null;
  wearable: WearableDay[];
  memories: string[];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const one = (n: number) => (Math.round(n * 10) / 10).toString();

function daysAgo(iso: string, now: Date): string {
  const d = Math.floor((now.getTime() - new Date(iso).getTime()) / DAY);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}

/** Consecutive SAST days with a check-in, counting back from today or yesterday. */
export function checkInStreak(points: CheckInPoint[], now: Date): number {
  const sastDay = (t: number) => new Date(t + 2 * 3_600_000).toISOString().slice(0, 10);
  const days = new Set(points.map((p) => sastDay(new Date(p.at).getTime())));
  let t = now.getTime();
  if (!days.has(sastDay(t))) t -= DAY;
  let n = 0;
  while (days.has(sastDay(t))) {
    n++;
    t -= DAY;
  }
  return n;
}

export function renderPatientContext(ctx: PatientContext, now: Date): string {
  const lines: string[] = [];
  if (ctx.practitionerName) {
    lines.push(
      `Treated by: ${ctx.practitionerName}${ctx.practitionerProfession ? ` (${ctx.practitionerProfession})` : ""}.`,
    );
  }
  if (ctx.seenFor) lines.push(`The practice recorded they are being seen for: ${ctx.seenFor}.`);
  if (ctx.inCareSince) {
    const weeks = Math.max(0, Math.floor((now.getTime() - new Date(ctx.inCareSince).getTime()) / (7 * DAY)));
    lines.push(weeks < 1 ? "Joined Buddy this week." : `On Buddy for ${weeks} week${weeks === 1 ? "" : "s"}.`);
  }

  const recent = ctx.checkIns.filter((c) => now.getTime() - new Date(c.at).getTime() < 14 * DAY);
  if (ctx.checkIns.length) {
    const latest = ctx.checkIns[0];
    const parts = [`pain ${latest.pain ?? "?"}/10`];
    if (latest.source === "whatsapp") {
      if (latest.sleep != null) parts.push(`sleep ${latest.sleep}/5`);
      if (latest.energy != null) parts.push(`energy ${latest.energy}/5`);
    }
    const streak = checkInStreak(ctx.checkIns, now);
    lines.push(
      `Check-ins: ${recent.length} in the last 14 days${streak >= 2 ? `, ${streak} days in a row right now` : ""}. Latest ${daysAgo(latest.at, now)}: ${parts.join(", ")}.`,
    );
    const pains = (from: number, to: number) =>
      ctx.checkIns
        .filter((c) => {
          const age = now.getTime() - new Date(c.at).getTime();
          return c.pain != null && age >= from * DAY && age < to * DAY;
        })
        .map((c) => c.pain as number);
    const thisWeek = avg(pains(0, 7));
    const lastWeek = avg(pains(7, 14));
    if (thisWeek != null && lastWeek != null) {
      const diff = thisWeek - lastWeek;
      const dir = Math.abs(diff) < 0.5 ? "about the same" : diff < 0 ? "lower" : "higher";
      lines.push(`Average pain ${one(thisWeek)}/10 this week, ${one(lastWeek)}/10 the week before (${dir}).`);
    } else if (thisWeek != null) {
      lines.push(`Average pain this week: ${one(thisWeek)}/10.`);
    }
    const notes = ctx.checkIns
      .filter((c) => c.note && c.note.trim())
      .slice(0, 2)
      .map((c) => `"${c.note!.replace(/\s+/g, " ").trim().slice(0, 120)}" (${daysAgo(c.at, now)})`);
    if (notes.length) lines.push(`Their own recent words: ${notes.join("; ")}.`);
  } else {
    lines.push("No check-ins yet.");
  }

  if (ctx.programmeName) {
    lines.push(
      `Exercise programme: ${ctx.programmeName}${ctx.programmeStatus ? ` (${ctx.programmeStatus.replace(/_/g, " ")})` : ""}.`,
    );
  }
  if (ctx.reminderTime) lines.push(`Daily check-in reminder: ${ctx.reminderTime.slice(0, 5)}.`);

  if (ctx.wearableDevice || ctx.wearable.length) {
    const w = ctx.wearable.filter((d) => now.getTime() - new Date(d.date).getTime() < 8 * DAY);
    const bits: string[] = [];
    const steps = avg(w.map((d) => d.steps).filter((x): x is number => x != null && x > 0));
    if (steps != null) bits.push(`about ${Math.round(steps).toLocaleString("en-US")} steps a day`);
    const sleep = avg(w.map((d) => d.sleepSeconds).filter((x): x is number => x != null && x > 0));
    if (sleep != null) bits.push(`about ${one(sleep / 3600)} h sleep a night`);
    const rhr = avg(w.map((d) => d.restingHr).filter((x): x is number => x != null && x > 0));
    if (rhr != null) bits.push(`resting heart rate around ${Math.round(rhr)}`);
    const acts = w
      .filter((d) => d.sessionType && d.sessionType !== "daily" && (d.distanceKm || d.durationMinutes))
      .slice(0, 3)
      .map(
        (d) =>
          `${d.sessionType}${d.distanceKm ? ` ${one(d.distanceKm)} km` : ""}${d.durationMinutes ? ` ${Math.round(d.durationMinutes)} min` : ""} (${daysAgo(d.date, now)})`,
      );
    lines.push(
      `Watch${ctx.wearableDevice ? `: ${ctx.wearableDevice}` : ""}.${bits.length ? ` Last 7 days: ${bits.join(", ")}.` : " No recent data."}${acts.length ? ` Recent activity: ${acts.join("; ")}.` : ""}`,
    );
  }

  if (ctx.memories.length) {
    lines.push(`Things they have told Buddy about their life: ${ctx.memories.slice(0, 12).join("; ")}.`);
  }
  return lines.join("\n");
}

export async function loadPatientContext(
  admin: Admin,
  clientId: string,
  now: Date = new Date(),
): Promise<PatientContext | null> {
  const a = admin as unknown as { from: (t: string) => any };
  const since = new Date(now.getTime() - 28 * DAY).toISOString();
  const wSince = new Date(now.getTime() - 8 * DAY).toISOString().slice(0, 10);

  const { data: client } = await a
    .from("clients")
    .select("id, full_name, primary_complaint, created_at, practitioner_id, suggested_program_id, program_status")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return null;

  const safe = async <T>(p: PromiseLike<{ data: T | null }>): Promise<T | null> => {
    try {
      return (await p).data;
    } catch {
      return null;
    }
  };

  const [prof, programme, checkIns, reminder, tokens, sessions, memories] = await Promise.all([
    client.practitioner_id
      ? safe(a.from("profiles").select("full_name, profession").eq("id", client.practitioner_id).maybeSingle())
      : null,
    client.suggested_program_id
      ? safe(a.from("programs").select("name").eq("id", client.suggested_program_id).maybeSingle())
      : null,
    safe(
      a
        .from("check_ins")
        .select("created_at, pain_level, sleep_quality, energy_level, notes, condition_note, source")
        .eq("client_id", clientId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(60),
    ),
    safe(
      a
        .from("checkin_reminders")
        .select("time_of_day, enabled")
        .eq("client_id", clientId)
        .eq("enabled", true)
        .limit(1),
    ),
    safe(a.from("wearable_tokens").select("provider, garmin_device_model").eq("client_id", clientId).limit(3)),
    safe(
      a
        .from("wearable_sessions")
        .select("date, session_type, total_steps, total_sleep_duration, resting_hr, total_distance_km, duration_minutes")
        .eq("client_id", clientId)
        .gte("date", wSince)
        .order("date", { ascending: false })
        .limit(40),
    ),
    safe(
      a
        .from("patient_memory")
        .select("fact")
        .eq("client_id", clientId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(20),
    ),
  ]);

  const tok = ((tokens ?? []) as Array<{ provider: string; garmin_device_model: string | null }>)[0];
  return {
    firstName: (String(client.full_name ?? "").trim().split(/\s+/)[0] || "there"),
    practitionerName: (prof as { full_name?: string } | null)?.full_name ?? null,
    practitionerProfession: (prof as { profession?: string } | null)?.profession ?? null,
    seenFor: client.primary_complaint ? String(client.primary_complaint).slice(0, 120) : null,
    inCareSince: client.created_at ?? null,
    programmeName: (programme as { name?: string } | null)?.name ?? null,
    programmeStatus: client.program_status ?? null,
    reminderTime: ((reminder ?? []) as Array<{ time_of_day: string }>)[0]?.time_of_day ?? null,
    checkIns: ((checkIns ?? []) as Array<Record<string, unknown>>).map((c) => ({
      at: String(c.created_at),
      pain: typeof c.pain_level === "number" ? c.pain_level : null,
      sleep: typeof c.sleep_quality === "number" ? c.sleep_quality : null,
      energy: typeof c.energy_level === "number" ? c.energy_level : null,
      note: (c.notes as string | null) || (c.condition_note as string | null) || null,
      source: (c.source as string | null) ?? null,
    })),
    wearableDevice: tok
      ? tok.garmin_device_model || tok.provider.charAt(0).toUpperCase() + tok.provider.slice(1)
      : null,
    wearable: ((sessions ?? []) as Array<Record<string, unknown>>).map((s) => ({
      date: String(s.date),
      steps: (s.total_steps as number | null) ?? null,
      sleepSeconds: (s.total_sleep_duration as number | null) ?? null,
      restingHr: (s.resting_hr as number | null) ?? null,
      sessionType: (s.session_type as string | null) ?? null,
      distanceKm: (s.total_distance_km as number | null) ?? null,
      durationMinutes: (s.duration_minutes as number | null) ?? null,
    })),
    memories: ((memories ?? []) as Array<{ fact: string }>).map((m) => m.fact),
  };
}

/** Save something the patient told Buddy about their life. Never throws. */
export async function rememberFact(admin: Admin, clientId: string, fact: string): Promise<void> {
  const a = admin as unknown as { from: (t: string) => any };
  try {
    const { data } = await a
      .from("patient_memory")
      .select("id, fact")
      .eq("client_id", clientId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(40);
    const rows = (data ?? []) as Array<{ id: string; fact: string }>;
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (rows.some((r) => norm(r.fact) === norm(fact))) return;
    await a.from("patient_memory").insert({ client_id: clientId, fact });
    // Keep the 30 most recent; older ones are archived, not deleted.
    const stale = rows.slice(29).map((r) => r.id);
    if (stale.length) {
      await a.from("patient_memory").update({ archived_at: new Date().toISOString() }).in("id", stale);
    }
  } catch {
    /* memory is best effort */
  }
}
