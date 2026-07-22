import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

const MODEL = 'google/gemini-3.1-pro-preview';

export type YvesMemoryScope =
  | 'global'
  | 'insight'
  | 'triage'
  | 'pain_symptoms'
  | 'sleep'
  | 'stress'
  | 'wearable'
  | 'risk';

const RULE_TYPES = ['reasoning', 'phrasing', 'safety', 'escalation', 'style'] as const;

export const getActiveYvesMemory = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { scope: YvesMemoryScope }) => input)
  .handler(async ({ data, context }) => {
    const { getActiveYvesMemoryCached } = await import('@/lib/yves-memory-cache.server');
    return getActiveYvesMemoryCached(context.supabase, data.scope);
  });

// ============================================================================
// Shared safety + helpers
// ============================================================================

async function assertSuperAdmin(sb: SupabaseClient, userId: string) {
  const { data } = await sb.from('profiles').select('role').eq('id', userId).maybeSingle();
  if (!data || (data as { role?: string }).role !== 'super_admin') throw new Error('Forbidden');
}

function regexSanitise(text: string): string | null {
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return 'Contains an email address.';
  if (/\b\d{6,}\b/.test(text)) return 'Contains a long numeric sequence (possible ID or record number).';
  if (/\b\d{2}\s?\d{2}\s?\d{2}\s?\d{4}\s?\d{3}\b/.test(text)) return 'Contains an ID-number-like token.';
  if (/\b(19|20)\d{2}-\d{2}-\d{2}\b/.test(text)) return 'Contains a specific calendar date.';
  if (/\b\d{2}\/\d{2}\/(19|20)\d{2}\b/.test(text)) return 'Contains a specific calendar date.';
  return null;
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('Model did not return JSON.');
  return JSON.parse(body.slice(start, end + 1));
}

