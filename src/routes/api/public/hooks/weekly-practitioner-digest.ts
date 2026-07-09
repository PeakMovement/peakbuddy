import { createFileRoute } from "@tanstack/react-router";
import { log } from "@/lib/log";

// #7 Weekly practitioner digest.
// Opt-in (practices.weekly_digest_enabled). For each opted-in practitioner,
// summarise the past 7 days across their clients and email it via the same
// Resend gateway used by notify-practitioner. Additive + best-effort: a failure
// for one practitioner never blocks the others, and nothing is sent to
// practitioners who have not opted in.

const BATCH_SIZE = 50;
const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const FROM_ADDRESS = process.env.BUDDY_EMAIL_FROM || "Buddy <onboarding@resend.dev>";
const APP_BASE_URL = process.env.BUDDY_APP_BASE_URL || "https://peakbuddy.lovable.app";

type ClientRow = { id: string; full_name: string; practitioner_id: string };
type CheckInRow = { client_id: string; created_at: string; flagged: boolean | null };
type RiskRow = { client_id: string; risk_score: number; score_date: string };

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type DigestData = {
  practitionerName: string;
  totalCheckins: number;
  activeClients: number;
  totalClients: number;
  flaggedCount: number;
  unreadAlerts: number;
  atRisk: { name: string; score: number }[];
  quiet: { name: string }[];
  dashboardLink: string;
};

