/**
 * Replying in the patient's language (28 Oct 2026).
 *
 * Buddy's own wording is written in English. When a patient asks for
 * Afrikaans or isiXhosa (or clearly writes in it), the preference is saved
 * on the client (migration 0048) and each reply is translated by Claude just
 * before it is sent. Button ids never change, so taps still work.
 *
 * Safety: next to a red flag, the English stays underneath the translation,
 * so nothing urgent depends on a translation being right. If translation
 * fails, the English goes out. Only for patients who agreed to AI.
 */
import { log } from "@/lib/log";

export type Lang = "en" | "af" | "xh" | "zu";

const NAME: Record<Exclude<Lang, "en">, string> = {
  af: "Afrikaans",
  xh: "isiXhosa",
  zu: "isiZulu",
};

/** "Afrikaans asseblief", "can you speak xhosa", "English please". */
export function explicitLanguage(text: string): Lang | null {
  const t = String(text ?? "").toLowerCase();
  if (t.length > 160) return null;
  const ask =
    /\b(please|asseblief|plz|pls|can you|could you|kan jy|praat|speak|reply|answer|write|in|use|switch to|change to|ndicela|khuluma|thetha)\b/;
  if (/\bafrikaans\b/.test(t) && (ask.test(t) || t.trim() === "afrikaans")) return "af";
  if (/\b(isi)?xhosa\b/.test(t) && (ask.test(t) || /^(isi)?xhosa$/.test(t.trim()))) return "xh";
  if (/\b(isi)?zulu\b/.test(t) && (ask.test(t) || /^(isi)?zulu$/.test(t.trim()))) return "zu";
  if (/\benglish\b/.test(t) && (ask.test(t) || t.trim() === "english" || /\bengels\b/.test(t)))
    return "en";
  if (/\bengels\b/.test(t)) return "en";
  return null;
}

const AF_WORDS =
  /\b(ek|jy|jou|is|nie|baie|goed|sleg|seer|vandag|gister|asseblief|dankie|my|het|was|maar|ook|nog|hoe|wat|waar|slaap|pyn|moeg|bietjie|beter|erger|lekker|hallo|môre|more|middag|aand|oefeninge|skouer|knie|rug|enkel|nek|voel|gaan|dit|dat|die|en|van|vir|met)\b/gi;
const AF_STRONG =
  /\b(nie|baie|seer|vandag|gister|asseblief|dankie|slaap|pyn|moeg|bietjie|erger|lekker|môre|oefeninge|skouer|knie|voel|gaan|die)\b/gi;
const XH_STRONG =
  /\b(molo|molweni|enkosi|ndiyabulela|ndi|andi|kakhulu|intlungu|ndilele|ndiphilile|namhlanje|izolo|ewe|hayi|unjani|ndisaphila|ndicela|qha)\w*/gi;
