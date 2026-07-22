import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { INSIGHT_SYSTEM_PROMPT, buildInsightPayload } from "@/lib/data-hub-insight.prompt";
import { buildYvesSystemPrompt, type YvesScope } from "@/lib/yves-identity";

const MODEL = "google/gemini-3.1-pro-preview";

export const YVES_TEACH_FOCUSES = [
  "General overview",
  "Pain & symptoms",
  "Sleep & recovery",
  "Training load",
  "Risk factors",
] as const;
export type YvesTeachFocus = (typeof YVES_TEACH_FOCUSES)[number];

const FOCUS_SCOPE: Record<string, YvesScope | undefined> = {
  "General overview": undefined,
  "Pain & symptoms": "pain_symptoms",
  "Sleep & recovery": "sleep",
  "Training load": "wearable",
  "Risk factors": "risk",
};

const Input = z.object({
  mode: z.enum(["client", "scenario"]),
  clientId: z.string().uuid().nullable().optional(),
  scenarioText: z.string().max(4000).nullable().optional(),
  focus: z.string().max(80),
  question: z.string().min(1).max(2000),
  sessionId: z.string().min(1).max(120),
});

async function assertSuperAdmin(sb: SupabaseClient, userId: string) {
  const { data } = await sb.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (!data || (data as { role?: string }).role !== "super_admin") throw new Error("Forbidden");
}

