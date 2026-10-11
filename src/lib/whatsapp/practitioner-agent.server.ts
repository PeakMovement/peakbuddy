/**
 * Runs the practitioner agent: resolve names inside the practitioner's
 * scope, ask when a name is ambiguous, and confirm before anything is sent
 * to a patient or to reception.
 *
 * The model (decidePractitionerTurn, or a test double) only picks a tool.
 * Replies are built from what the database returned. Logs are counts and
 * tool names, never names, notes or message text.
 */
import { log } from "@/lib/log";
import { heidiConfig } from "./heidi.server";
import type { OutboundMessage, ProviderSecrets, WhatsAppProvider } from "./provider";
import {
  addedNames,
  agentButtons,
  buildPractitionerPrompt,
  checkinBody,
  checkinPreview,
  choiceBody,
  confirmOutbound,
  extraCheckinNote,
  formatPractitionerList,
  isAgentButton,
  joinNames,
  needsPractitionerAgent,
  pendingSummary,
  practitionerToolSchemas,
  resolveChoice,
  resolveNames,
  sendReport,
  validDecision,
  type AgentDecision,
  type AgentTurnInput,
  type NameHit,
  type ScopedClient,
} from "./practitioner-agent";
import { isCancel, isYes, type PracMemory, type PracPending } from "./practitioner-understand";

type Admin = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

/** Chainable read/write used only inside this file. Results are cast at each call. */
interface Query extends Promise<{ data: unknown; error: { message?: string } | null }> {
  select(columns?: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: readonly unknown[]): Query;
  gte(column: string, value: unknown): Query;
  lt(column: string, value: unknown): Query;
  is(column: string, value: unknown): Query;
  order(column: string, options?: unknown): Query;
  limit(count: number): Query;
  maybeSingle(): Promise<{ data: unknown; error: { message?: string } | null }>;
  insert(row: unknown): Query;
  upsert(row: unknown): Query;
  update(row: unknown): Query;
}

type Db = { from: (table: string) => Query; auth: Admin["auth"] };

type Outgoing = OutboundMessage extends infer T
  ? T extends unknown
    ? Omit<T, "to">
    : never
  : never;

const MAX_SEND = 15;

export interface AgentDeps {
  provider: WhatsAppProvider;
  secrets: ProviderSecrets;
  reply: (message: Outgoing) => Promise<void>;
  now: Date;
  understand?: (input: AgentTurnInput) => Promise<unknown>;
}

interface RosterPerson {
  id: string;
  name: string;
}

interface AgentContext {
  adminIn: Admin;
  admin: Db;
  prac: { userId: string; firstName: string };
  deps: AgentDeps;
  mem: PracMemory;
  scopeClients: ScopedClient[];
  practiceName: string;
  privileged: boolean;
}

const firstOf = (name: string) => name.trim().split(/\s+/)[0] || "there";

async function loadAgentContext(
  adminIn: Admin,
  prac: { userId: string; firstName: string },
): Promise<{ clients: ScopedClient[]; practiceName: string; privileged: boolean }> {
  const { loadScope } = await import("./practitioner-admin.server");
  const scope = await loadScope(adminIn, prac.userId);
  const admin = adminIn as unknown as Db;
  let practiceName = "Peak Movement";
  const label = scope.label.trim();
  if (
    scope.practice &&
    label &&
    !["your clients", "the practice", "all practices"].includes(label)
  ) {
    practiceName = label;
  } else {
    const { data: member } = await admin
      .from("practice_members")
      .select("practice_id")
      .eq("user_id", prac.userId)
      .eq("status", "active")
      .limit(1);
    const practiceId = (member as Array<{ practice_id?: string }> | null)?.[0]?.practice_id;
    if (practiceId) {
      const { data: practice } = await admin
        .from("practices")
        .select("practice_name")
        .eq("id", practiceId)
        .maybeSingle();
      const named = String(
        (practice as { practice_name?: string | null } | null)?.practice_name ?? "",
      ).trim();
      if (named) practiceName = named;
    }
  }
  const { data: prof } = await admin
    .from("profiles")
    .select("role")
    .eq("id", prac.userId)
    .maybeSingle();
  const role = (prof as { role?: string } | null)?.role ?? "";
  let clients = scope.clients.map((c) => ({ id: c.id, full_name: c.full_name }));
  const privileged = scope.practice || role === "admin" || role === "super_admin";
  if (privileged && !scope.practice) {
    const { data } = await admin.from("clients").select("id, full_name").limit(2000);
    clients = (data ?? []) as ScopedClient[];
  }
  return { clients, practiceName, privileged };
}