const EN_STRONG =
  /\b(the|and|my|is|it|i'm|im|was|have|had|today|yesterday|pain|slept|sleep|feel|feeling|good|bad|thanks|thank|please|what|how|can|you)\b/gi;

/** A clear read of one message, or null when it is short or mixed. */
export function detectLanguage(text: string): Lang | null {
  const t = String(text ?? "").trim();
  if (t.split(/\s+/).length < 3) return null;
  const xh = (t.match(XH_STRONG) ?? []).length;
  if (xh >= 2) return "xh";
  const afStrong = (t.match(AF_STRONG) ?? []).length;
  const af = (t.match(AF_WORDS) ?? []).length;
  const en = (t.match(EN_STRONG) ?? []).filter((w) => !/^(my|is)$/i.test(w)).length;
  if (afStrong >= 2 && af > en * 2) return "af";
  if (en >= 3 && afStrong === 0 && xh === 0) return "en";
  return null;
}

type Reply =
  | { kind: "text"; body: string }
  | { kind: "buttons"; body: string; buttons: Array<{ id: string; title: string }> }
  | {
      kind: "list";
      body: string;
      buttonLabel: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }
  | { kind: string; [k: string]: unknown };

interface Piece {
  body: string;
  labels: string[];
}

function piecesOf(replies: Reply[]): Piece[] {
  return replies.map((r) => {
    if (r.kind === "buttons") {
      const b = r as Extract<Reply, { kind: "buttons" }>;
      return { body: b.body, labels: b.buttons.map((x) => x.title) };
    }
    if (r.kind === "list") {
      const l = r as Extract<Reply, { kind: "list" }>;
      return { body: l.body, labels: [l.buttonLabel, ...l.rows.map((x) => x.title)] };
    }
    if (r.kind === "text") return { body: (r as { body: string }).body, labels: [] };
    return { body: "", labels: [] };
  });
}

/** Puts translated text back, keeping ids, kinds and WhatsApp length limits. */
export function applyTranslation<T extends Reply>(
  replies: T[],
  translated: Piece[],
  keepEnglish: boolean,
): T[] {
  return replies.map((r, i) => {
    const tr = translated[i];
    if (!tr || !tr.body?.trim()) return r;
    const body = (en: string) =>
      keepEnglish
        ? `${tr.body.trim()}\n\n(English: ${en})`.slice(0, 1024)
        : tr.body.trim().slice(0, 4096);
    if (r.kind === "text") return { ...r, body: body((r as { body: string }).body) };
    if (r.kind === "buttons") {
      const b = r as unknown as Extract<Reply, { kind: "buttons" }>;
      return {
        ...r,
        body: body(b.body).slice(0, 1024),
        buttons: b.buttons.map((x, j) => ({
          ...x,
          title: (tr.labels[j] || x.title).slice(0, 20),
        })),
      };
    }
    if (r.kind === "list") {
      const l = r as unknown as Extract<Reply, { kind: "list" }>;
      return {
        ...r,
        body: body(l.body).slice(0, 1024),
        buttonLabel: (tr.labels[0] || l.buttonLabel).slice(0, 20),
        rows: l.rows.map((x, j) => ({ ...x, title: (tr.labels[j + 1] || x.title).slice(0, 24) })),
      };
    }
    return r;
  });
}

/** Translate a batch of replies in one call. English on any failure. */
export async function translateReplies<T extends Reply>(
  replies: T[],
  lang: Lang,
  opts: { keepEnglish: boolean },
): Promise<T[]> {
  if (lang === "en" || !replies.length) return replies;
  const pieces = piecesOf(replies);
  if (!pieces.some((p) => p.body.trim())) return replies;
  try {
    const { aiChat } = await import("@/lib/ai-chat.server");
    const res = await aiChat(
      {
        messages: [
          {
            role: "system",
            content: `Translate WhatsApp messages from a physiotherapy practice's assistant into ${NAME[lang]}. Plain, warm, everyday ${NAME[lang]} as people in South Africa speak it. Keep names, numbers, scales ("0 to 10"), links, times and dates exactly as they are. Do not add, drop or soften anything, and add no advice. Button labels must stay under 20 characters. Return JSON: {"items":[{"body":"...","labels":["..."]}]} with the same number of items and labels, in the same order.`,
          },
          { role: "user", content: JSON.stringify({ items: pieces }) },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 2000,
      },
      { timeoutMs: 12_000, label: "translate", claudeOnly: false },
    );
    if (!res.ok) return replies;
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}") as { items?: Piece[] };
    const items = parsed.items ?? [];
    if (items.length !== pieces.length) return replies;
    for (let i = 0; i < items.length; i++) {
      if ((items[i].labels ?? []).length !== pieces[i].labels.length)
        items[i].labels = pieces[i].labels;
    }
    return applyTranslation(replies, items, opts.keepEnglish);
  } catch (e) {
    log.warn("translate replies failed", { lang, error: e instanceof Error ? e.name : "unknown" });
    return replies;
  }
}

/** The saved preference, or null (English). Works before migration 0048. */
export async function loadLanguage(adminIn: unknown, clientId: string): Promise<Lang | null> {
  const admin = adminIn as { from: (t: string) => any };
  try {
    const { data, error } = await admin
      .from("clients")
      .select("preferred_language")
      .eq("id", clientId)
      .maybeSingle();
    if (error) return null;
    const v = (data as { preferred_language?: string | null } | null)?.preferred_language;
    return v === "af" || v === "xh" || v === "zu" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

export async function saveLanguage(adminIn: unknown, clientId: string, lang: Lang): Promise<void> {
  const admin = adminIn as { from: (t: string) => any };
  try {
    await admin
      .from("clients")
      .update({ preferred_language: lang === "en" ? null : lang })
      .eq("id", clientId);
  } catch {
    /* before migration 0048 the preference just isn't kept */
  }
}

/**
 * Which language to answer this message in, and whether the preference
 * changed. An explicit ask wins; then a clear read of this message changes
 * a saved preference; otherwise the saved one.
 */
export function chooseLanguage(
  saved: Lang | null,
  text: string,
): { lang: Lang; save: Lang | null } {
  const asked = explicitLanguage(text);
  if (asked) return { lang: asked, save: asked };
  const seen = detectLanguage(text);
  if (seen && seen !== "en" && seen !== saved) return { lang: seen, save: seen };
  if (seen === "en" && saved && saved !== "en") return { lang: "en", save: "en" };
  return { lang: saved ?? "en", save: null };
}
