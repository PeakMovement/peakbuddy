import { describe, expect, it } from "vitest";
import { runRedFlagRules } from "./red-flag-rules";

const flags = (text: string) => runRedFlagRules({ text }).triggered;

describe("red flags ignore negated symptoms", () => {
  it.each([
    "No chest pain today, all good",
    "my calf isn't swollen",
    "My calf isn’t swollen or red",
    "no swelling, no redness",
    "I haven't had any shortness of breath",
    "never had any discharge from the wound",
    "Wound looks fine, no pus or oozing",
    "geen swelsel nie",
    "no fever",
  ])("does not alert on %s", (text) => {
    expect(flags(text)).toBe(false);
  });

  it.each([
    "No pain but my calf is swollen",
    "no fever and my calf is swollen and hot",
    "No, my calf is swollen",
    "Not sure but I think my calf is swollen",
    "I can't breathe",
    "kan nie asemhaal nie",
    "I don't want to live anymore",
    "I don't want to be here anymore",
    "No swelling yesterday. Calf is swollen now",
    "chest pain",
    "my leg gave way and I fell",
  ])("still alerts on %s", (text) => {
    expect(flags(text)).toBe(true);
  });
});

describe("body parts on their own", () => {
  it("still alerts when the calf is mentioned with no denial", () => {
    expect(flags("my calf is sore today")).toBe(true);
  });
  it("still alerts when one symptom is denied but another is not", () => {
    expect(flags("my calf isn't red but it is swollen")).toBe(true);
  });
});
