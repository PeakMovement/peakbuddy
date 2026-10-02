import { describe, it, expect } from "vitest";
import {
  extractDeterministic,
  mergeExtractions,
  needsModelPass,
  parseModelExtraction,
  EMPTY_EXTRACTION,
} from "./extraction";

/**
 * The point of these: a wrong pain score is worse than no pain score. Every
 * case below is either "reads it correctly" or "correctly refuses to guess".
 */

describe("pain score", () => {
  it("reads a bare number when we asked for pain", () => {
    expect(extractDeterministic({ text: "7", expecting: "painScore" }).painScore).toBe(7);
  });

  it("refuses a bare number when we did not ask for pain", () => {
    expect(extractDeterministic({ text: "7" }).painScore).toBe(null);
  });

  it("reads x/10 anywhere", () => {
    expect(extractDeterministic({ text: "6/10", expecting: "painScore" }).painScore).toBe(6);
  });

  it("reads 'pain is 4'", () => {
    expect(extractDeterministic({ text: "the pain is 4 today" }).painScore).toBe(4);
  });

  it("reads 'pain 9/10'", () => {
    expect(extractDeterministic({ text: "pain 9/10 this morning" }).painScore).toBe(9);
  });

  it("reads Afrikaans 'pyn is 5'", () => {
    expect(extractDeterministic({ text: "my pyn is 5 vandag" }).painScore).toBe(5);
  });

  it("does not read sleep hours as pain", () => {
    expect(extractDeterministic({ text: "I slept 7 hours" }).painScore).toBe(null);
  });

  it("does not read a rep count as pain", () => {
    expect(extractDeterministic({ text: "did 3 sets of 10" }).painScore).toBe(null);
  });

  it("rejects out of range", () => {
    expect(extractDeterministic({ text: "15", expecting: "painScore" }).painScore).toBe(null);
  });

  it("accepts zero", () => {
    expect(extractDeterministic({ text: "0", expecting: "painScore" }).painScore).toBe(0);
  });
});

describe("trend", () => {
  it("reads worse", () => {
    expect(extractDeterministic({ text: "feeling worse today" }).trend).toBe("worse");
  });
  it("reads better", () => {
    expect(extractDeterministic({ text: "much better thanks" }).trend).toBe("better");
  });
  it("reads same", () => {
    expect(extractDeterministic({ text: "about the same" }).trend).toBe("same");
  });
  it("reads Afrikaans slegter", () => {
    expect(extractDeterministic({ text: "dit voel slegter" }).trend).toBe("worse");
  });
  it("prefers worse when both words appear", () => {
    expect(extractDeterministic({ text: "better in the morning but worse at night" }).trend).toBe("worse");
  });
  it("stays unknown on an unrelated message", () => {
    expect(extractDeterministic({ text: "see you tuesday" }).trend).toBe("unknown");
  });
});

describe("adherence", () => {
  it("reads none when exercises are the subject", () => {
    expect(
      extractDeterministic({ text: "I did not do my exercises" }).exerciseAdherence,
    ).toBe("none");
  });
  it("reads all when exercises are the subject", () => {
    expect(
      extractDeterministic({ text: "did all of them, the exercises were fine" })
        .exerciseAdherence,
    ).toBe("all");
  });
  it("ignores adherence words with no exercise context", () => {
    expect(extractDeterministic({ text: "I did some walking" }).exerciseAdherence).toBe(
      "unknown",
    );
  });
  it("trusts it when that is what we asked", () => {
    expect(
      extractDeterministic({ text: "most", expecting: "exerciseAdherence" })
        .exerciseAdherence,
    ).toBe("most");
  });
});

describe("sleep", () => {
  it("reads poor with sleep context", () => {
    expect(extractDeterministic({ text: "slept badly again" }).sleepQuality).toBe("poor");
  });
  it("reads good with sleep context", () => {
    expect(extractDeterministic({ text: "I slept well" }).sleepQuality).toBe("good");
  });
  it("ignores 'good' with no sleep context", () => {
    expect(extractDeterministic({ text: "the knee feels good" }).sleepQuality).toBe(
      "unknown",
    );
  });
});

