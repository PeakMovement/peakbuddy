import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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

function ruleMatch(programs: ProgramRow[], tags: string[], pain: number) {
  let best: { program: ProgramRow; score: number } | null = null;
  for (const p of programs) {
    if (p.pain_min != null && pain < p.pain_min) continue;
    if (p.pain_max != null && pain > p.pain_max) continue;
    const overlap = p.symptom_tags.filter((t) => tags.includes(t)).length;
    if (overlap === 0) continue;
    const score = overlap * 100 + p.priority;
    if (!best || score > best.score) best = { program: p, score };
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
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("programs")
      .select("id, name, description, external_url, image_url, symptom_tags, pain_min, pain_max, priority")
      .eq("active", true);
    if (error || !rows || rows.length === 0) return null;

    const programs = rows as ProgramRow[];
    const tags = deriveTags(data);

    const ruled = ruleMatch(programs, tags, data.pain);
    if (ruled) {
      const reason =
        tags.length > 0
          ? `Matched your check-in (${tags.slice(0, 3).join(", ")}).`
          : "Suggested based on your check-in.";
      return {
        program: {
          id: ruled.id,
          name: ruled.name,
          description: ruled.description,
          external_url: ruled.external_url,
          image_url: ruled.image_url,
        },
        reason,
        source: "rules" as const,
      };
    }

    const ai = await aiFallback(programs, data);
    if (!ai) return null;
    return {
      program: {
        id: ai.program.id,
        name: ai.program.name,
        description: ai.program.description,
        external_url: ai.program.external_url,
        image_url: ai.program.image_url,
      },
      reason: ai.reason,
      source: "ai" as const,
    };
  });
