import { describe, expect, it } from "vitest";
import {
  adherenceFromWords,
  describeMulti,
  isGreeting,
  readMulti,
  scaleFromWords,
} from "./answer-words";

describe("word answers", () => {
  it("sleep", () => {
    expect(scaleFromWords("slept well", "sleep")).toBe(4);
    expect(scaleFromWords("like a baby", "sleep")).toBe(5);
    expect(scaleFromWords("not great", "sleep")).toBe(2);
    expect(scaleFromWords("terrible, kept waking", "sleep")).toBe(1);
    expect(scaleFromWords("ok", "sleep")).toBe(3);
    expect(scaleFromWords("lekker geslaap", "sleep")).toBe(4);
    expect(
      scaleFromWords("my knee kept me up and then I had to get the kids to school early", "sleep"),
    ).toBeNull();
  });
  it("energy and stress", () => {
    expect(scaleFromWords("low", "energy")).toBe(2);
    expect(scaleFromWords("exhausted", "energy")).toBe(1);
    expect(scaleFromWords("pretty good", "energy")).toBe(4);
    expect(scaleFromWords("very stressed", "stress")).toBe(5);
    expect(scaleFromWords("relaxed", "stress")).toBe(1);
    expect(scaleFromWords("a little", "stress")).toBe(2);
  });
  it("exercises", () => {
    expect(adherenceFromWords("did all of them")).toBe("all");
    expect(adherenceFromWords("most of my exercises")).toBe("most");
    expect(adherenceFromWords("didn't do them today")).toBe("none");
    expect(adherenceFromWords("I did some walking")).toBeNull();
    expect(adherenceFromWords("ek het alles gedoen")).toBe("all");
  });
  it("several answers in one message", () => {
    const m = readMulti("pain 1, slept 4, energy 4, stress 1, did all my exercises");
    expect(m).toEqual({ pain: 1, sleep: 4, energy: 4, stress: 1, adherence: "all" });
    expect(describeMulti(m)).toBe("pain 1, sleep 4, energy 4, stress 1 and all your exercises");
    expect(readMulti("pain about a 2 today, slept badly, energy is ok")).toEqual({
      pain: 2,
      sleep: 2,
      energy: 3,
    });
    expect(readMulti("knee 6 and i slept well")).toEqual({ pain: 6, sleep: 4 });
    expect(readMulti("4")).toEqual({});
  });
  it("greetings", () => {
    expect(isGreeting("hi")).toBe(true);
    expect(isGreeting("Good morning buddy!")).toBe(true);
    expect(isGreeting("hi my knee is sore")).toBe(false);
  });
});
