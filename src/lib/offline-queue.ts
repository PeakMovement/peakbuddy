// Offline support for daily check-ins.
//
// Check-ins submitted while offline (or when the network call fails) are
// queued in localStorage and flushed automatically when connectivity
// returns. Data is never lost: a queue entry is only removed after the
// server confirms the insert.

import { supabase } from "@/lib/supabase";
import { findRecentOpenAlert, fireAlertWebhook } from "@/lib/webhooks";
import { evaluateCheckIn } from "@/lib/yves";
import { log } from "@/lib/log";

const QUEUE_KEY = "buddy.offline_checkins";
const CLIENT_CACHE_KEY = "buddy.client_cache";

let boundUserId: string | null = null;

export function offlineQueueKey(userId: string): string {
  return `${QUEUE_KEY}.${userId}`;
}

export function offlineCacheKey(userId: string): string {
  return `${CLIENT_CACHE_KEY}.${userId}`;
}

function activeQueueKey(): string {
  return boundUserId ? offlineQueueKey(boundUserId) : QUEUE_KEY;
}

function activeCacheKey(): string {
  return boundUserId ? offlineCacheKey(boundUserId) : CLIENT_CACHE_KEY;
}

/** Remember who is signed in so a shared device does not mix two queues. */
export function bindOfflineUser(userId: string | null): void {
  boundUserId = userId;
  if (!userId || typeof window === "undefined") return;
  try {
    const legacy = window.localStorage.getItem(QUEUE_KEY);
    const mine = offlineQueueKey(userId);
    if (legacy && !window.localStorage.getItem(mine)) {
      window.localStorage.setItem(mine, legacy);
      window.localStorage.removeItem(QUEUE_KEY);
    }
    const legacyClient = window.localStorage.getItem(CLIENT_CACHE_KEY);
    const myClient = offlineCacheKey(userId);
    if (legacyClient && !window.localStorage.getItem(myClient)) {
      window.localStorage.setItem(myClient, legacyClient);
      window.localStorage.removeItem(CLIENT_CACHE_KEY);
    }
  } catch {
    /* storage disabled */
  }
}

