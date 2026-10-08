import { describe, expect, it } from "vitest";
import { mergeTranscriptPage, type TranscriptLine } from "./whatsapp/transcript.functions";

const line = (at: string, from: "patient" | "buddy"): TranscriptLine => ({ at, from, text: at });

describe("mergeTranscriptPage", () => {
  it("interleaves both directions oldest first and keeps the newest page", () => {
    const inbound = [
      line("2026-10-08T10:05:00Z", "patient"),
      line("2026-10-08T10:01:00Z", "patient"),
    ];
    const outbound = [line("2026-10-08T10:06:00Z", "buddy"), line("2026-10-08T10:02:00Z", "buddy")];
    const r = mergeTranscriptPage(inbound, outbound, 3);
    expect(r.lines.map((l) => l.at)).toEqual([
      "2026-10-08T10:02:00Z",
      "2026-10-08T10:05:00Z",
      "2026-10-08T10:06:00Z",
    ]);
    expect(r.hasMore).toBe(true);
  });

  it("reports no more history when everything fits", () => {
    const r = mergeTranscriptPage([line("2026-10-08T10:00:00Z", "patient")], [], 3);
    expect(r.hasMore).toBe(false);
    expect(r.lines).toHaveLength(1);
  });
});
