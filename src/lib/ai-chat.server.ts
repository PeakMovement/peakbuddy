/**
 * One way to call a chat model: Claude first, Lovable's gateway only if
 * Claude is not configured or fails (28 Oct 2026, Justin: "move them all onto
 * claude"). Lovable's AI has a workspace spending cap that pauses it.
 *
 * Callers keep the OpenAI-style body they already build for the gateway and
 * read the same OpenAI-style JSON back, so each call site changes one line.
 * Supported: system/user/assistant text, image_url data URLs (images and
 * PDFs), function tools with tool_choice, and response_format json_object.
 *
 * Logs model, status and token counts only. Never a prompt or a reply.
 */
import { log } from "@/lib/log";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

export const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

export type Part =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: string; [k: string]: unknown };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Part[];
}

export interface ChatTool {
  type: "function";
  function: { name: string; description?: string; parameters?: unknown };
}

export interface ChatBody {
  /** The gateway model, used only on the fallback. */
  model?: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: "auto" | "required" | "none" | { type: "function"; function: { name: string } };
  response_format?: { type: string };
  max_tokens?: number;
  temperature?: number;
  [k: string]: unknown;
}

export interface ChatOptions {
  /** Shared by both attempts. Prefer timeoutMs so a slow Claude leaves the fallback time. */
  signal?: AbortSignal;
  /** Per attempt: Claude gets this long, then the fallback gets this long. */
  timeoutMs?: number;
  /** Short label for logs, e.g. "nightly-risk". */
  label?: string;
  /** Claude model override. */
  claudeModel?: string;
  /** Skip the Lovable fallback. */
  claudeOnly?: boolean;
}

/** True when either provider is configured. */
export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.LOVABLE_API_KEY);
}

/**
 * Drop-in for `fetch(GATEWAY_URL, {...})`. Returns a Response whose JSON is
 * OpenAI-shaped. A non-ok Response means both providers failed.
 */
export async function aiChat(body: ChatBody, opts: ChatOptions = {}): Promise<Response> {
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  let lastStatus = 503;
  if (claudeKey) {
    try {
      const out = await callClaude(claudeKey, body, opts, attemptSignal(opts));
      if (out.ok) return jsonResponse(out.json, 200);
      lastStatus = out.status;
      log.warn("claude chat failed", { label: opts.label ?? "ai", status: out.status });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      log.warn("claude chat failed", {
        label: opts.label ?? "ai",
        status: 0,
        error: e instanceof Error ? e.name : "unknown",
      });
    }
  }
  const lovKey = process.env.LOVABLE_API_KEY;
  if (lovKey && !opts.claudeOnly) {
    return fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": lovKey },
      body: JSON.stringify(body),
      signal: attemptSignal(opts),
    });
  }
  return jsonResponse({ error: "no AI provider available" }, lastStatus);
}

function attemptSignal(opts: ChatOptions): AbortSignal | undefined {
  if (opts.timeoutMs) return AbortSignal.timeout(opts.timeoutMs);
  return opts.signal;
}

