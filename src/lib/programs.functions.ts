import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  pain: z.number().min(0).max(10),
  sleep: z.number().min(0).max(10).nullable().optional(),
  stress: z.number().min(0).max(10).nullable().optional(),
  energy: z.number().min(0).max(10).nullable().optional(),
  mood: z.number().min(0).max(10).nullable().optional(),
  notes: z.string().max(2000).optional().default(""),
  clientId: z.string().uuid().nullable().optional(),
});

type ProgramRow = {
  id: string;
  name: string;
  description: string;
  external_url: string;
  image_url: string | null;
  symptom_tags: string[];
  pain_min: number | null;
  pain_max: number | null;
  priority: number;
};

const KEYWORDS: Record<string, string[]> = {
  back: ["back", "spine", "lumbar"],
  "lower-back": ["lower back", "low back", "lumbar"],
  neck: ["neck", "cervical"],
  knee: ["knee"],
  shoulder: ["shoulder"],
  hip: ["hip", "hips", "glute"],
  headache: ["headache", "migraine"],
  sleep: ["sleep", "insomnia", "tired", "exhausted"],
  stress: ["stress", "anxious", "anxiety", "overwhelm"],
  mood: ["sad", "depressed", "low mood"],
  energy: ["fatigue", "no energy", "drained"],
  posture: ["posture", "slouch", "hunched"],
  "desk-worker": ["desk", "sitting", "office", "computer"],
  mobility: ["stiff", "stiffness", "mobility", "tight"],
  flexibility: ["flexibility", "inflexible"],
  "chronic-pain": ["chronic", "ongoing pain", "persistent pain"],
  "post-injury": ["injury", "injured", "recovering", "surgery"],
  "core-strength": ["core", "weak core", "abs"],
  cardio: ["cardio", "out of shape", "endurance"],
};

function deriveTags(input: z.infer<typeof InputSchema>): string[] {
  const tags = new Set<string>();
  const notes = (input.notes ?? "").toLowerCase();
  for (const [tag, words] of Object.entries(KEYWORDS)) {
    if (words.some((w) => notes.includes(w))) tags.add(tag);
  }
  if (input.pain >= 7) tags.add("high-pain");
  if (input.sleep != null && input.sleep <= 2) tags.add("sleep");
  if (input.stress != null && input.stress >= 4) tags.add("stress");
  if (input.energy != null && input.energy <= 2) tags.add("energy");
  if (input.mood != null && input.mood <= 2) tags.add("mood");
  return [...tags];
}

function scoreProgram(p: ProgramRow, tags: string[], pain: number): number {
  if (p.pain_min != null && pain < p.pain_min) return 0;
  if (p.pain_max != null && pain > p.pain_max) return 0;
  const overlap = p.symptom_tags.filter((t) => tags.includes(t)).length;
  if (overlap === 0) return 0;
  return overlap * 100 + p.priority;
}

function ruleMatch(programs: ProgramRow[], tags: string[], pain: number, minOverlap: number) {
  let best: { program: ProgramRow; score: number; overlap: number } | null = null;
  for (const p of programs) {
    const score = scoreProgram(p, tags, pain);
    if (score === 0) continue;
    const overlap = p.symptom_tags.filter((t) => tags.includes(t)).length;
    if (overlap < minOverlap) continue;
    if (!best || score > best.score) best = { program: p, score, overlap };
  }
  return best?.program ?? null;
}

async function aiFallback(
  programs: ProgramRow[],
  input: z.infer<typeof InputSchema>,
): Promise<{ program: ProgramRow; reason: string } | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key || programs.length === 0) return null;

  const list = programs.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    tags: p.symptom_tags,
  }));

  const prompt = `A patient just submitted a daily check-in:
- Pain: ${input.pain}/10
- Sleep: ${input.sleep ?? "n/a"}
- Stress: ${input.stress ?? "n/a"}
- Energy: ${input.energy ?? "n/a"}
- Mood: ${input.mood ?? "n/a"}
- Notes: ${input.notes || "(none)"}

Pick the single best-fit program for them from this list (return its exact id). If nothing fits, return null id.
Programs: ${JSON.stringify(list)}

Respond ONLY with strict JSON: {"program_id": "<id or null>", "reason": "<one short sentence>"}`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(content) as { program_id?: string | null; reason?: string };
    if (!parsed.program_id) return null;
    const program = programs.find((p) => p.id === parsed.program_id);
    if (!program) return null;
    return { program, reason: parsed.reason || "Suggested based on your check-in." };
  } catch {
    return null;
  }
}

export const suggestProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    if (!data.clientId) return null;

    const { isProgramsFeatureEnabled, isProgramsSuggestEnabledForPractitioner } =
      await import("@/lib/client-program.functions");
    if (!(await isProgramsFeatureEnabled())) return null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Only queue a new suggestion if the client doesn't already have one in flight.
    const { data: clientRow } = await supabaseAdmin
      .from("clients")
      .select("auth_user_id, practitioner_id, program_status, suggested_program_id, yves_ai_consent")
      .eq("id", data.clientId)
      .maybeSingle();
    const cur = clientRow as {
      auth_user_id: string | null;
      practitioner_id: string;
      program_status: string;
      suggested_program_id: string | null;
      yves_ai_consent: boolean | null;
    } | null;
    if (!cur) return null;

    // Authz: only the client themselves, their practitioner, or a super admin.
    if (cur.auth_user_id !== context.userId && cur.practitioner_id !== context.userId) {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", context.userId)
        .maybeSingle();
      if ((prof as { role?: string } | null)?.role !== "super_admin") return null;
    }

    // Per-practitioner gate: super admin can disable suggestions for this
    // practitioner, which cascades to all of their clients.
    if (!(await isProgramsSuggestEnabledForPractitioner(cur.practitioner_id))) return null;
    const canQueue =
      cur.program_status === "none" ||
      (cur.program_status === "declined" && cur.suggested_program_id == null);
    if (!canQueue) return null;

    const { data: rows, error } = await supabaseAdmin
      .from("programs")
      .select(
        "id, name, description, external_url, image_url, symptom_tags, pain_min, pain_max, priority",
      )
      .eq("active", true)
      .eq("approved_by_admin", true);
    if (error || !rows || rows.length === 0) return null;

    const programs = rows as ProgramRow[];
    const tags = deriveTags(data);

    // 1) Strong rule match first
    const minOverlap = data.pain >= 7 ? 1 : 2;
    const ruled = ruleMatch(programs, tags, data.pain, minOverlap);
    let chosenId: string | null = ruled?.id ?? null;
    let source: "auto_rules" | "auto_ai" | null = ruled ? "auto_rules" : null;

    // 2) AI fallback for high-pain check-ins — ONLY with the patient's explicit
    // AI consent, since this path sends check-in data to a third-party AI
    // provider (Google, via the Lovable AI gateway). No consent => no AI call.
    if (!chosenId && data.pain >= 7 && cur.yves_ai_consent === true) {
      const ai = await aiFallback(programs, data);
      if (ai) {
        chosenId = ai.program.id;
        source = "auto_ai";
      }
    }

    if (!chosenId || !source) return null;

    await supabaseAdmin
      .from("clients")
      .update({
        suggested_program_id: chosenId,
        program_status: "awaiting_practitioner",
        program_suggested_by: source,
        program_suggested_at: new Date().toISOString(),
        program_decided_at: null,
        program_reminder_snoozed_until: null,
      })
      .eq("id", data.clientId)
      .in("program_status", ["none", "declined"]);

    // Client UI no longer shows a suggestion card directly — practitioner approves first.
    return null;
  });
