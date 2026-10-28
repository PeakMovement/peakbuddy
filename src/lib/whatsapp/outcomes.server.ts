/**
 * Outcome scores: when one is due, what the patient named last time, and
 * saving the result (migration 0049_outcome_measures). Every read fails
 * soft: before the migration, nothing is due and nothing is offered.
 */
import { log } from "@/lib/log";
import {
  OUTCOME_EVERY_DAYS,
  psfsMean,
  type OutcomeResult,
  type OutcomeTimepoint,
} from "./outcomes";

type Db = { from: (t: string) => any };
const DAY = 86_400_000;

export async function outcomeDue(
  adminIn: unknown,
  client: { id: string; discharged_at?: string | null },
  now: Date,
): Promise<OutcomeTimepoint | null> {
  const admin = adminIn as Db;
  try {
    const { data, error } = await admin
      .from("outcome_measures")
      .select("created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) return null;
    const last = (data as Array<{ created_at: string }> | null)?.[0]?.created_at ?? null;
    if (client.discharged_at) {
      return !last || last < client.discharged_at ? "discharge" : null;
    }
    if (!last) return "intake";
    return now.getTime() - new Date(last).getTime() >= OUTCOME_EVERY_DAYS * DAY ? "followup" : null;
  } catch {
    return null;
  }
}

export async function previousActivities(adminIn: unknown, clientId: string): Promise<string[]> {
  const admin = adminIn as Db;
  try {
    const { data } = await admin
      .from("outcome_measures")
      .select("items")
      .eq("client_id", clientId)
      .eq("measure", "psfs")
      .order("created_at", { ascending: false })
      .limit(1);
    const items =
      (data as Array<{ items?: Array<{ activity?: string }> }> | null)?.[0]?.items ?? [];
    return items.map((i) => String(i.activity ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function saveOutcome(
  adminIn: unknown,
  client: { id: string; practitioner_id: string },
  result: OutcomeResult,
  now: Date,
): Promise<boolean> {
  const admin = adminIn as Db;
  const base = {
    client_id: client.id,
    practitioner_id: client.practitioner_id,
    timepoint: result.timepoint,
    source: "whatsapp",
    created_at: now.toISOString(),
  };
  const { error } = await admin.from("outcome_measures").insert([
    { ...base, measure: "nprs", score: result.nprs, items: [] },
    { ...base, measure: "psfs", score: psfsMean(result.psfs), items: result.psfs },
  ]);
  if (error) {
    log.warn("outcome save failed", { code: error.code });
    return false;
  }
  return true;
}

export async function loadOutcomes(
  adminIn: unknown,
  clientId: string,
): Promise<Array<{ measure: string; score: number; created_at: string; items: unknown }>> {
  const admin = adminIn as Db;
  try {
    const { data, error } = await admin
      .from("outcome_measures")
      .select("measure, score, created_at, items, timepoint")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (error) return [];
    return (
      (data ?? []) as Array<{
        measure: string;
        score: number | string;
        created_at: string;
        items: unknown;
      }>
    ).map((r) => ({ ...r, score: Number(r.score) }));
  } catch {
    return [];
  }
}
