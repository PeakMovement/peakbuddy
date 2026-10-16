/**
 * Everyday memory: preferred name, training schedule, sport.
 * Health, medicine, and identity numbers are refused by validMemory.
 * Saving is the caller's job, and only when AI consent is on.
 * Viewing and deleting do not need the model.
 */

import { validMemory } from "./converse";

export interface MemoryCommand {
  save: string | null;
  forget: "all" | string | null;
  show: boolean;
  preferredName: string | null;
  outreach: boolean | null;
}

const FORGET_ALL =
  /^(?:please\s+)?(?:forget|delete|erase|clear)\s+(?:everything|all of that|what you remember|my memory|your notes about me)[.!]*$/i;
const SHOW = /^(?:what do you remember(?: about me)?|show(?: me)? (?:my )?memory|what have you saved)[.?]*$/i;
const OPT_IN = /^(?:yes[, ]+)?(?:you can |please )?(?:send )?(?:extra )?reminders between sessions[.!]*$/i;
const OPT_OUT = /^(?:stop|no more) extra (?:messages|reminders)[.!]*$/i;

export function readMemoryCommand(text: string): MemoryCommand {
  const raw = text.replace(/\s+/g, " ").trim();
  const empty: MemoryCommand = {
    save: null,
    forget: null,
    show: false,
    preferredName: null,
    outreach: null,
  };
  if (!raw) return empty;
  if (SHOW.test(raw)) return { ...empty, show: true };
  if (FORGET_ALL.test(raw)) return { ...empty, forget: "all" };
  if (OPT_IN.test(raw)) return { ...empty, outreach: true };
  if (OPT_OUT.test(raw)) return { ...empty, outreach: false };
  const called = raw.match(/^(?:please\s+)?call me\s+([A-Za-z][A-Za-z' -]{1,30})[.!]*$/i);
  if (called) {
    const name = called[1].trim();
    const fact = validMemory(`Prefers to be called ${name}`);
    return { ...empty, save: fact, preferredName: name };
  }
  const sport = raw.match(
    /^(?:i\s+)?(?:play|do|love)\s+([a-z][a-z\s]{2,40}?)(?:\s+on\s+\w+days?)?[.!]*$/i,
  );
  if (sport && !/\b(pain|exercise programme|exercises|physio)\b/i.test(sport[1])) {
    const fact = validMemory(`Plays ${sport[1].trim()}`);
    return { ...empty, save: fact };
  }
  const train = raw.match(/^i train on\s+([a-z\s,]{3,40})[.!]*$/i);
  if (train) {
    const fact = validMemory(`Trains on ${train[1].trim()}`);
    return { ...empty, save: fact };
  }
  const forgetOne = raw.match(/^(?:please\s+)?forget (?:my |the |that )?(.{3,40})[.!]*$/i);
  if (forgetOne && !FORGET_ALL.test(raw)) {
    return { ...empty, forget: forgetOne[1].trim().toLowerCase() };
  }
  return empty;
}

export function memoryList(facts: string[]): string {
  const rows = facts.map((f) => f.trim()).filter(Boolean).slice(0, 12);
  if (!rows.length) return "I don't have any everyday notes saved for you.";
  return `Here's what I've saved:\n${rows.map((f) => `• ${f}`).join("\n")}\nSay forget everything to clear this.`;
}
