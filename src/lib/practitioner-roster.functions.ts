import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  canAccessClient,
  listAccessibleClientIds,
  listAccessibleClients,
} from "@/lib/practice-members.functions";
import { fetchAllPages } from "@/lib/paged-select";
import { ROSTER_WINDOW_DAYS, summarizeCheckIns, type CheckInSummary } from "@/lib/roster-summary";

const ALERT_FEED_LIMIT = 200;

export const getPractitionerRoster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const clients = await listAccessibleClients(supabaseAdmin, context.userId);
    const ids = clients.map((c) => c.id);
    if (ids.length === 0) {
      const { count } = await supabaseAdmin
        .from("alerts")
        .select("*", { count: "exact", head: true })
        .is("client_id", null)
        .eq("practitioner_id", context.userId)
        .eq("is_read", false);
      return {
        clients: [],
        checkInSummary: {} as Record<string, CheckInSummary>,
        windowDays: ROSTER_WINDOW_DAYS,
        unreadAlerts: count ?? 0,
      };
    }
    // Recent window only, paged past PostgREST's silent 1000-row cap.
    const since = new Date(Date.now() - ROSTER_WINDOW_DAYS * 86_400_000).toISOString();
    const [recent, { count }, { count: unmatchedUnread }] = await Promise.all([
      fetchAllPages<{ client_id: string; created_at: string }>((from, to) =>
        supabaseAdmin
          .from("check_ins")
          .select("client_id, created_at")
          .in("client_id", ids)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to),
      ),
      supabaseAdmin
        .from("alerts")
        .select("*", { count: "exact", head: true })
        .in("client_id", ids)
        .eq("is_read", false),
      supabaseAdmin
        .from("alerts")
        .select("*", { count: "exact", head: true })
        .is("client_id", null)
        .eq("practitioner_id", context.userId)
        .eq("is_read", false),
    ]);
    if (recent.error) throw new Error("Could not load check-ins");
    const checkInSummary = summarizeCheckIns(recent.rows);

    // Clients quiet for the whole window: look up their last check-in on its
    // own so the dashboard says "12 Mar" rather than "Never".
    const quiet = ids.filter((id) => !checkInSummary[id]);
    for (let i = 0; i < quiet.length; i += 10) {
      const chunk = quiet.slice(i, i + 10);
      const lasts = await Promise.all(
        chunk.map((id) =>
          supabaseAdmin
            .from("check_ins")
            .select("created_at")
            .eq("client_id", id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ),
      );
      chunk.forEach((id, j) => {
        const at = (lasts[j].data as { created_at?: string } | null)?.created_at ?? null;
        checkInSummary[id] = { last: at, windowCount: 0 };
      });
    }

    return {
      clients,
      checkInSummary,
      windowDays: ROSTER_WINDOW_DAYS,
      unreadAlerts: (count ?? 0) + (unmatchedUnread ?? 0),
    };
  });

export const getUnreadPracticeAlertCount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ids = await listAccessibleClientIds(supabaseAdmin, context.userId);
    const [{ count }, { count: unmatched }] = await Promise.all([
      ids.length === 0
        ? Promise.resolve({ count: 0 })
        : supabaseAdmin
            .from("alerts")
            .select("*", { count: "exact", head: true })
            .in("client_id", ids)
            .eq("is_read", false),
      supabaseAdmin
        .from("alerts")
        .select("*", { count: "exact", head: true })
        .is("client_id", null)
        .eq("practitioner_id", context.userId)
        .eq("is_read", false),
    ]);
    return { count: (count ?? 0) + (unmatched ?? 0) };
  });

export const getPractitionerAlertFeed = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const clients = await listAccessibleClients(supabaseAdmin, context.userId);
    const ids = clients.map((c) => c.id);
    const unmatchedQuery = supabaseAdmin
      .from("alerts")
      .select("*")
      .is("client_id", null)
      .eq("practitioner_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(ALERT_FEED_LIMIT);
    if (ids.length === 0) {
      const { data: unmatched } = await unmatchedQuery;
      return { alerts: unmatched ?? [], clients: [] };
    }
    // Newest 200, plus every unread alert (capped) so an old unresolved one
    // never drops off the feed. Previously unbounded and silently cut at 1000.
    // Alerts with no client are a WhatsApp number that is not on a profile yet.
    const [{ data: newest }, { data: unread }, { data: unmatched }] = await Promise.all([
      supabaseAdmin
        .from("alerts")
        .select("*")
        .in("client_id", ids)
        .order("created_at", { ascending: false })
        .limit(ALERT_FEED_LIMIT),
      supabaseAdmin
        .from("alerts")
        .select("*")
        .in("client_id", ids)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(500),
      unmatchedQuery,
    ]);
    const byId = new Map<string, NonNullable<typeof newest>[number]>();
    for (const a of [...(unmatched ?? []), ...(unread ?? []), ...(newest ?? [])])
      byId.set(a.id as string, a);
    const alerts = [...byId.values()].sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at)),
    );
    return { alerts, clients };
  });

const patchSchema = z
  .object({
    alertId: z.string().uuid(),
    is_read: z.boolean().optional(),
    practitioner_assessment: z.enum(["correct", "over", "under"]).nullable().optional(),
  })
  .refine((d) => d.is_read !== undefined || d.practitioner_assessment !== undefined, {
    message: "No alert fields to update",
  });

export const patchPractitionerAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => patchSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: alert } = await supabaseAdmin
      .from("alerts")
      .select("id, client_id, practitioner_id")
      .eq("id", data.alertId)
      .maybeSingle();
    if (!alert) return { ok: false as const, error: "Alert not found" };
    if (!alert.client_id) {
      let allowed = alert.practitioner_id === context.userId;
      if (!allowed) {
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("role")
          .eq("id", context.userId)
          .maybeSingle();
        allowed = prof?.role === "super_admin";
      }
      if (!allowed) return { ok: false as const, error: "Not authorized" };
    } else {
      const access = await canAccessClient(supabaseAdmin, context.userId, alert.client_id);
      if (!access.allowed) return { ok: false as const, error: "Not authorized" };
    }
    const patch: {
      is_read?: boolean;
      practitioner_assessment?: "correct" | "over" | "under" | null;
    } = {};
    if (data.is_read !== undefined) patch.is_read = data.is_read;
    if (data.practitioner_assessment !== undefined) {
      patch.practitioner_assessment = data.practitioner_assessment;
    }
    const { error } = await supabaseAdmin.from("alerts").update(patch).eq("id", data.alertId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