function renderDigest(d: DigestData) {
  const subject = `[Buddy] Your weekly summary — ${d.totalCheckins} check-in${d.totalCheckins === 1 ? "" : "s"}, ${d.atRisk.length} to watch`;
  const row = (label: string, value: string | number) =>
    `<tr><td style="padding:6px 0;color:#b8c5db;font-size:14px">${label}</td><td style="padding:6px 0;text-align:right;color:#f0ece4;font-weight:700;font-size:15px">${value}</td></tr>`;
  const listBlock = (title: string, items: string[]) =>
    items.length
      ? `<p style="margin:18px 0 6px;color:#4a8df0;font-size:12px;letter-spacing:.08em;text-transform:uppercase">${title}</p>` +
        items.map((i) => `<p style="margin:0 0 4px;color:#f0ece4;font-size:14px;line-height:1.5">${i}</p>`).join("")
      : "";

  const atRiskItems = d.atRisk.map(
    (c) => `${escapeHtml(c.name)} <span style="color:#b8c5db">· risk ${c.score}/100</span>`,
  );
  const quietItems = d.quiet.map((c) => `${escapeHtml(c.name)} <span style="color:#b8c5db">· no check-in this week</span>`);

  const html = `<!doctype html>
<html><body style="font-family:'Segoe UI',Arial,sans-serif;background:#1a2952;margin:0;padding:24px 0;color:#f0ece4">
  <div style="max-width:520px;margin:0 auto;background:#243a6b;border:1px solid #3658a3;border-radius:16px;padding:32px 28px">
    <div style="font-family:Georgia,serif;font-size:30px;font-weight:600;color:#f0ece4">Buddy</div>
    <div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#4a8df0;margin:2px 0 24px">by Peak Movement</div>
    <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 6px">Your week in review</h1>
    <p style="color:#b8c5db;font-size:14px;margin:0 0 20px">Hi ${escapeHtml(d.practitionerName)}, here's how your clients did over the last 7 days.</p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #3658a3;border-bottom:1px solid #3658a3;margin-bottom:8px">
      ${row("Check-ins logged", d.totalCheckins)}
      ${row("Active clients", `${d.activeClients} / ${d.totalClients}`)}
      ${row("Flagged check-ins", d.flaggedCount)}
      ${row("Unread alerts", d.unreadAlerts)}
    </table>
    ${listBlock("Clients to watch", atRiskItems)}
    ${listBlock("Gone quiet", quietItems)}
    <a href="${d.dashboardLink}" style="display:inline-block;background:#4a8df0;color:#0b1836;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:700;margin:24px 0 8px">Open your dashboard</a>
    <p style="color:#b8c5db;font-size:11px;line-height:1.6;margin:22px 0 0;border-top:1px solid #3658a3;padding-top:16px">
      An automated weekly summary from Buddy. It is not a clinical alert — urgent items are flagged separately.
      To stop these, turn off the weekly digest in your practice settings.
    </p>
  </div>
</body></html>`;

  const text = [
    `Your week in review — Buddy`,
    `Hi ${d.practitionerName},`,
    ``,
    `Check-ins logged: ${d.totalCheckins}`,
    `Active clients: ${d.activeClients} / ${d.totalClients}`,
    `Flagged check-ins: ${d.flaggedCount}`,
    `Unread alerts: ${d.unreadAlerts}`,
    d.atRisk.length ? `\nClients to watch:\n${d.atRisk.map((c) => `- ${c.name} (risk ${c.score}/100)`).join("\n")}` : "",
    d.quiet.length ? `\nGone quiet:\n${d.quiet.map((c) => `- ${c.name}`).join("\n")}` : "",
    `\nOpen your dashboard: ${d.dashboardLink}`,
    `\nAutomated weekly summary — not a clinical alert. Turn off in practice settings.`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}

type AdminClient = typeof import("@/integrations/supabase/client.server")["supabaseAdmin"];

async function buildAndSend(
  supabaseAdmin: AdminClient,
  practitionerId: string,
  sinceIso: string,
  lovableKey: string,
  resendKey: string,
): Promise<"sent" | "skipped" | "error"> {
  const [{ data: prof }, userRes] = await Promise.all([
    supabaseAdmin.from("profiles").select("full_name").eq("id", practitionerId).maybeSingle(),
    supabaseAdmin.auth.admin.getUserById(practitionerId),
  ]);
  const email = userRes?.data?.user?.email;
  if (!email) return "skipped";
  const practitionerName = (prof as { full_name?: string } | null)?.full_name || "Practitioner";

  const { data: clientRows } = await supabaseAdmin
    .from("clients")
    .select("id, full_name, practitioner_id")
    .eq("practitioner_id", practitionerId);
  const clients = (clientRows ?? []) as ClientRow[];
  if (clients.length === 0) return "skipped";
  const clientIds = clients.map((c) => c.id);
  const nameById = new Map(clients.map((c) => [c.id, c.full_name]));

  const { data: ciRows } = await supabaseAdmin
    .from("check_ins")
    .select("client_id, created_at, flagged")
    .in("client_id", clientIds)
    .gte("created_at", sinceIso);
  const checkins = (ciRows ?? []) as CheckInRow[];
  const activeSet = new Set(checkins.map((c) => c.client_id));
  const flaggedCount = checkins.filter((c) => c.flagged === true).length;

  const { data: riskRows } = await supabaseAdmin
    .from("risk_scores")
    .select("client_id, risk_score, score_date")
    .in("client_id", clientIds)
    .order("score_date", { ascending: false });
  const latestRisk = new Map<string, number>();
  for (const r of (riskRows ?? []) as RiskRow[]) {
    if (!latestRisk.has(r.client_id)) latestRisk.set(r.client_id, r.risk_score);
  }
  const atRisk = Array.from(latestRisk.entries())
    .filter(([, score]) => score >= 50)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, score]) => ({ name: nameById.get(id) ?? "Client", score }));

  const quiet = clients
    .filter((c) => !activeSet.has(c.id))
    .slice(0, 5)
    .map((c) => ({ name: c.full_name }));

  const { count: unreadAlerts } = await supabaseAdmin
    .from("alerts")
    .select("id", { count: "exact", head: true })
    .eq("practitioner_id", practitionerId)
    .eq("is_read", false);

  const { subject, html, text } = renderDigest({
    practitionerName,
    totalCheckins: checkins.length,
    activeClients: activeSet.size,
    totalClients: clients.length,
    flaggedCount,
    unreadAlerts: unreadAlerts ?? 0,
    atRisk,
    quiet,
    dashboardLink: `${APP_BASE_URL}/practitioner/app/dashboard`,
  });

  const res = await fetch(`${GATEWAY_URL}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": resendKey,
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [email],
      subject,
      html,
      text,
      tags: [{ name: "event", value: "weekly_practitioner_digest" }],
    }),
  });
  if (!res.ok) {
    log.error("[weeklyDigest] resend gateway error", res.status, await res.text());
    return "error";
  }
  return "sent";
}

export const Route = createFileRoute("/api/public/hooks/weekly-practitioner-digest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const cronSecret = process.env.CRON_SECRET;
        if (cronSecret) {
          const provided =
            request.headers.get("x-cron-secret") ??
            request.headers.get("X-Cron-Secret") ??
            (request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null);
          if (provided !== cronSecret) return new Response("Unauthorized", { status: 401 });
        } else {
          const apiKey = request.headers.get("apikey") ?? request.headers.get("Apikey");
          if (!apiKey || apiKey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
            return new Response("Unauthorized", { status: 401 });
          }
        }

        const lovableKey = process.env.LOVABLE_API_KEY;
        const resendKey = process.env.RESEND_API_KEY;
        if (!lovableKey || !resendKey) {
          return Response.json({ ok: false, error: "Email service not configured" }, { status: 200 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const stats = { sent: 0, skipped: 0, errors: 0 };
        let from = 0;
        for (;;) {
          const { data: practices, error } = await (supabaseAdmin
            .from("practices") as unknown as {
              select: (s: string) => {
                eq: (c: string, v: unknown) => {
                  range: (f: number, t: number) => Promise<{ data: { practitioner_id: string }[] | null; error: unknown }>;
                };
              };
            })
            .select("practitioner_id, weekly_digest_enabled")
            .eq("weekly_digest_enabled", true)
            .range(from, from + BATCH_SIZE - 1);
          if (error) {
            log.error("[weeklyDigest] practices fetch failed", error);
            break;
          }
          const rows = (practices ?? []) as { practitioner_id: string }[];
          if (rows.length === 0) break;
          for (const p of rows) {
            try {
              const r = await buildAndSend(supabaseAdmin, p.practitioner_id, sinceIso, lovableKey, resendKey);
              stats[r === "sent" ? "sent" : r === "skipped" ? "skipped" : "errors"] += 1;
            } catch (e) {
              stats.errors += 1;
              log.error(`[weeklyDigest] practitioner ${p.practitioner_id} failed`, e);
            }
          }
          if (rows.length < BATCH_SIZE) break;
          from += BATCH_SIZE;
        }

        return Response.json({ ok: true, ...stats });
      },
    },
  },
});