function jsonResponse(json: unknown, status: number): Response {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* ------------------------------------------------------------------ */

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function partToBlock(part: Part): AnthropicBlock | null {
  if (part.type === "text" && typeof (part as { text?: unknown }).text === "string") {
    return { type: "text", text: (part as { text: string }).text };
  }
  if (part.type === "image_url") {
    const url = String((part as { image_url?: { url?: string } }).image_url?.url ?? "");
    const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
    if (!m) return null;
    const mime = m[1].toLowerCase();
    if (mime === "application/pdf") {
      return { type: "document", source: { type: "base64", media_type: mime, data: m[2] } };
    }
    const media = mime === "image/jpg" ? "image/jpeg" : mime;
    if (IMAGE_TYPES.has(media)) {
      return { type: "image", source: { type: "base64", media_type: media, data: m[2] } };
    }
    return null;
  }
  return null;
}

/** Throws when a part can't be sent to Claude, so the gateway gets it whole. */
function toBlocks(content: string | Part[]): AnthropicBlock[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  const blocks: AnthropicBlock[] = [];
  for (const part of content) {
    const block = partToBlock(part);
    if (!block) throw new UnsupportedPart();
    blocks.push(block);
  }
  return blocks;
}

class UnsupportedPart extends Error {
  constructor() {
    super("unsupported content for Claude");
    this.name = "UnsupportedPart";
  }
}

export function toAnthropicRequest(body: ChatBody, model: string): Record<string, unknown> {
  const system: string[] = [];
  const messages: Array<{ role: "user" | "assistant"; content: AnthropicBlock[] }> = [];
  for (const m of body.messages) {
    if (m.role === "system") {
      system.push(typeof m.content === "string" ? m.content : textOf(m.content));
      continue;
    }
    const blocks = toBlocks(m.content);
    if (!blocks.length) continue;
    const last = messages.at(-1);
    if (last && last.role === m.role) last.content.push(...blocks);
    else messages.push({ role: m.role, content: blocks });
  }
  // Claude needs the first turn to be the user's.
  if (messages[0]?.role === "assistant") {
    messages.unshift({ role: "user", content: [{ type: "text", text: "(conversation so far)" }] });
  }
  const wantsJson = body.response_format?.type === "json_object";
  if (wantsJson) {
    system.push("Reply with one valid JSON object and nothing else: no prose, no code fences.");
  }
  const req: Record<string, unknown> = {
    model,
    max_tokens: Math.min(Math.max(Number(body.max_tokens) || 4096, 64), 8192),
    messages,
  };
  if (system.length) req.system = system.join("\n\n");
  if (typeof body.temperature === "number") req.temperature = Math.min(1, body.temperature);
  if (body.tools?.length && body.tool_choice !== "none") {
    req.tools = body.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description ?? "",
      input_schema: t.function.parameters ?? { type: "object", properties: {} },
    }));
    const tc = body.tool_choice;
    if (tc === "required") req.tool_choice = { type: "any" };
    else if (tc && typeof tc === "object")
      req.tool_choice = { type: "tool", name: tc.function.name };
    else req.tool_choice = { type: "auto" };
  }
  return req;
}

function textOf(parts: Part[]): string {
  return parts
    .map((p) => (p.type === "text" ? String((p as { text?: unknown }).text ?? "") : ""))
    .join("\n");
}

interface AnthropicReply {
  model?: string;
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Claude's reply in the gateway's shape. */
export function toOpenAiReply(json: AnthropicReply, wantsJson: boolean): Record<string, unknown> {
  const blocks = json.content ?? [];
  let text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  if (wantsJson) text = stripFences(text);
  const calls = blocks
    .filter((b) => b.type === "tool_use")
    .map((b, i) => ({
      id: b.id ?? `call_${i}`,
      type: "function",
      function: { name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) },
    }));
  return {
    model: json.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || null,
          ...(calls.length ? { tool_calls: calls } : {}),
        },
        finish_reason: calls.length ? "tool_calls" : "stop",
      },
    ],
    usage: {
      prompt_tokens: json.usage?.input_tokens ?? 0,
      completion_tokens: json.usage?.output_tokens ?? 0,
    },
  };
}

function stripFences(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

async function callClaude(
  key: string,
  body: ChatBody,
  opts: ChatOptions,
  signal: AbortSignal | undefined,
): Promise<{ ok: true; json: unknown } | { ok: false; status: number }> {
  const model = opts.claudeModel ?? CLAUDE_MODEL;
  let req: Record<string, unknown>;
  try {
    req = toAnthropicRequest(body, model);
  } catch (e) {
    if (e instanceof UnsupportedPart) return { ok: false, status: 415 };
    throw e;
  }
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) return { ok: false, status: res.status };
  const json = (await res.json()) as AnthropicReply;
  try {
    const { noteAiCall } = await import("@/lib/whatsapp/ai-usage");
    noteAiCall({
      model,
      status: res.status,
      inputTokens: json.usage?.input_tokens,
      outputTokens: json.usage?.output_tokens,
    });
  } catch {
    // Usage counts are best effort.
  }
  const out = toOpenAiReply(json, body.response_format?.type === "json_object");
  const msg = (
    out.choices as Array<{ message: { content: string | null; tool_calls?: unknown[] } }>
  )[0].message;
  if (!msg.content && !msg.tool_calls?.length) return { ok: false, status: 204 };
  return { ok: true, json: out };
}