async function listRoster(ctx: AgentContext): Promise<RosterPerson[]> {
  const { data: prof } = await ctx.admin
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", ctx.prac.userId)
    .maybeSingle();
  const me = prof as { id: string; full_name: string | null; role: string | null } | null;
  const myName = String(me?.full_name ?? "").trim() || ctx.prac.firstName;
  const role = me?.role ?? "";
  const privileged = ctx.privileged || role === "super_admin" || role === "admin";
  if (!privileged) return [{ id: ctx.prac.userId, name: myName }];

  const [{ data: owned }, { data: memberOf }] = await Promise.all([
    ctx.admin
      .from("practices")
      .select("id, practitioner_id")
      .eq("practitioner_id", ctx.prac.userId),
    ctx.admin
      .from("practice_members")
      .select("practice_id, role")
      .eq("user_id", ctx.prac.userId)
      .eq("status", "active"),
  ]);
  let practiceIds = [
    ...((owned ?? []) as Array<{ id: string }>).map((p) => p.id),
    ...((memberOf ?? []) as Array<{ practice_id: string; role: string }>)
      .filter((m) => m.role === "owner" || m.role === "admin")
      .map((m) => m.practice_id),
  ];
  if (!practiceIds.length && (role === "super_admin" || role === "admin")) {
    const { data: all } = await ctx.admin.from("practices").select("id").limit(20);
    practiceIds = ((all ?? []) as Array<{ id: string }>).map((p) => p.id);
  }
  const ids = new Set<string>([ctx.prac.userId]);
  if (practiceIds.length) {
    const [{ data: practices }, { data: members }] = await Promise.all([
      ctx.admin.from("practices").select("id, practitioner_id").in("id", practiceIds),
      ctx.admin
        .from("practice_members")
        .select("user_id, status")
        .in("practice_id", practiceIds)
        .eq("status", "active")
        .limit(200),
    ]);
    for (const p of (practices ?? []) as Array<{ practitioner_id: string | null }>) {
      if (p.practitioner_id) ids.add(p.practitioner_id);
    }
    for (const m of (members ?? []) as Array<{ user_id: string }>) ids.add(m.user_id);
  }
  const { data: profs } = await ctx.admin
    .from("profiles")
    .select("id, full_name, role")
    .in("id", [...ids])
    .limit(200);
  const people = (
    (profs ?? []) as Array<{ id: string; full_name: string | null; role: string | null }>
  )
    .filter((p) => p.role === "practitioner" || p.role === "admin" || p.role === "super_admin")
    .map((p) => ({ id: p.id, name: String(p.full_name ?? "").trim() || "Unnamed" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return people.length ? people : [{ id: ctx.prac.userId, name: myName }];
}

function nameOf(clients: ScopedClient[], id: string): string {
  return String(clients.find((c) => c.id === id)?.full_name ?? "").trim() || "A client";
}

async function replyText(ctx: AgentContext, body: string): Promise<void> {
  await ctx.deps.reply({ kind: "text", body });
}

function setPending(ctx: AgentContext, pending: PracPending): void {
  ctx.mem.pending = { ...pending, at: ctx.deps.now.getTime() };
  ctx.mem.confirm = null;
}

async function askChoice(
  ctx: AgentContext,
  action: Extract<PracPending, { kind: "choose" }>["action"],
  ambiguous: ScopedClient[],
  resolvedIds: string[],
  note: string | null,
  intro: string,
): Promise<void> {
  const candidates = ambiguous.slice(0, 10).map((c, i) => ({
    n: i + 1,
    id: c.id,
    name: String(c.full_name ?? "").trim() || "Unnamed client",
  }));
  setPending(ctx, {
    kind: "choose",
    action,
    candidates,
    resolvedIds,
    note,
    at: ctx.deps.now.getTime(),
  });
  await replyText(ctx, choiceBody(intro, candidates));
}

function outboundBody(pending: Extract<PracPending, { kind: "outbound" }>): string {
  if (pending.action === "reception") {
    const task = pending.preview.charAt(0).toLowerCase() + pending.preview.slice(1);
    return `I'll ask reception to ${task}. Send?`;
  }
  if (pending.action === "programme") {
    return `I'll tell ${joinNames(pending.names)} their programme is ready. Send?`;
  }
  return confirmOutbound(pending.names, pending.preview);
}

async function showOutbound(
  ctx: AgentContext,
  pending: Extract<PracPending, { kind: "outbound" }>,
): Promise<void> {
  setPending(ctx, { ...pending, editing: false });
  await ctx.deps.reply({
    kind: "buttons",
    body: outboundBody(pending),
    buttons: agentButtons(),
  });
}

function clientsFromHits(hits: NameHit[]): {
  resolved: ScopedClient[];
  ambiguous: ScopedClient[];
  missing: string[];
} {
  const resolved: ScopedClient[] = [];
  const ambiguous: ScopedClient[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (hit.status === "none") missing.push(hit.query);
    else if (hit.status === "one") {
      if (!seen.has(hit.client.id)) {
        seen.add(hit.client.id);
        resolved.push(hit.client);
      }
    } else if (hit.status === "many") {
      for (const c of hit.clients) {
        if (!seen.has(c.id)) ambiguous.push(c);
      }
    } else {
      for (const c of hit.clients) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          resolved.push(c);
        }
      }
    }
  }
  return { resolved, ambiguous, missing };
}

async function prepareClients(
  ctx: AgentContext,
  action: "checkin" | "programme" | "status" | "messages" | "heidi",
  names: string[],
  note: string | null,
): Promise<ScopedClient[] | null> {
  const queries = names.length
    ? names
    : action === "status" || action === "messages"
      ? ["all"]
      : [];
  if (!queries.length) {
    await replyText(ctx, 'Who should I include? A first name is enough, or say "all".');
    return null;
  }
  const hits = resolveNames(queries, ctx.scopeClients);
  const { resolved, ambiguous, missing } = clientsFromHits(hits);
  if (hits.some((h) => h.status === "all")) {
    if (!ctx.scopeClients.length) {
      await replyText(ctx, "You don't have any clients on Buddy yet.");
      return null;
    }
    if ((action === "checkin" || action === "programme") && ctx.scopeClients.length > MAX_SEND) {
      await replyText(
        ctx,
        `That's ${ctx.scopeClients.length} clients. I can message ${MAX_SEND} at a time. Name who you want, or say "the first ${MAX_SEND}".`,
      );
      return null;
    }
    return action === "checkin" || action === "programme"
      ? ctx.scopeClients.slice(0, MAX_SEND)
      : ctx.scopeClients;
  }
  if (!resolved.length && !ambiguous.length) {
    await replyText(
      ctx,
      `I couldn't find ${joinNames(missing)} on your list. Try a first and last name.`,
    );
    return null;
  }
  if (ambiguous.length) {
    const already = resolved.length
      ? `I'll include ${joinNames(resolved.map((c) => String(c.full_name)))}. `
      : "";
    const who = missing.length ? ` I couldn't find ${joinNames(missing)}.` : "";
    await askChoice(
      ctx,
      action,
      ambiguous,
      resolved.map((c) => c.id),
      note,
      `${already}I found more than one client for part of that.${who} Who did you mean?`,
    );
    return null;
  }
  if (missing.length) {
    await replyText(ctx, `I couldn't find ${joinNames(missing)} on your list.`);
  }
  return resolved;
}

async function proposeCheckin(
  ctx: AgentContext,
  clients: ScopedClient[],
  note: string | null,
): Promise<void> {
  const names = clients.map((c) => String(c.full_name ?? "").trim() || "A client");
  await showOutbound(ctx, {
    kind: "outbound",
    action: "checkin",
    clientIds: clients.map((c) => c.id),
    names,
    preview: checkinPreview(ctx.practiceName, note),
    note,
    task: null,
    editing: false,
    at: ctx.deps.now.getTime(),
  });
}

async function proposeProgramme(ctx: AgentContext, clients: ScopedClient[]): Promise<void> {
  const names = clients.map((c) => String(c.full_name ?? "").trim() || "A client");
  await showOutbound(ctx, {
    kind: "outbound",
    action: "programme",
    clientIds: clients.map((c) => c.id),
    names,
    preview: "Your programme is ready.",
    note: null,
    task: null,
    editing: false,
    at: ctx.deps.now.getTime(),
  });
}

async function proposeReception(ctx: AgentContext, task: string): Promise<void> {
  const tidy = task.trim();
  if (tidy.length < 3) {
    await replyText(ctx, "What should I pass on to reception?");
    return;
  }
  await showOutbound(ctx, {
    kind: "outbound",
    action: "reception",
    clientIds: [],
    names: ["reception"],
    preview: tidy,
    note: null,
    task: tidy,
    editing: false,
    at: ctx.deps.now.getTime(),
  });
}

async function readStatuses(ctx: AgentContext, clients: ScopedClient[]): Promise<void> {
  const st = await import("./practitioner-status.server");
  const admin = ctx.adminIn;
  const rows = clients.map((c) => ({
    id: c.id,
    full_name: c.full_name,
    created_at: null as string | null,
    auth_user_id: null as string | null,
  }));
  const { data } = await ctx.admin
    .from("clients")
    .select("id, full_name, created_at, auth_user_id")
    .in(
      "id",
      clients.map((c) => c.id),
    )
    .limit(1000);
  const full = (data ?? rows) as typeof rows;
  const statuses = await st.loadStatuses(admin, full.length ? full : rows, ctx.deps.now);
  if (clients.length === ctx.scopeClients.length && clients.length !== 1) {
    await replyText(
      ctx,
      st.formatStatusAll(ctx.prac.firstName, statuses, ctx.deps.now, ctx.privileged),
    );
    return;
  }
  const bodies = statuses.map((s) => st.formatStatusOne(s, ctx.deps.now));
  const text = bodies.join("\n\n");
  await replyText(
    ctx,
    text.length > 3800 ? `${text.slice(0, 3700)}\n...and more in the Buddy app.` : text,
  );
}

async function readMessages(ctx: AgentContext, clients: ScopedClient[]): Promise<void> {
  const inbox = await import("./practitioner-inbox.server");
  const open = await inbox.loadOpenAlerts(
    ctx.adminIn,
    clients.map((c) => c.id),
    ctx.deps.now,
  );
  if (clients.length === ctx.scopeClients.length && clients.length !== 1) {
    await replyText(ctx, inbox.formatInbox(ctx.prac.firstName, clients, open, ctx.deps.now));
    return;
  }
  const chunks = clients.map((c) =>
    inbox.formatClientMessages(
      String(c.full_name ?? "").trim() || "A client",
      open.filter((a) => a.clientId === c.id),
      ctx.deps.now,
    ),
  );
  const text = chunks.join("\n\n");
  await replyText(
    ctx,
    text.length > 3800 ? `${text.slice(0, 3700)}\n...and more in the Buddy app.` : text,
  );
}

type Reach =
  | "whatsapp"
  | "template"
  | "push"
  | "busy"
  | "queued"
  | "unreachable"
  | "not_registered"
  | "failed";

async function deliverCheckin(
  ctx: AgentContext,
  client: ScopedClient,
  note: string | null,
): Promise<Reach> {
  const { data: convs } = await ctx.admin
    .from("whatsapp_conversations")
    .select("id, phone, opted_out_at, state")
    .eq("client_id", client.id)
    .limit(1);
  const conv = (
    (convs ?? []) as Array<{
      id: string;
      phone: string;
      opted_out_at: string | null;
      state: string;
    }>
  )[0];
  const { data: row } = await ctx.admin
    .from("clients")
    .select("auth_user_id, full_name")
    .eq("id", client.id)
    .maybeSingle();
  const clientRow = row as { auth_user_id: string | null; full_name: string | null } | null;
  const full = String(clientRow?.full_name ?? client.full_name ?? "").trim();
  const body = checkinBody(firstOf(full), ctx.practiceName, note);
  const onWhatsApp = Boolean(conv && !conv.opted_out_at && conv.state !== "opted_out");

  if (onWhatsApp && conv) {
    if (conv.state !== "idle" && conv.state !== "opted_out") return "busy";
    const { windowOpen, sendLogged } = await import("./practitioner-status.server");
    const env = { provider: ctx.deps.provider, secrets: ctx.deps.secrets };
    if (await windowOpen(ctx.adminIn, conv.phone, ctx.deps.now)) {
      const ok = await sendLogged(
        ctx.adminIn,
        env,
        { kind: "text", to: conv.phone, body },
        "[practitioner check-in]",
      );
      return ok ? "whatsapp" : "failed";
    }
    const template = process.env.WHATSAPP_REMINDER_TEMPLATE?.trim();
    if (template) {
      const ok = await sendLogged(
        ctx.adminIn,
        env,
        {
          kind: "template",
          to: conv.phone,
          templateName: template,
          languageCode: process.env.WHATSAPP_REMINDER_TEMPLATE_LANG?.trim() || "en",
          variables: [firstOf(full)],
          buttonPayloads: ["start_checkin"],
        },
        `[check-in template ${template}]`,
      );
      if (ok) return "template";
    }
    if (clientRow?.auth_user_id) return pushCheckin(ctx, clientRow.auth_user_id, body);
    return "unreachable";
  }
  if (clientRow?.auth_user_id) return pushCheckin(ctx, clientRow.auth_user_id, body);
  return onWhatsApp ? "failed" : "not_registered";
}

async function pushCheckin(ctx: AgentContext, userId: string, body: string): Promise<Reach> {
  try {
    const { sendPushCore } = await import("@/lib/push.functions");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await sendPushCore(supabaseAdmin, {
      userId,
      title: "Buddy check-in",
      body: body.slice(0, 180),
      data: { type: "checkin_request" },
    });
    return "push";
  } catch (e) {
    log.warn("practitioner check-in push failed", {
      error: e instanceof Error ? e.message : "unknown",
    });
    return "failed";
  }
}

async function executeCheckins(
  ctx: AgentContext,
  ids: string[],
  note: string | null,
): Promise<void> {
  const { recordCheckinRequest } = await import("./practitioner-status.server");
  const rows: Array<{ name: string; how: string }> = [];
  for (const id of ids) {
    if (!ctx.scopeClients.some((c) => c.id === id)) continue;
    const client = ctx.scopeClients.find((c) => c.id === id)!;
    const how = await deliverCheckin(ctx, client, note);
    if (how === "whatsapp" || how === "template" || how === "push") {
      await recordCheckinRequest(ctx.adminIn, id, ctx.prac.userId, ctx.deps.now);
    }
    rows.push({ name: nameOf(ctx.scopeClients, id), how });
  }
  ctx.mem.pending = null;
  log.info("practitioner agent send", {
    tool: "send_checkin",
    count: rows.length,
    whatsapp: rows.filter((r) => r.how === "whatsapp").length,
    template: rows.filter((r) => r.how === "template").length,
    push: rows.filter((r) => r.how === "push").length,
  });
  await replyText(ctx, rows.length ? sendReport(rows) : "Those clients aren't on your list.");
}

async function executeProgramme(ctx: AgentContext, ids: string[]): Promise<void> {
  const { notifyProgrammeSent } = await import("./practitioner-mode.server");
  const rows: Array<{ name: string; how: string }> = [];
  for (const id of ids) {
    const client = ctx.scopeClients.find((c) => c.id === id);
    if (!client) continue;
    const result = await notifyProgrammeSent(
      ctx.adminIn,
      { id: client.id, full_name: client.full_name },
      ctx.prac,
      ctx.deps,
    );
    const how =
      result === "whatsapp"
        ? "whatsapp"
        : result === "template"
          ? "template"
          : result === "app"
            ? "push"
            : result === "later"
              ? "queued"
              : result === "not_registered"
                ? "not_registered"
                : "failed";
    rows.push({ name: nameOf(ctx.scopeClients, id), how });
  }
  ctx.mem.pending = null;
  log.info("practitioner agent send", { tool: "programme_sent", count: rows.length });
  await replyText(ctx, sendReport(rows));
}

async function executeReception(ctx: AgentContext, task: string): Promise<void> {
  const rc = await import("./reception.server");
  const result = await rc.sendToReception(
    ctx.adminIn,
    { provider: ctx.deps.provider, secrets: ctx.deps.secrets },
    {
      practitionerId: ctx.prac.userId,
      practitionerName: ctx.prac.firstName,
      task,
      now: ctx.deps.now,
    },
  );
  ctx.mem.pending = null;
  log.info("practitioner agent send", { tool: "ask_reception", result });
  await replyText(ctx, rc.RECEPTION_MSG.toPractitioner(result));
}

async function finishChoice(ctx: AgentContext, ids: string[]): Promise<void> {
  const pending = ctx.mem.pending;
  if (!pending || pending.kind !== "choose") return;
  const unique = [...new Set(ids)].filter((id) => ctx.scopeClients.some((c) => c.id === id));
  if (!unique.length) {
    await replyText(ctx, choiceBody("I still need a name from this list.", pending.candidates));
    return;
  }
  ctx.mem.pending = null;
  const clients = unique.map((id) => ctx.scopeClients.find((c) => c.id === id)!).filter(Boolean);
  if (pending.action === "status") {
    await readStatuses(ctx, clients);
    return;
  }
  if (pending.action === "messages") {
    await readMessages(ctx, clients);
    return;
  }
  if (pending.action === "heidi") {
    await readHeidi(ctx, clients);
    return;
  }
  if (pending.action === "programme") {
    await proposeProgramme(ctx, clients);
    return;
  }
  await proposeCheckin(ctx, clients, pending.note);
}

async function readHeidi(ctx: AgentContext, clients: ScopedClient[]): Promise<void> {
  if (!heidiConfig()) {
    await replyText(ctx, "Heidi isn't connected on Buddy yet, so I can't read those notes.");
    return;
  }
  const client = clients[0];
  if (!client) return;
  const full = String(client.full_name ?? "").trim();
  if (full.split(/\s+/).length < 2) {
    await replyText(ctx, `I need a first and last name before I look in Heidi.`);
    return;
  }
  const { handleHeidiTurn } = await import("./heidi.server");
  try {
    await handleHeidiTurn(
      ctx.adminIn,
      ctx.prac,
      { kind: "pick", clientId: client.id },
      ctx.scopeClients,
      { reply: ctx.deps.reply, now: ctx.deps.now },
    );
  } catch (e) {
    log.warn("practitioner heidi read failed", {
      error: e instanceof Error ? e.message : "unknown",
    });
    await replyText(ctx, "I couldn't reach Heidi just now. Please try again in a minute.");
  }
}

async function applyDecision(ctx: AgentContext, decision: AgentDecision): Promise<void> {
  const tool = decision.tool;
  ctx.mem.pending = null;
  log.info("practitioner agent", { tool, names: decision.names.length });
  if (tool === "clarify") {
    await replyText(ctx, decision.question || "What would you like me to do?");
    return;
  }
  if (tool === "list_practitioners") {
    const people = await listRoster(ctx);
    await replyText(
      ctx,
      formatPractitionerList(
        ctx.practiceName,
        people.map((p) => ({ name: p.name, you: p.id === ctx.prac.userId })),
      ),
    );
    return;
  }
  if (
    tool === "practice_overview" ||
    tool === "red_flags" ||
    tool === "quiet_clients" ||
    tool === "usage"
  ) {
    const topic =
      tool === "red_flags"
        ? "redflags"
        : tool === "quiet_clients"
          ? "quiet"
          : tool === "usage"
            ? "usage"
            : "overview";
    const { adminAnswer } = await import("./practitioner-admin.server");
    await replyText(ctx, await adminAnswer(ctx.adminIn, ctx.prac.userId, topic, ctx.deps.now));
    return;
  }
  if (tool === "schedule_updates") {
    const st = await import("./practitioner-status.server");
    const frequency = decision.frequency ?? "menu";
    if (frequency === "menu") {
      await ctx.deps.reply({
        kind: "buttons",
        body: st.UPDATE_MSG.menu,
        buttons: [
          { id: "prac_upd_daily", title: "Daily, 7:30am" },
          { id: "prac_upd_weekly", title: "Mondays, 7:30am" },
          { id: "prac_upd_off", title: "No updates" },
        ],
      });
      return;
    }
    const pref = {
      frequency,
      weekday: decision.weekday ?? 1,
      time: decision.time ?? "07:30",
    };
    const ok = await st.saveUpdatePrefs(ctx.adminIn, ctx.prac.userId, pref, ctx.deps.now);
    await replyText(
      ctx,
      ok ? st.UPDATE_MSG.saved(pref.frequency, pref.weekday, pref.time) : st.UPDATE_MSG.failed,
    );
    return;
  }
  if (tool === "ask_reception") {
    await proposeReception(ctx, decision.task ?? "");
    return;
  }
  if (tool === "heidi_read") {
    if (!heidiConfig()) {
      await replyText(ctx, "Heidi isn't connected on Buddy yet, so I can't read those notes.");
      return;
    }
    const clients = await prepareClients(ctx, "heidi", decision.names, null);
    if (clients) await readHeidi(ctx, clients);
    return;
  }
  if (tool === "client_status" || tool === "read_messages") {
    const action = tool === "client_status" ? "status" : "messages";
    const clients = await prepareClients(ctx, action, decision.names, null);
    if (!clients) return;
    if (action === "status") await readStatuses(ctx, clients);
    else await readMessages(ctx, clients);
    return;
  }
  if (tool === "send_checkin" || tool === "programme_sent") {
    const action = tool === "send_checkin" ? "checkin" : "programme";
    const clients = await prepareClients(ctx, action, decision.names, decision.note);
    if (!clients) return;
    if (action === "checkin") await proposeCheckin(ctx, clients, decision.note);
    else await proposeProgramme(ctx, clients);
  }
}

async function confirmPending(ctx: AgentContext): Promise<void> {
  const pending = ctx.mem.pending;
  if (!pending || pending.kind !== "outbound") return;
  if (pending.action === "reception") {
    await executeReception(ctx, pending.task ?? pending.preview);
    return;
  }
  if (pending.action === "programme") {
    await executeProgramme(ctx, pending.clientIds);
    return;
  }
  await executeCheckins(ctx, pending.clientIds, pending.note);
}

function acceptsAll(text: string, count: number): boolean {
  const n = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(yes|yep|yeah|y|ya|send|send it|go ahead|please do|do it|confirm)$/.test(n)) return true;
  const all = n.match(/^(?:all|everyone|all of them)(?:\s+(\d+|four|three|two|five|six))?$/);
  if (!all) return false;
  if (!all[1]) return true;
  const words: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6 };
  const num = /^\d+$/.test(all[1]) ? Number(all[1]) : words[all[1]];
  return num === count;
}

