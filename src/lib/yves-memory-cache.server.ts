// Server-only cache for active Yves memory rules. Keyed by scope union.
// Short TTL keeps high-volume triage off the DB, and publish/rollback flush.
import type { SupabaseClient } from "@supabase/supabase-js";

export type YvesMemoryRule = {
  scope: string;
  rule_type: string;
  title: string;
  rule_text: string;
};

type Entry = { at: number; rules: YvesMemoryRule[] };
const CACHE = new Map<string, Entry>();
const TTL_MS = 60_000;

let cachedVersion: { at: number; version: number } | null = null;

function cacheKey(scopes: string[]): string {
  return [...new Set(scopes)].sort().join("|");
}

export async function getActiveYvesMemoryCached(
  db: SupabaseClient,
  scope: string,
): Promise<YvesMemoryRule[]> {
  const scopes = scope === "global" ? ["global"] : ["global", scope];
  return getActiveYvesMemoryForScopesCached(db, scopes);
}

export async function getActiveYvesMemoryForScopesCached(
  db: SupabaseClient,
  scopes: string[],
): Promise<YvesMemoryRule[]> {
  const key = cacheKey(scopes);
  const now = Date.now();
  const hit = CACHE.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.rules;

  const { data, error } = await db
    .from("yves_memory")
    .select("scope, rule_type, title, rule_text")
    .eq("is_active", true)
    .in("scope", [...new Set(scopes)])
    .order("rule_type", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rules = (data ?? []) as YvesMemoryRule[];
  CACHE.set(key, { at: now, rules });
  return rules;
}

export async function getLatestYvesMemoryVersionCached(
  db: SupabaseClient,
): Promise<number> {
  const now = Date.now();
  if (cachedVersion && now - cachedVersion.at < TTL_MS) return cachedVersion.version;
  const { data } = await db
    .from("yves_memory_versions")
    .select("version_number")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (data as { version_number?: number } | null)?.version_number ?? 0;
  cachedVersion = { at: now, version };
  return version;
}

export function invalidateYvesMemoryCache(): void {
  CACHE.clear();
  cachedVersion = null;
}
