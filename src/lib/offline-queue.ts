// Offline support for daily check-ins.
//
// Check-ins submitted while offline (or when the network call fails) are
// queued in localStorage and flushed automatically when connectivity
// returns. Data is never lost: a queue entry is only removed after the
// server confirms the insert.

import { supabase } from "@/lib/supabase";
import { findRecentOpenAlert, fireAlertWebhook } from "@/lib/webhooks";
import { log } from "@/lib/log";

const QUEUE_KEY = "buddy.offline_checkins";
const CLIENT_CACHE_KEY = "buddy.client_cache";

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
}

export function getQueue(): QueuedCheckIn[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedCheckIn[];
  } catch {
    return [];
  }
}

function setQueue(items: QueuedCheckIn[]) {
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
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
    window.localStorage.setItem(CLIENT_CACHE_KEY, JSON.stringify(client));
  } catch {
    /* storage full — non-fatal */
  }
}

export function getCachedClient<T>(): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CLIENT_CACHE_KEY);
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
        });
        if (error || !newId) {
          remaining.push(item);
          continue;
        }
        synced += 1;

        // Best-effort alert flow for red-flag check-ins that synced late.
        if (item.flagged) {
          try {
            const existing = await findRecentOpenAlert(item.client_id, "red_flag");
            if (!existing) {
              await supabase.rpc("insert_alert", {
                p_practitioner_id: item.practitioner_id,
                p_client_id: item.client_id,
                p_alert_type: "red_flag",
                p_message: `Red flag check-in synced after offline period (submitted ${item.queued_at}).`,
                p_urgency: "urgent",
              });
              await fireAlertWebhook({
                practitionerId: item.practitioner_id,
                clientName: item.client_name,
                clientId: item.client_id,
                alertMessage: "Red flag symptom detected in daily check-in (synced after offline period)",
                urgency: "urgent",
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

    setQueue(remaining);
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