async function handlePending(
  ctx: AgentContext,
  text: string,
  replyId: string | null,
): Promise<boolean> {
  const pending = ctx.mem.pending;
  if (!pending) return false;
  if (replyId === "prac_ag_no" || (!replyId && isCancel(text))) {
    ctx.mem.pending = null;
    await replyText(ctx, "Okay, I won't.");
    return true;
  }
  if (pending.kind === "outbound" && pending.editing) {
    if (needsPractitionerAgent(text) && !extraCheckinNote(text, ctx.practiceName)) return false;
    const note = extraCheckinNote(text, ctx.practiceName) ?? text.trim().slice(0, 240);
    if (pending.action === "reception") {
      await proposeReception(ctx, note);
      return true;
    }
    if (pending.action === "programme") {
      await proposeProgramme(
        ctx,
        pending.clientIds.map((id) => ctx.scopeClients.find((c) => c.id === id)!).filter(Boolean),
      );
      return true;
    }
    await proposeCheckin(
      ctx,
      pending.clientIds.map((id) => ctx.scopeClients.find((c) => c.id === id)!).filter(Boolean),
      note,
    );
    return true;
  }
  if (pending.kind === "outbound" && (replyId === "prac_ag_edit" || /^edit$/i.test(text.trim()))) {
    pending.editing = true;
    pending.at = ctx.deps.now.getTime();
    await replyText(
      ctx,
      pending.action === "reception"
        ? "What should I pass on instead?"
        : "What should I say instead?",
    );
    return true;
  }
  if (
    pending.kind === "outbound" &&
    (replyId === "prac_ag_yes" ||
      (!replyId &&
        (isYes(text) || acceptsAll(text, pending.clientIds.length || pending.names.length))))
  ) {
    await confirmPending(ctx);
    return true;
  }
  if (pending.kind === "choose") {
    const picked = resolveChoice(text, pending.candidates);
    if (picked) {
      await finishChoice(ctx, [...pending.resolvedIds, ...picked]);
      return true;
    }
  }
  if (pending.kind === "outbound" && pending.action !== "reception") {
    const extra = addedNames(text);
    if (extra) {
      const hits = resolveNames(extra, ctx.scopeClients);
      const { resolved, ambiguous, missing } = clientsFromHits(hits);
      if (ambiguous.length) {
        await askChoice(
          ctx,
          pending.action === "programme" ? "programme" : "checkin",
          ambiguous,
          [...pending.clientIds, ...resolved.map((c) => c.id)],
          pending.note,
          `I'll keep ${joinNames(pending.names)}. Who did you mean besides that?`,
        );
        return true;
      }
      if (!resolved.length) {
        await replyText(
          ctx,
          `I couldn't find ${joinNames(missing.length ? missing : extra)} on your list.`,
        );
        return true;
      }
      const ids = [...new Set([...pending.clientIds, ...resolved.map((c) => c.id)])];
      const clients = ids.map((id) => ctx.scopeClients.find((c) => c.id === id)!).filter(Boolean);
      if (pending.action === "programme") await proposeProgramme(ctx, clients);
      else await proposeCheckin(ctx, clients, pending.note);
      return true;
    }
  }
  return false;
}