/** Drop this user's queued check-ins and the cached client record. */
export function clearOfflineStore(): void {
  if (typeof window === "undefined") return;
  try {
    if (boundUserId) {
      window.localStorage.removeItem(offlineQueueKey(boundUserId));
      window.localStorage.removeItem(offlineCacheKey(boundUserId));
    }
    window.localStorage.removeItem(QUEUE_KEY);
    window.localStorage.removeItem(CLIENT_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Flush when the network is up. If rows are still here, ask before they
 * are removed. Returns false when the person chose to stay signed in.
 */
export async function confirmOfflineSignOut(): Promise<boolean> {
  if (typeof navigator === "undefined" || navigator.onLine) {
    await flushQueue().catch(() => undefined);
  }
  const left = queueLength();
  if (left > 0 && typeof window !== "undefined" && typeof window.confirm === "function") {
    const ok = window.confirm(
      `You have ${left} check-in${left === 1 ? "" : "s"} still on this device. Signing out will remove them. Continue?`,
    );
    if (!ok) return false;
  }
  clearOfflineStore();
  return true;
}

export interface QueuedCheckIn {
  queued_at: string;
  client_id: string;
  practitioner_id: string;
  client_name: string;
  pain_level: number;
  sleep_quality: number | null;
  stress_level: number | null;
  energy_level: number | null;
  mood: number | null;
  notes: string;
  medication_taken: boolean;
  flagged: boolean;
  condition_context?: string | null;
  condition_note?: string | null;
}

export function getQueue(): QueuedCheckIn[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(activeQueueKey()) ?? "[]") as QueuedCheckIn[];
  } catch {
    return [];
  }
}

function setQueue(items: QueuedCheckIn[]) {
  window.localStorage.setItem(activeQueueKey(), JSON.stringify(items));
}

export function queueCheckIn(item: QueuedCheckIn) {
  setQueue([...getQueue(), item]);
}

export function queueLength(): number {
  return getQueue().length;
}

// Cache the client record so the check-in form can render while offline.
export function cacheClient(client: unknown) {
  try {
    window.localStorage.setItem(activeCacheKey(), JSON.stringify(client));
  } catch {
    /* storage full — non-fatal */
  }
}

export function getCachedClient<T>(): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(activeCacheKey());
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

let flushing = false;

export async function flushQueue(): Promise<{ synced: number; remaining: number }> {
  if (flushing) return { synced: 0, remaining: queueLength() };
  flushing = true;
  try {
    const queue = getQueue();
    if (queue.length === 0) return { synced: 0, remaining: 0 };

    const remaining: QueuedCheckIn[] = [];
    let synced = 0;

    for (const item of queue) {
      try {
        const { data: newId, error } = await supabase.rpc("insert_check_in", {
          p_client_id: item.client_id,
          p_practitioner_id: item.practitioner_id,
          p_pain_level: item.pain_level,
          p_sleep_quality: item.sleep_quality,
          p_stress_level: item.stress_level,
          p_energy_level: item.energy_level,
          p_mood: item.mood,
          p_notes: item.notes,
          p_medication_taken: item.medication_taken,
          p_flagged: item.flagged,
          p_condition_context: item.condition_context ?? null,
          p_condition_note: item.condition_note ?? null,
        });
        if (error || !newId) {
          remaining.push(item);
          continue;
        }
        synced += 1;

        // Best-effort alert flow for red-flag check-ins that synced late.
        if (item.flagged) {
          try {
            // Recompute urgency from the stored notes + pain so an emergency term
            // isn't downgraded to "urgent" (mirrors the online check-in path).
            const { urgency: effectiveUrgency } = evaluateCheckIn(item.pain_level, item.notes);

            const existing = await findRecentOpenAlert(item.client_id, "red_flag");
            if (!existing || effectiveUrgency === "emergency") {
              const { data: alertId } = await supabase.rpc("insert_alert", {
                p_practitioner_id: item.practitioner_id,
                p_client_id: item.client_id,
                p_alert_type: "red_flag",
                p_message: `Red flag check-in synced after offline period (submitted ${item.queued_at}).`,
                p_urgency: effectiveUrgency,
              });
              // Push + email the practitioner (was webhook-only, so a red flag
              // logged offline never reached practitioners without a webhook).
              if (alertId) {
                try {
                  const [{ notifyAlertPush }, { notifyAlertEmail }] = await Promise.all([
                    import("@/lib/push.functions"),
                    import("@/lib/notify-practitioner.functions"),
                  ]);
                  await Promise.all([
                    notifyAlertPush({ data: { alertId: alertId as string, kind: "checkin" } }),
                    notifyAlertEmail({ data: { alertId: alertId as string } }),
                  ]);
                } catch (e) {
                  log.warn("[offline-queue] practitioner notify failed:", e);
                }
              }
              await fireAlertWebhook({
                practitionerId: item.practitioner_id,
                clientName: item.client_name,
                clientId: item.client_id,
                alertMessage:
                  "Red flag symptom detected in daily check-in (synced after offline period)",
                urgency: effectiveUrgency,
                redFlagDetected: true,
              });
            }
          } catch (e) {
            log.warn("[offline-queue] alert flow failed for synced check-in:", e);
          }
        }
      } catch {
        remaining.push(item);
      }
    }

    // A check-in may have been enqueued (appended) while we were awaiting the
    // network above. Re-read and keep anything added after our snapshot so it
    // isn't overwritten/lost.
    const appendedDuringFlush = getQueue().slice(queue.length);
    setQueue([...remaining, ...appendedDuringFlush]);
    if (synced > 0) log.debug("[offline-queue] synced", synced, "queued check-ins");
    return { synced, remaining: remaining.length };
  } finally {
    flushing = false;
  }
}

export function startQueueAutoFlush(onSynced?: (count: number) => void): () => void {
  const handler = () => {
    void flushQueue().then((r) => {
      if (r.synced > 0) onSynced?.(r.synced);
    });
  };
  window.addEventListener("online", handler);
  // Also flush on start — covers the app being reopened after connectivity returned.
  handler();
  return () => window.removeEventListener("online", handler);
}
