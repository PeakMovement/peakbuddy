// Server-only cache for active Yves memory rules. Keyed by scope union.
// Cache hits are validated against the latest memory version (short-cached), so
// a published/rolled-back rule propagates across serverless instances within a
// few seconds instead of the full TTL — important for patient-facing triage.
import type { SupabaseClient } from "@supabase/supabase-js";

export type YvesMemoryRule = {
  scope: string;
  rule_type: string;
  title: string;
  rule_text: string;
};

type Entry = { at: number; rules: YvesMemoryRule[]; version: number };
const CACHE = new Map<string, Entry>();
const TTL_MS = 60_000;
const VERSION_TTL_MS = 5_000; // how stale a rule may be across instances

let versionCache: { at: number; version: number } | null = null;

function cacheKey(scopes: string[]): string {
  return [...new Set(scopes)].sort().join("|");
}

/** Latest memory version, cached only briefly so publish/rollback show up fast. */
async function currentVersion(db: SupabaseClient): Promise<number> {
  const now = Date.now();
  if (versionCache && now - versionCache.at < VERSION_TTL_MS) return versionCache.version;
  const { data } = await db
    .from("yves_memory_versions")
    .select("version_number")
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (data as { version_number?: number } | null)?.version_number ?? 0;
  versionCache = { at: now, version };
  return version;
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
  const version = await currentVersion(db);
  const hit = CACHE.get(key);
  // Serve the cache only if it was built at the current memory version.
  if (hit && hit.version === version && now - hit.at < TTL_MS) return hit.rules;

  const { data, error } = await db
    .from("yves_memory")
    .select("scope, rule_type, title, rule_text")
    .eq("is_active", true)
    .in("scope", [...new Set(scopes)])
    .order("rule_type", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rules = (data ?? []) as YvesMemoryRule[];
  CACHE.set(key, { at: now, rules, version });
  return rules;
}

export async function getLatestYvesMemoryVersionCached(db: SupabaseClient): Promise<number> {
  return currentVersion(db);
}

export function invalidateYvesMemoryCache(): void {
  CACHE.clear();
  versionCache = null;
}