async function understand(ctx: AgentContext, text: string): Promise<AgentDecision | null> {
  const input: AgentTurnInput = {
    practitionerName: ctx.prac.firstName,
    practiceName: ctx.practiceName,
    message: text,
    history: ctx.mem.turns ?? [],
    pending: pendingSummary(ctx.mem.pending),
    heidiEnabled: Boolean(heidiConfig()),
    canSeeAllPractitioners: ctx.privileged,
  };
  const prompt = buildPractitionerPrompt(input);
  try {
    // Tests inject `understand`. A live Gemini call during vitest would depend
    // on whatever secrets the sandbox has, so the suite stays on the mock or
    // the phrase matcher.
    const raw = ctx.deps.understand
      ? await ctx.deps.understand(input)
      : process.env.VITEST
        ? null
        : await (
            await import("./ai.server")
          ).decidePractitionerTurn({
            system: prompt.system,
            messages: prompt.messages,
            tools: practitionerToolSchemas(input.heidiEnabled),
          });
    return validDecision(raw);
  } catch (e) {
    log.warn("practitioner agent failed", { error: e instanceof Error ? e.message : "unknown" });
    return null;
  }
}

/**
 * True when the agent answered. False means the caller should use the
 * phrase matcher, including when the model is down.
 */
export async function runPractitionerAgent(
  adminIn: Admin,
  prac: { userId: string; firstName: string },
  msg: { text: string; replyId: string | null },
  deps: AgentDeps,
  mem: PracMemory,
): Promise<boolean> {
  const loaded = await loadAgentContext(adminIn, prac);
  const ctx: AgentContext = {
    adminIn,
    admin: adminIn as unknown as Db,
    prac,
    deps,
    mem,
    scopeClients: loaded.clients,
    practiceName: loaded.practiceName,
    privileged: loaded.privileged,
  };

  if (msg.replyId && !isAgentButton(msg.replyId)) return false;

  if (mem.pending && !isAgentButton(msg.replyId)) {
    const { practitionerIntent } = await import("./practitioner-status.server");
    const kind = practitionerIntent(msg.text, null).kind;
    const interrupt = [
      "status_all",
      "updates",
      "updates_menu",
      "admin",
      "reception",
      "reception_ask",
      "reception_confirm",
      "reception_open",
      "checked_in",
      "messages",
    ].includes(kind);
    if (interrupt && !needsPractitionerAgent(msg.text)) {
      mem.pending = null;
      return false;
    }
  }

  if (await handlePending(ctx, msg.text, msg.replyId)) return true;

  const decision = await understand(ctx, msg.text);
  if (!decision) {
    if (mem.pending?.kind === "choose") {
      await replyText(
        ctx,
        choiceBody(
          'Sorry, I didn\'t quite get that. Reply with a number, a name, or "all".',
          mem.pending.candidates,
        ),
      );
      return true;
    }
    if (mem.pending?.kind === "outbound") {
      await ctx.deps.reply({
        kind: "buttons",
        body: `Sorry, I didn't quite get that.\n${outboundBody(mem.pending)}`,
        buttons: agentButtons(),
      });
      return true;
    }
    return false;
  }
  await applyDecision(ctx, decision);
  return true;
}
