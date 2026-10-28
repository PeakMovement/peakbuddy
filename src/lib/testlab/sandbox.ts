/**
 * Test Lab sandbox switch (28 Oct 2026).
 *
 * While a Test Lab run is in progress, everything Buddy would send to the
 * outside world (WhatsApp, push, email, job health notes) is captured here
 * instead, and the live practitioner phone cache is left alone. The run's
 * database is an in-memory copy (memory-db.ts), never the live one.
 *
 * AsyncLocalStorage keeps one run's switch from leaking into a live request
 * handled by the same Worker at the same time.
 */

export interface SandboxEvent {
  kind: "whatsapp" | "push" | "email" | "alert_whatsapp" | "job_note";
  to: string;
  summary: string;
  at: string;
}

interface SandboxState {
  events: SandboxEvent[];
  now: () => Date;
  /** Practitioner phone map for this run only. */
  practitionerCache?: unknown;
  /** The capturing WhatsApp provider and secrets for this run. */
  whatsapp?: { provider: unknown; secrets: unknown };
}

interface Als<T> {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
}

/**
 * AsyncLocalStorage without a static node import, so this file can sit in a
 * module the browser bundle also reaches. Workers (nodejs_compat) and Node
 * both provide it. In a browser there is no sandbox, ever.
 */
function makeStore(): Als<SandboxState> {
  const g = globalThis as {
    AsyncLocalStorage?: new <T>() => Als<T>;
    process?: { getBuiltinModule?: (id: string) => { AsyncLocalStorage?: new <T>() => Als<T> } };
  };
  const Ctor =
    g.AsyncLocalStorage ?? g.process?.getBuiltinModule?.("node:async_hooks")?.AsyncLocalStorage;
  if (Ctor) return new Ctor<SandboxState>();
  return {
    getStore: () => undefined,
    run: () => {
      throw new Error("Test Lab needs a server runtime");
    },
  };
}

const store = makeStore();

export function inSandbox(): boolean {
  return store.getStore() !== undefined;
}

export function sandboxState(): SandboxState | undefined {
  return store.getStore();
}

export function runInSandbox<T>(
  state: {
    events: SandboxEvent[];
    now: () => Date;
    whatsapp?: { provider: unknown; secrets: unknown };
  },
  fn: () => Promise<T>,
): Promise<T> {
  return store.run({ ...state }, fn);
}

/** Record something Buddy would have sent. Returns true when in a sandbox. */
export function captureOutbound(event: Omit<SandboxEvent, "at">): boolean {
  const s = store.getStore();
  if (!s) return false;
  s.events.push({ ...event, summary: event.summary.slice(0, 600), at: s.now().toISOString() });
  return true;
}
