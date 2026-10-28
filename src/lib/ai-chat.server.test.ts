import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiChat, toAnthropicRequest, toOpenAiReply } from "./ai-chat.server";

const saved = { ...process.env };

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.LOVABLE_API_KEY;
});

afterEach(() => {
  process.env = { ...saved };
  vi.unstubAllGlobals();
});

describe("toAnthropicRequest", () => {
  it("moves system text out, maps tools and tool_choice, and asks for JSON", () => {
    const req = toAnthropicRequest(
      {
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "hi" },
          { role: "user", content: "again" },
          { role: "assistant", content: "hello" },
        ],
        tools: [
          {
            type: "function",
            function: { name: "pick", description: "Pick one", parameters: { type: "object" } },
          },
        ],
        tool_choice: "required",
        response_format: { type: "json_object" },
      },
      "claude-x",
    );
    expect(req.model).toBe("claude-x");
    expect(String(req.system)).toContain("Be brief.");
    expect(String(req.system)).toContain("valid JSON object");
    expect(req.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "hi" },
          { type: "text", text: "again" },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
    ]);
    expect(req.tools).toEqual([
      { name: "pick", description: "Pick one", input_schema: { type: "object" } },
    ]);
    expect(req.tool_choice).toEqual({ type: "any" });
  });

  it("sends images and PDFs as Claude blocks", () => {
    const req = toAnthropicRequest(
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "read these" },
              { type: "image_url", image_url: { url: "data:image/jpg;base64,AAA" } },
              { type: "image_url", image_url: { url: "data:application/pdf;base64,BBB" } },
            ],
          },
        ],
      },
      "m",
    );
    const blocks = (req.messages as Array<{ content: unknown[] }>)[0].content;
    expect(blocks[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AAA" },
    });
    expect(blocks[2]).toEqual({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "BBB" },
    });
  });

  it("a named tool choice stays named", () => {
    const req = toAnthropicRequest(
      {
        messages: [{ role: "user", content: "x" }],
        tools: [{ type: "function", function: { name: "a" } }],
        tool_choice: { type: "function", function: { name: "a" } },
      },
      "m",
    );
    expect(req.tool_choice).toEqual({ type: "tool", name: "a" });
  });
});

describe("toOpenAiReply", () => {
  it("returns tool calls and fenced JSON the way the gateway did", () => {
    const tools = toOpenAiReply(
      { content: [{ type: "tool_use", id: "t1", name: "pick", input: { n: 1 } }] },
      false,
    ) as { choices: Array<{ message: { tool_calls: unknown[] } }> };
    expect(tools.choices[0].message.tool_calls).toEqual([
      { id: "t1", type: "function", function: { name: "pick", arguments: '{"n":1}' } },
    ]);
    const json = toOpenAiReply(
      { content: [{ type: "text", text: '```json\n{"a":1}\n```' }] },
      true,
    ) as { choices: Array<{ message: { content: string } }> };
    expect(json.choices[0].message.content).toBe('{"a":1}');
  });
});

describe("aiChat", () => {
  const body = {
    model: "google/gemini-2.5-flash",
    messages: [{ role: "user" as const, content: "hi" }],
  };

  it("uses Claude when it answers, and never calls the gateway", async () => {
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.LOVABLE_API_KEY = "l";
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      return new Response(
        JSON.stringify({ model: "claude-x", content: [{ type: "text", text: "hello" }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await aiChat(body);
    const j = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    expect(j.choices[0].message.content).toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the gateway when Claude fails", async () => {
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.LOVABLE_API_KEY = "l";
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes("anthropic")) return new Response("{}", { status: 529 });
        return new Response(JSON.stringify({ choices: [{ message: { content: "gw" } }] }), {
          status: 200,
        });
      }),
    );
    const res = await aiChat(body);
    expect(res.ok).toBe(true);
    expect(urls).toEqual([
      "https://api.anthropic.com/v1/messages",
      "https://ai.gateway.lovable.dev/v1/chat/completions",
    ]);
  });

  it("audio goes straight to the gateway", async () => {
    process.env.ANTHROPIC_API_KEY = "a";
    process.env.LOVABLE_API_KEY = "l";
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response("{}", { status: 200 });
      }),
    );
    await aiChat({
      messages: [
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: "x", format: "ogg" } }],
        },
      ],
    });
    expect(urls).toEqual(["https://ai.gateway.lovable.dev/v1/chat/completions"]);
  });

  it("no keys: a failed response, no network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await aiChat(body);
    expect(res.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