export const askYves = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<{
    answer: string;
    feedbackId: string | null;
    memoryVersion: number;
    model: string;
    generatedAt: string;
  }> => {
    await assertSuperAdmin(context.supabase, context.userId);

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI is not configured (missing LOVABLE_API_KEY).");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;

    const extraScope = FOCUS_SCOPE[data.focus];
    const scopesToLoad = Array.from(new Set(["global", "insight", ...(extraScope ? [extraScope] : [])]));

    // Load memory + latest version.
    const [memRes, verRes] = await Promise.all([
      db.from("yves_memory")
        .select("scope, rule_type, title, rule_text")
        .eq("is_active", true)
        .in("scope", scopesToLoad)
        .order("rule_type", { ascending: true })
        .order("created_at", { ascending: true }),
      db.from("yves_memory_versions")
        .select("version_number")
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const memoryRules = (memRes.data ?? []) as Array<{ scope: string; rule_type: string; title: string; rule_text: string }>;
    const memoryVersion = ((verRes.data as { version_number?: number } | null)?.version_number) ?? 0;

    // Build the user turn.
    let userMsg = "";
    if (data.mode === "client") {
      if (!data.clientId) throw new Error("clientId is required in client mode");
      const [clientRes, wearablesRes, sessionsRes, checkInsRes, symptomsRes, alertsRes, baselineRes, patternsRes] = await Promise.all([
        db.from("clients").select("*").eq("id", data.clientId).maybeSingle(),
        db.from("wearable_tokens").select("provider, status, connected, device_model, garmin_device_model").eq("client_id", data.clientId),
        db.from("wearable_sessions").select("*").eq("client_id", data.clientId).order("date", { ascending: false }).limit(90),
        db.from("check_ins").select("*").eq("client_id", data.clientId).order("created_at", { ascending: false }).limit(90),
        db.from("symptom_queries").select("*").eq("client_id", data.clientId).order("created_at", { ascending: false }).limit(30),
        db.from("alerts").select("*").eq("client_id", data.clientId).order("created_at", { ascending: false }).limit(30),
        db.from("client_baselines").select("*").eq("client_id", data.clientId).maybeSingle(),
        db.from("client_patterns").select("*").eq("client_id", data.clientId).order("created_at", { ascending: false }).limit(20),
      ]);
      if (!clientRes.data) throw new Error("Client not found");

      const payload = buildInsightPayload({
        client: clientRes.data as Record<string, unknown> as never,
        wearables: (wearablesRes.data ?? []) as never,
        wearableSessions: (sessionsRes.data ?? []) as never,
        checkIns: (checkInsRes.data ?? []) as never,
        symptomQueries: (symptomsRes.data ?? []) as never,
        alerts: (alertsRes.data ?? []) as never,
        riskScores: [],
        baseline: (baselineRes.data ?? null) as never,
        patterns: (patternsRes.data ?? []) as never,
      });

      userMsg = [
        `Teaching console (client mode). Focus: ${data.focus}.`,
        "Answer the practitioner's question below using the client's real live data.",
        "Cite specific metrics/windows. If the metric is unavailable, say so.",
        "",
        `QUESTION: ${data.question}`,
        "",
        "CLIENT_DATA_JSON:",
        JSON.stringify(payload),
      ].join("\n");
    } else {
      if (!data.scenarioText || !data.scenarioText.trim()) {
        throw new Error("scenarioText is required in scenario mode");
      }
      userMsg = [
        `Teaching console (scenario mode). Focus: ${data.focus}.`,
        "No live client data is attached. Reason only from the scenario description.",
        "Name any information you would need but do not have.",
        "",
        `SCENARIO:\n${data.scenarioText.trim()}`,
        "",
        `QUESTION: ${data.question}`,
      ].join("\n");
    }

    const systemPrompt = buildYvesSystemPrompt({
      base: INSIGHT_SYSTEM_PROMPT,
      scope: "insight",
      memoryRules,
      extraScopes: extraScope ? [extraScope] : [],
    });

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("AI is rate-limited. Please try again in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace billing.");
      throw new Error(`AI request failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!answer) throw new Error("AI returned an empty response.");

    // Sanitised context — never store raw patient values.
    const testContext: Record<string, unknown> = {
      mode: data.mode,
      focus: data.focus,
      memory_version: memoryVersion,
      model: MODEL,
    };
    if (data.mode === "client" && data.clientId) testContext.clientId = data.clientId;

    let feedbackId: string | null = null;
    try {
      const ins = await db.from("yves_feedback_log").insert({
        admin_id: context.userId,
        session_id: data.sessionId,
        scope: extraScope ?? "insight",
        question: data.question,
        yves_answer: answer,
        test_context: testContext,
      }).select("id").maybeSingle();
      feedbackId = (ins.data as { id?: string } | null)?.id ?? null;
    } catch { /* logging is best-effort */ }

    return {
      answer,
      feedbackId,
      memoryVersion,
      model: MODEL,
      generatedAt: new Date().toISOString(),
    };
  });

// Thumbs-up: mark a feedback row as a positive example. Corrections-to-memory
// live in a later prompt; this only tags the row for future harvesting.
export const markYvesFeedbackPositive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ feedbackId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;
    const { error } = await db
      .from("yves_feedback_log")
      .update({ admin_correction: "__positive_example__" })
      .eq("id", data.feedbackId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Memory panel reads (super-admin only). Read-only shapes for the right column.
export const getYvesMemoryPanel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{
    published: Array<{ id: string; scope: string; rule_type: string; title: string; rule_text: string; updated_at: string }>;
    staging: Array<{ id: string; scope: string; rule_type: string; title: string; rule_text: string; status: string; conflict_flags: string | null; created_at: string }>;
    versions: Array<{ id: string; version_number: number; note: string | null; created_at: string }>;
  }> => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;

    const [pubRes, stgRes, verRes] = await Promise.all([
      db.from("yves_memory")
        .select("id, scope, rule_type, title, rule_text, updated_at")
        .eq("is_active", true)
        .order("scope", { ascending: true })
        .order("rule_type", { ascending: true }),
      db.from("yves_memory_staging")
        .select("id, scope, rule_type, title, rule_text, status, conflict_flags, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      db.from("yves_memory_versions")
        .select("id, version_number, note, created_at")
        .order("version_number", { ascending: false })
        .limit(50),
    ]);

    return {
      published: (pubRes.data ?? []) as never,
      staging: ((stgRes.data ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: r.id as string,
        scope: r.scope as string,
        rule_type: r.rule_type as string,
        title: r.title as string,
        rule_text: r.rule_text as string,
        status: r.status as string,
        conflict_flags: r.conflict_flags == null ? null : JSON.stringify(r.conflict_flags),
        created_at: r.created_at as string,
      })),
      versions: (verRes.data ?? []) as never,
    };
  });

// ============================================================================
// proposeYvesRule — turn an admin correction into a candidate memory rule.
// Two mandatory safety gates before anything is staged:
//   1. Regex sanitiser (emails, long digit runs, id-like tokens, dated events).
//   2. Model classifier for patient-identifiable info.
// Then conflict detection against active rules of the same scope.
// ============================================================================

const RULE_TYPES = ["reasoning", "phrasing", "safety", "escalation", "style"] as const;
type RuleType = (typeof RULE_TYPES)[number];

const ProposeInput = z.object({
  feedbackId: z.string().uuid(),
  correction: z.string().min(4).max(4000),
  focus: z.string().max(80),
});

type DraftRule = {
  title: string;
  rule_type: RuleType;
  scope: string;
  rule_text: string;
  rationale: string;
};

async function chat(key: string, system: string, user: string): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("AI is rate-limited. Please try again in a moment.");
    if (res.status === 402) throw new Error("AI credits exhausted. Add credits in workspace billing.");
    throw new Error(`AI request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() ?? "";
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Model did not return JSON.");
  return JSON.parse(body.slice(start, end + 1));
}

// Regex sanitiser. Returns a reason string if it fails, else null.
function regexSanitise(text: string): string | null {
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return "Contains an email address.";
  if (/\b\d{6,}\b/.test(text)) return "Contains a long numeric sequence (possible ID or record number).";
  // South African ID-number-like tokens (13 digits, possibly spaced).
  if (/\b\d{2}\s?\d{2}\s?\d{2}\s?\d{4}\s?\d{3}\b/.test(text)) return "Contains an ID-number-like token.";
  // A specific calendar date tied to an individual (YYYY-MM-DD or DD/MM/YYYY).
  if (/\b(19|20)\d{2}-\d{2}-\d{2}\b/.test(text)) return "Contains a specific calendar date.";
  if (/\b\d{2}\/\d{2}\/(19|20)\d{2}\b/.test(text)) return "Contains a specific calendar date.";
  return null;
}

export const proposeYvesRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProposeInput.parse(input))
  .handler(async ({ data, context }): Promise<{
    ok: boolean;
    stagedId?: string;
    reason?: string;
    draft?: DraftRule;
    conflictIds?: string[];
  }> => {
    await assertSuperAdmin(context.supabase, context.userId);

    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI is not configured (missing LOVABLE_API_KEY).");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as SupabaseClient;

    // Load the feedback row to give the drafter question + previous answer context.
    const fb = await db
      .from("yves_feedback_log")
      .select("id, question, yves_answer, scope")
      .eq("id", data.feedbackId)
      .maybeSingle();
    if (!fb.data) throw new Error("Feedback row not found.");
    const feedback = fb.data as { id: string; question: string; yves_answer: string; scope: string | null };

    const focusScope = FOCUS_SCOPE[data.focus];
    const targetScope = focusScope ?? feedback.scope ?? "insight";

    // -------- Step 1: draft a generalised rule --------
    const draftSystem = [
      "You harvest reusable clinical reasoning rules for a clinician-facing AI agent (Yves).",
      "Given a practitioner's correction to a specific answer, distil it into ONE reusable rule.",
      "STRICT REQUIREMENTS:",
      "- Write a general clinical reasoning, phrasing, safety, or style rule.",
      "- Never mention a specific client, name, id, email, date, phone number, or one-off value.",
      "- Never say 'for client X do Y'. Always phrase as a general pattern.",
      "- Prefer 'When … then …' or 'Always/Never …' phrasing.",
      "Return STRICT JSON only, no prose, matching:",
      `{"title": string (max 80 chars), "rule_type": one of ${JSON.stringify(RULE_TYPES)}, "scope": string, "rule_text": string (max 600 chars), "rationale": string (max 400 chars)}`,
      `Set scope to one of: "global", "insight", "pain_symptoms", "sleep", "wearable", "risk". Choose the narrowest scope that fits.`,
      `Default scope suggestion for this correction: "${targetScope}".`,
    ].join("\n");

    const draftUser = [
      `PRACTITIONER FOCUS: ${data.focus}`,
      `ORIGINAL QUESTION: ${feedback.question}`,
      `YVES'S ANSWER: ${feedback.yves_answer}`,
      `PRACTITIONER CORRECTION: ${data.correction}`,
    ].join("\n\n");

    const draftRaw = await chat(key, draftSystem, draftUser);
    let draft: DraftRule;
    try {
      const parsed = extractJson(draftRaw) as Record<string, unknown>;
      const rt = String(parsed.rule_type ?? "");
      draft = {
        title: String(parsed.title ?? "").slice(0, 80).trim(),
        rule_type: (RULE_TYPES as readonly string[]).includes(rt) ? (rt as RuleType) : "reasoning",
        scope: String(parsed.scope ?? targetScope).trim() || targetScope,
        rule_text: String(parsed.rule_text ?? "").slice(0, 600).trim(),
        rationale: String(parsed.rationale ?? "").slice(0, 400).trim(),
      };
      if (!draft.title || !draft.rule_text) throw new Error("empty");
    } catch {
      await logAttempt(db, data.feedbackId, data.correction, "Model did not return a usable rule draft.", null);
      return { ok: false, reason: "Yves could not draft a reusable rule from that correction. Please rephrase it as a general clinical principle." };
    }

    // -------- Step 2a: regex sanitiser --------
    const combined = `${draft.title}\n${draft.rule_text}\n${draft.rationale}`;
    const regexFail = regexSanitise(combined);
    if (regexFail) {
      await logAttempt(db, data.feedbackId, data.correction, `Regex sanitiser blocked: ${regexFail}`, draft);
      return {
        ok: false,
        draft,
        reason: `Blocked: ${regexFail} Rewrite the correction as a general clinical rule (no names, ids, dates, or one-off values).`,
      };
    }

    // -------- Step 2b: model classifier --------
    const classifier = await chat(
      key,
      "You are a strict privacy classifier. Reply with STRICT JSON: {\"identifiable\": boolean, \"reason\": string}. 'identifiable' is true if the text contains any patient-identifiable information or private data about one specific client (names, emails, ids, phone numbers, dated events tied to a person, or otherwise references one individual rather than a general clinical pattern).",
      `Does the following candidate memory rule contain patient-identifiable information?\n\n${combined}`,
    );
    let identifiable = false;
    let classReason = "";
    try {
      const c = extractJson(classifier) as { identifiable?: boolean; reason?: string };
      identifiable = Boolean(c.identifiable);
      classReason = String(c.reason ?? "").slice(0, 240);
    } catch {
      // Fail-closed: if classifier output is unparseable, block.
      identifiable = true;
      classReason = "Classifier output was unparseable; blocking as a precaution.";
    }
    if (identifiable) {
      await logAttempt(db, data.feedbackId, data.correction, `Classifier blocked: ${classReason}`, draft);
      return {
        ok: false,
        draft,
        reason: `Blocked by privacy check: ${classReason} Please generalise the correction.`,
      };
    }

    // -------- Step 3: conflict detection --------
    const activeRes = await db
      .from("yves_memory")
      .select("id, title, rule_text")
      .eq("is_active", true)
      .eq("scope", draft.scope);
    const active = (activeRes.data ?? []) as Array<{ id: string; title: string; rule_text: string }>;

    let conflictIds: string[] = [];
    if (active.length > 0) {
      const conflictRaw = await chat(
        key,
        "You detect rule conflicts. Reply with STRICT JSON: {\"conflict_ids\": string[]} listing ids of existing rules the candidate contradicts or substantially overlaps with. Return [] if none.",
        [
          "CANDIDATE RULE:",
          JSON.stringify({ title: draft.title, rule_text: draft.rule_text }),
          "",
          "EXISTING ACTIVE RULES (same scope):",
          JSON.stringify(active),
        ].join("\n"),
      );
      try {
        const c = extractJson(conflictRaw) as { conflict_ids?: unknown[] };
        const ids = Array.isArray(c.conflict_ids) ? c.conflict_ids.map(String) : [];
        const valid = new Set(active.map((a) => a.id));
        conflictIds = ids.filter((id) => valid.has(id));
      } catch {
        conflictIds = [];
      }
    }

    // -------- Step 4: insert into staging --------
    const stagedIns = await db
      .from("yves_memory_staging")
      .insert({
        scope: draft.scope,
        rule_type: draft.rule_type,
        title: draft.title,
        rule_text: draft.rule_text,
        rationale: draft.rationale,
        status: "pending",
        proposed_by: "yves",
        source_feedback_id: data.feedbackId,
        conflict_flags: conflictIds.length ? conflictIds : null,
        created_by: context.userId,
      })
      .select("id")
      .maybeSingle();
    const stagedId = (stagedIns.data as { id?: string } | null)?.id;
    if (!stagedId) throw new Error(stagedIns.error?.message ?? "Failed to stage rule.");

    await db
      .from("yves_feedback_log")
      .update({ admin_correction: data.correction, resulted_in_staging_id: stagedId })
      .eq("id", data.feedbackId);

    return { ok: true, stagedId, draft, conflictIds };
  });

async function logAttempt(
  db: SupabaseClient,
  feedbackId: string,
  correction: string,
  reason: string,
  draft: DraftRule | null,
) {
  try {
    await db
      .from("yves_feedback_log")
      .update({
        admin_correction: `${correction}\n\n[BLOCKED] ${reason}${draft ? `\n[DRAFT] ${JSON.stringify(draft)}` : ""}`,
      })
      .eq("id", feedbackId);
  } catch { /* best-effort */ }
}