describe("buttons", () => {
  it("reads a trend button", () => {
    expect(extractDeterministic({ text: "", replyId: "trend_worse" }).trend).toBe("worse");
  });
  it("reads a pain button", () => {
    expect(extractDeterministic({ text: "", replyId: "pain_8" }).painScore).toBe(8);
  });
  it("ignores an unknown button id", () => {
    const r = extractDeterministic({ text: "", replyId: "something_else" });
    expect(r.source).toBe("none");
  });
});

describe("result shape", () => {
  it("lists everything missing on an empty message", () => {
    const r = extractDeterministic({ text: "" });
    expect(r.missing.length).toBe(4);
    expect(r.confidence).toBe(0);
    expect(r.source).toBe("none");
  });

  it("keeps the raw text", () => {
    expect(extractDeterministic({ text: "hello there" }).rawText).toBe("hello there");
  });

  it("does not ask for a model pass on an empty message", () => {
    expect(needsModelPass(extractDeterministic({ text: "" }))).toBe(false);
  });

  it("asks for a model pass when fields are missing and there are words", () => {
    expect(needsModelPass(extractDeterministic({ text: "it has been a rough week" }))).toBe(
      true,
    );
  });

  it("does not ask for a model pass when everything was read", () => {
    const r = extractDeterministic({
      text: "pain 5/10, feeling better, did all my exercises, slept well",
    });
    expect(needsModelPass(r)).toBe(false);
  });
});

describe("model response parsing", () => {
  const good = JSON.stringify({
    painScore: 6,
    trend: "worse",
    exerciseAdherence: "some",
    sleepQuality: "poor",
    notesSummary: "Reports increased pain and disturbed sleep.",
    confidence: 0.8,
    missing: [],
  });

  it("parses clean json", () => {
    expect(parseModelExtraction(good)?.painScore).toBe(6);
  });

  it("parses json inside code fences", () => {
    expect(parseModelExtraction("```json\n" + good + "\n```")?.trend).toBe("worse");
  });

  it("parses json with prose around it", () => {
    expect(parseModelExtraction("Here you go: " + good + " hope that helps")?.sleepQuality).toBe("poor");
  });

  it("returns null on garbage", () => {
    expect(parseModelExtraction("sorry, I cannot help with that")).toBe(null);
  });

  it("returns null on a bad enum value", () => {
    expect(
      parseModelExtraction(JSON.stringify({ ...JSON.parse(good), trend: "slightly worse" })),
    ).toBe(null);
  });

  it("returns null on an out of range pain score", () => {
    expect(
      parseModelExtraction(JSON.stringify({ ...JSON.parse(good), painScore: 42 })),
    ).toBe(null);
  });

  it("accepts a null pain score", () => {
    const r = parseModelExtraction(JSON.stringify({ ...JSON.parse(good), painScore: null }));
    expect(r?.painScore).toBe(null);
  });
});

describe("merge", () => {
  it("deterministic wins over the model", () => {
    const det = extractDeterministic({ text: "pain 3/10" });
    const merged = mergeExtractions(det, {
      ...EMPTY_EXTRACTION,
      painScore: 9,
      trend: "worse",
      notesSummary: "x",
      confidence: 0.5,
    });
    expect(merged.painScore).toBe(3);
    expect(merged.trend).toBe("worse");
  });

  it("returns the deterministic result when the model failed", () => {
    const det = extractDeterministic({ text: "pain 3/10" });
    expect(mergeExtractions(det, null).painScore).toBe(3);
  });

  it("recomputes missing after merging", () => {
    const det = extractDeterministic({ text: "pain 3/10" });
    const merged = mergeExtractions(det, {
      ...EMPTY_EXTRACTION,
      trend: "same",
      exerciseAdherence: "all",
      sleepQuality: "good",
      notesSummary: "x",
      confidence: 0.9,
    });
    expect(merged.missing.length).toBe(0);
  });

  it("takes the lower confidence of the two", () => {
    const det = extractDeterministic({ text: "pain 3/10" });
    const merged = mergeExtractions(det, {
      ...EMPTY_EXTRACTION,
      notesSummary: "x",
      confidence: 0.4,
    });
    expect(merged.confidence).toBe(0.4);
  });
});
