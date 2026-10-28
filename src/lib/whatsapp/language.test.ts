import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTranslation,
  chooseLanguage,
  detectLanguage,
  explicitLanguage,
  translateReplies,
} from "./language.server";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("patient language", () => {
  it("hears an explicit ask", () => {
    expect(explicitLanguage("kan jy asseblief in Afrikaans praat")).toBe("af");
    expect(explicitLanguage("Afrikaans")).toBe("af");
    expect(explicitLanguage("can you speak xhosa please")).toBe("xh");
    expect(explicitLanguage("English please")).toBe("en");
    expect(explicitLanguage("my knee is sore")).toBeNull();
  });

  it("reads a clearly Afrikaans or isiXhosa message", () => {
    expect(detectLanguage("my skouer is vandag baie seer")).toBe("af");
    expect(detectLanguage("ek het nie lekker geslaap nie")).toBe("af");
    expect(detectLanguage("molo, ndiyabulela kakhulu")).toBe("xh");
    expect(detectLanguage("my knee is good today thanks")).toBe("en");
    expect(detectLanguage("ok 4")).toBeNull();
  });

  it("keeps a saved language until the patient clearly changes it", () => {
    expect(chooseLanguage("af", "4")).toEqual({ lang: "af", save: null });
    expect(chooseLanguage(null, "my skouer is vandag baie seer")).toEqual({
      lang: "af",
      save: "af",
    });
    expect(chooseLanguage("af", "English please")).toEqual({ lang: "en", save: "en" });
    expect(chooseLanguage("af", "the pain was bad yesterday and today")).toEqual({
      lang: "en",
      save: "en",
    });
  });

  it("keeps button ids, trims labels, and keeps English next to a red flag", () => {
    const out = applyTranslation(
      [
        {
          kind: "buttons" as const,
          body: "How did you sleep?",
          buttons: [{ id: "wsleep_5", title: "5 Very well" }],
        },
      ],
      [{ body: "Hoe het jy geslaap?", labels: ["5 Baie goed en lekker uitgerus"] }],
      true,
    );
    expect(out[0]).toEqual({
      kind: "buttons",
      body: "Hoe het jy geslaap?\n\n(English: How did you sleep?)",
      buttons: [{ id: "wsleep_5", title: "5 Baie goed en lekke" }],
    });
  });

  it("sends English when translation fails", async () => {
    process.env.ANTHROPIC_API_KEY = "x";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    const replies = [{ kind: "text" as const, body: "Thanks, saved." }];
    expect(await translateReplies(replies, "af", { keepEnglish: false })).toEqual(replies);
  });

  it("uses Claude's translation when it comes back whole", async () => {
    process.env.ANTHROPIC_API_KEY = "x";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              content: [
                { type: "text", text: '{"items":[{"body":"Dankie, gestoor.","labels":[]}]}' },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const out = await translateReplies([{ kind: "text" as const, body: "Thanks, saved." }], "af", {
      keepEnglish: false,
    });
    expect(out[0]).toEqual({ kind: "text", body: "Dankie, gestoor." });
  });
});
