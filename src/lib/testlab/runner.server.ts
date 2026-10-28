/**
 * Runs Test Lab scenarios. Each gets a fresh sandbox practice.
 */
import { labAdvance, labSend, newLab, type LabLine, type LabState } from "./engine.server";
import { SCENARIOS, type Scenario } from "./scenarios";

export interface ScenarioResult {
  id: string;
  area: Scenario["area"];
  title: string;
  why: string;
  feature: string | null;
  needsAi: boolean;
  passed: boolean;
  checks: Array<{ label: string; pass: boolean }>;
  transcript: LabLine[];
  error: string | null;
  ms: number;
}

export async function runScenario(s: Scenario): Promise<ScenarioResult> {
  const started = Date.now();
  let state: LabState = newLab();
  const lines: LabLine[] = [];
  let error: string | null = null;
  let stopped: string | null = null;
  try {
    for (const step of s.steps) {
      if ("send" in step) {
        const r = await labSend(state, step.send);
        state = r.state;
        lines.push(...r.lines);
      } else if ("advance" in step) {
        const r = await labAdvance(state, step.advance);
        state = r.state;
        lines.push(...r.lines);
      } else {
        const last = [...lines]
          .reverse()
          .find((l) => l.dir === "out" && l.who === step.tap.from && l.buttons?.length);
        const button = last?.buttons?.find((b) => step.tap.title.test(b.title));
        if (!button) {
          stopped = `Buddy offered ${step.tap.from} a button to tap (${step.tap.title.source})`;
          break;
        }
        const r = await labSend(state, {
          from: step.tap.from,
          replyId: button.id,
          replyTitle: button.title,
        });
        state = r.state;
        lines.push(...r.lines);
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : "failed";
  }
  const checks = [
    ...(stopped ? [{ label: stopped, pass: false }] : []),
    ...s.checks.map((c) => {
      let pass = false;
      try {
        pass = !error && c.pass({ state, lines });
      } catch {
        pass = false;
      }
      return { label: c.label, pass };
    }),
  ];
  return {
    id: s.id,
    area: s.area,
    title: s.title,
    why: s.why,
    feature: s.feature ?? null,
    needsAi: Boolean(s.needsAi),
    passed: !error && checks.every((c) => c.pass),
    checks,
    transcript: state.transcript.slice(1),
    error,
    ms: Date.now() - started,
  };
}

export async function runScenarios(ids?: string[]): Promise<ScenarioResult[]> {
  const list = ids?.length ? SCENARIOS.filter((s) => ids.includes(s.id)) : SCENARIOS;
  const out: ScenarioResult[] = [];
  for (const s of list) out.push(await runScenario(s));
  return out;
}
