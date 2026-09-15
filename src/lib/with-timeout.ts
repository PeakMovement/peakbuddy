/**
 * Race a promise against a timeout so a hung server call can never leave the UI
 * stuck in a "Saving…" / "Signing in…" state. Rejects with a timeout error the
 * caller can surface to the user.
 */
export function withTimeout<T>(p: Promise<T>, ms = 15000): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("The request timed out. Please try again.")), ms),
    ),
  ]);
}