async function chat(key: string, system: string, user: string): Promise<string> {
  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Lovable-API-Key': key },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error('AI is rate-limited. Please try again in a moment.');
    if (res.status === 402) throw new Error('AI credits exhausted. Add credits in workspace billing.');
    throw new Error(`AI request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() ?? '';
}

async function sanitiseOrThrow(key: string, title: string, ruleText: string, rationale: string | null) {
  const combined = `${title}\n${ruleText}\n${rationale ?? ''}`;
  const regexFail = regexSanitise(combined);
  if (regexFail) throw new Error(`Blocked by privacy check: ${regexFail} Please generalise the rule.`);

  const classifier = await chat(
    key,
    'You are a strict privacy classifier. Reply with STRICT JSON: {"identifiable": boolean, "reason": string}. "identifiable" is true if the text contains any patient-identifiable information or private data about one specific client.',
    `Does the following memory rule contain patient-identifiable information?\n\n${combined}`,
  );
  let identifiable = true;
  let reason = 'Classifier output was unparseable; blocking as a precaution.';
  try {
    const c = extractJson(classifier) as { identifiable?: boolean; reason?: string };
    identifiable = Boolean(c.identifiable);
    reason = String(c.reason ?? '').slice(0, 240);
  } catch { /* keep fail-closed */ }
  if (identifiable) throw new Error(`Blocked by privacy check: ${reason}`);
}

async function snapshotActive(db: SupabaseClient, userId: string, note: string): Promise<number> {
  const [activeRes, verRes] = await Promise.all([
    db.from('yves_memory').select('*').eq('is_active', true),
    db.from('yves_memory_versions').select('version_number').order('version_number', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const active = activeRes.data ?? [];
  const nextVer = (((verRes.data as { version_number?: number } | null)?.version_number) ?? 0) + 1;
  const ins = await db.from('yves_memory_versions').insert({
    version_number: nextVer,
    snapshot: active,
    note,
    created_by: userId,
  }).select('version_number').maybeSingle();
  if (ins.error) throw new Error(ins.error.message);
  return nextVer;
}

// ============================================================================
// publishYvesRule — approve a staged candidate into live core memory.
// ============================================================================

const PublishInput = z.object({
  stagingId: z.string().uuid(),
  edits: z
    .object({
      title: z.string().min(1).max(80).optional(),
      rule_type: z.enum(RULE_TYPES).optional(),
      scope: z.string().min(1).max(40).optional(),
      rule_text: z.string().min(1).max(600).optional(),
      rationale: z.string().max(400).nullable().optional(),
    })
    .optional(),
  supersedesId: z.string().uuid().nullable().optional(),
  reviewNote: z.string().max(400).optional(),
});

export const publishYvesRule = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PublishInput.parse(input))
  .handler(async ({ data, context }): Promise<{
    ok: true;
    newRuleId: string;
    version: number;
    supersededId: string | null;
  }> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error('AI is not configured (missing LOVABLE_API_KEY).');

    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const db = supabaseAdmin as unknown as SupabaseClient;

    const stgRes = await db
      .from('yves_memory_staging')
      .select('*')
      .eq('id', data.stagingId)
      .maybeSingle();
    if (!stgRes.data) throw new Error('Staging row not found.');
    const stg = stgRes.data as {
      id: string;
      scope: string;
      rule_type: string;
      title: string;
      rule_text: string;
      rationale: string | null;
      status: string;
      conflict_flags: unknown;
    };
    if (stg.status !== 'pending') throw new Error(`Cannot approve a rule with status "${stg.status}".`);

    // Merge edits.
    const e = data.edits ?? {};
    const title = e.title ?? stg.title;
    const ruleType = e.rule_type ?? stg.rule_type;
    const scope = e.scope ?? stg.scope;
    const ruleText = e.rule_text ?? stg.rule_text;
    const rationale = e.rationale !== undefined ? e.rationale : stg.rationale;

    // Re-run sanitiser on final text.
    await sanitiseOrThrow(key, title, ruleText, rationale);

    // Resolve supersedesId. If admin didn't set one, default to the first
    // conflict-flagged id (if any) that is still active + same scope.
    let supersedesId: string | null = data.supersedesId ?? null;
    if (!supersedesId && Array.isArray(stg.conflict_flags) && stg.conflict_flags.length > 0) {
      const candidateIds = (stg.conflict_flags as unknown[]).map(String);
      const conflictRes = await db
        .from('yves_memory')
        .select('id')
        .eq('is_active', true)
        .eq('scope', scope)
        .in('id', candidateIds)
        .limit(1)
        .maybeSingle();
      supersedesId = (conflictRes.data as { id?: string } | null)?.id ?? null;
    }

    let oldVersion = 0;
    if (supersedesId) {
      const oldRes = await db
        .from('yves_memory')
        .select('version, scope')
        .eq('id', supersedesId)
        .maybeSingle();
      if (!oldRes.data) throw new Error('Superseded rule not found.');
      const old = oldRes.data as { version: number | null; scope: string };
      oldVersion = old.version ?? 1;
      const deact = await db
        .from('yves_memory')
        .update({ is_active: false })
        .eq('id', supersedesId);
      if (deact.error) throw new Error(deact.error.message);
    }

    const ins = await db
      .from('yves_memory')
      .insert({
        scope,
        rule_type: ruleType,
        title,
        rule_text: ruleText,
        rationale,
        is_active: true,
        version: supersedesId ? oldVersion + 1 : 1,
        supersedes: supersedesId,
        created_by: context.userId,
      })
      .select('id')
      .maybeSingle();
    const newRuleId = (ins.data as { id?: string } | null)?.id;
    if (!newRuleId) throw new Error(ins.error?.message ?? 'Failed to publish rule.');

    const upd = await db
      .from('yves_memory_staging')
      .update({
        status: 'approved',
        review_note: data.reviewNote ?? null,
      })
      .eq('id', data.stagingId);
    if (upd.error) throw new Error(upd.error.message);

    const version = await snapshotActive(
      db,
      context.userId,
      `Approved staged rule "${title}"${supersedesId ? ` (supersedes ${supersedesId})` : ''}`,
    );

    const { invalidateYvesMemoryCache } = await import('@/lib/yves-memory-cache.server');
    invalidateYvesMemoryCache();

    return { ok: true, newRuleId, version, supersededId: supersedesId };
  });

// ============================================================================
// rejectYvesRule — mark a candidate rejected, no memory change.
// ============================================================================

const RejectInput = z.object({
  stagingId: z.string().uuid(),
  reviewNote: z.string().max(400).optional(),
});

export const rejectYvesRule = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RejectInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const db = supabaseAdmin as unknown as SupabaseClient;
    const upd = await db
      .from('yves_memory_staging')
      .update({ status: 'rejected', review_note: data.reviewNote ?? null })
      .eq('id', data.stagingId)
      .eq('status', 'pending');
    if (upd.error) throw new Error(upd.error.message);
    return { ok: true };
  });

// ============================================================================
// rollbackYvesMemory — restore an earlier snapshot as the live active set.
// Never hard-deletes history. Writes a new version entry noting the rollback.
// ============================================================================

const RollbackInput = z.object({
  versionNumber: z.number().int().positive(),
});

type SnapshotRow = {
  id?: string;
  scope: string;
  rule_type: string;
  title: string;
  rule_text: string;
  rationale: string | null;
  version?: number | null;
  supersedes?: string | null;
};

export const rollbackYvesMemory = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => RollbackInput.parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true; newVersion: number; restoredCount: number }> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const db = supabaseAdmin as unknown as SupabaseClient;

    const verRes = await db
      .from('yves_memory_versions')
      .select('snapshot')
      .eq('version_number', data.versionNumber)
      .maybeSingle();
    if (!verRes.data) throw new Error(`Version ${data.versionNumber} not found.`);
    const snapshot = ((verRes.data as { snapshot?: unknown }).snapshot ?? []) as SnapshotRow[];
    if (!Array.isArray(snapshot)) throw new Error('Snapshot is malformed.');

    // Deactivate all currently active rules.
    const deact = await db
      .from('yves_memory')
      .update({ is_active: false })
      .eq('is_active', true);
    if (deact.error) throw new Error(deact.error.message);

    // Reactivate rows from the snapshot when the id still exists; otherwise reinsert.
    let restored = 0;
    for (const row of snapshot) {
      if (row.id) {
        const react = await db
          .from('yves_memory')
          .update({ is_active: true })
          .eq('id', row.id)
          .select('id')
          .maybeSingle();
        if (react.data) { restored += 1; continue; }
      }
      const ins = await db
        .from('yves_memory')
        .insert({
          scope: row.scope,
          rule_type: row.rule_type,
          title: row.title,
          rule_text: row.rule_text,
          rationale: row.rationale ?? null,
          is_active: true,
          version: (row.version ?? 1) + 1,
          supersedes: row.id ?? null,
          created_by: context.userId,
        })
        .select('id')
        .maybeSingle();
      if (ins.data) restored += 1;
    }

    const newVersion = await snapshotActive(
      db,
      context.userId,
      `Rollback to version ${data.versionNumber}`,
    );

    const { invalidateYvesMemoryCache } = await import('@/lib/yves-memory-cache.server');
    invalidateYvesMemoryCache();

    return { ok: true, newVersion, restoredCount: restored };
  });
