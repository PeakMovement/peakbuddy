// Client-side helpers for the 4-digit quick sign-in code.

export const QUICK_CODE_SESSION_KEY = "buddy.quick_code_session";
export const QUICK_CODE_PROMPT_KEY = "buddy.quick_code_prompted"; // value: user id

export function markQuickCodeSession(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(QUICK_CODE_SESSION_KEY, "1");
    else window.localStorage.removeItem(QUICK_CODE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export function isQuickCodeSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(QUICK_CODE_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function hasBeenPrompted(userId: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return (window.localStorage.getItem(QUICK_CODE_PROMPT_KEY) ?? "").split(",").includes(userId);
  } catch {
    return true;
  }
}

export function markPrompted(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(QUICK_CODE_PROMPT_KEY) ?? "";
    const ids = raw.split(",").filter(Boolean);
    if (!ids.includes(userId)) ids.push(userId);
    window.localStorage.setItem(QUICK_CODE_PROMPT_KEY, ids.join(","));
  } catch {
    /* ignore */
  }
}
