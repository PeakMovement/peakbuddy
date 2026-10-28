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
import { BUDDY_FLAGS, patientFlag } from "@/lib/buddy-flags";
import {
  dischargeConfirm,
  dischargePhysioResult,
  reopenConfirm,
  reopenPhysioResult,
} from "./discharge";
import { heidiConfig } from "./heidi.server";
import type { OutboundMessage, ProviderSecrets, WhatsAppProvider } from "./provider";
import { answerCaseload, type CaseloadRow } from "./caseload";
import {
  addedNames,
  agentButtons,
  buildPractitionerPrompt,
  carePhrase,
  checkinBody,
  checkinPreview,
  checkinReachWarning,
  choiceBody,
  clarifyButtons,
  confirmOutbound,
  conversationContext,
  decisionsFromGateway,
  deleteRosterAsk,
  dropNamedClients,
  exclusionNames,
  expandReferences,
  extraCheckinNote,
  formatClientList,
  formatPractitionerList,
  isAgentButton,
  joinNames,
  needsPractitionerAgent,
  pendingSummary,
  practitionerToolSchemas,
  isClientListAsk,
  resolveChoice,
  resolveNames,
  sendReport,
  typedEraseConfirm,
  validDecision,
  withPractitioner,
  type AgentDecision,
  type AgentTool,
  type AgentTurnInput,
  type NameHit,
  type ScopedClient,
} from "./practitioner-agent";
import {
  explainFromStored,
  followUpOf,
  handoverOf,
  phrasePractitioner,
  replacedName,
  droppedName,
  sliceStored,
  summariseThread,
} from "./practitioner-talk";
import {
  isCancel,
  isYes,
  type PracMemory,
  type PracPending,
  type PracQueued,
} from "./practitioner-understand";

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
  inboundText: string;
  /** When set, text replies are held so they can share one confirm. */
  hold: string[] | null;
  leadIn: string | null;
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
    const { withoutArchived } = await import("@/lib/client-archive.server");
    const { data } = await withoutArchived((f) => {
      const q = admin.from("clients").select("id, full_name");
      return (f ? q.is("archived_at", null) : q).limit(2000);
    });
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
  const phrased = phrasePractitioner(ctx.inboundText, body);
  if (ctx.hold) {
    ctx.hold.push(phrased);
    return;
  }
  await ctx.deps.reply({ kind: "text", body: phrased });
}

function rememberFocus(ctx: AgentContext, clients: ScopedClient[]): void {
  const list = clients
    .slice(0, 10)
    .map((c) => ({
      id: c.id,
      name: String(c.full_name ?? "").trim() || "A client",
    }))
    .filter((c) => c.id);
  if (!list.length) return;
  const one = list.length === 1 ? list[0] : null;
  ctx.mem.focus = {
    clientId: one?.id,
    clientName: one?.name,
    list,
    at: ctx.deps.now.getTime(),
  };
  if (one) {
    ctx.mem.lastClientId = one.id;
    ctx.mem.lastClientName = one.name;
    ctx.mem.lastClientAt = ctx.deps.now.getTime();
  }
}

function liveFocus(ctx: AgentContext) {
  if (ctx.mem.focus) return ctx.mem.focus;
  if (ctx.mem.lastClientId && ctx.mem.lastClientName) {
    return {
      clientId: ctx.mem.lastClientId,
      clientName: ctx.mem.lastClientName,
      at: ctx.mem.lastClientAt ?? 0,
    };
  }
  return null;
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
  rememberFocus(
    ctx,
    candidates.map((c) => ({ id: c.id, full_name: c.name })),
  );
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
  if (pending.action === "archive") return archiveConfirmBody(pending);
  if (pending.action === "erase") return eraseConfirmBody(pending);
  if (pending.action === "discharge") return dischargeConfirm(joinNames(pending.names));
  if (pending.action === "reopen") return reopenConfirm(joinNames(pending.names));
  if (pending.action === "data_copy") {
    return `Prepare a copy of what Buddy holds for ${joinNames(pending.names)} and send a one-time link if their WhatsApp window is open? I will not add any interpretation.`;
  }
  if (pending.action === "appointment") return pending.preview;
  return confirmOutbound(pending.names, pending.preview, pending.aside);
}

const ARCHIVE_LIST_MAX = 25;

function archiveConfirmBody(pending: Extract<PracPending, { kind: "outbound" }>): string {
  const n = pending.names.length;
  const shown = pending.names.slice(0, ARCHIVE_LIST_MAX).map((name) => `• ${name}`);
  if (n > ARCHIVE_LIST_MAX) shown.push(`• ...and ${n - ARCHIVE_LIST_MAX} more`);
  const why = pending.preview ? ` (${pending.preview})` : "";
  return [
    `I'll archive ${n === 1 ? "this client" : `these ${n} clients`}${why}:`,
    ...shown,
    "",
    'They come off your lists and updates, and Buddy stops all reminders and check-ins. Their records are kept, and "unarchive" plus a name brings anyone back. If they message Buddy themselves, they\'re unarchived automatically.',
    ...(pending.note ? ["", pending.note] : []),
    "",
    n === 1 ? "Archive them?" : "Archive all of them?",
  ].join("\n");
}

function archiveButtons(): Array<{ id: string; title: string }> {
  return [
    { id: "prac_ag_yes", title: "Yes, archive" },
    { id: "prac_ag_no", title: "Cancel" },
  ];
}

function eraseButtons(): Array<{ id: string; title: string }> {
  return [{ id: "prac_ag_no", title: "Cancel" }];
}

function eraseConfirmBody(pending: Extract<PracPending, { kind: "outbound" }>): string {
  const n = pending.names.length;
  const shown = pending.names.slice(0, ARCHIVE_LIST_MAX).map((name) => `• ${name}`);
  if (n > ARCHIVE_LIST_MAX) shown.push(`• ...and ${n - ARCHIVE_LIST_MAX} more`);
  return [
    `This permanently deletes ${n === 1 ? "this client" : `these ${n} clients`} and their WhatsApp messages. It cannot be undone.`,
    ...shown,
    ...(pending.note ? ["", pending.note] : []),
    "",
    `Reply exactly: DELETE ${n}`,
  ].join("\n");
}

async function showOutbound(
  ctx: AgentContext,
  pending: Extract<PracPending, { kind: "outbound" }>,
): Promise<void> {
  setPending(ctx, { ...pending, editing: false });
  const shown = pending.clientIds
    .map((id) => ctx.scopeClients.find((c) => c.id === id))
    .filter((c): c is ScopedClient => Boolean(c));
  if (shown.length) rememberFocus(ctx, shown);
  const waiting = ctx.mem.queued?.length ?? 0;
  const lead = ctx.leadIn?.trim();
  const tail = waiting ? `\n\n${waiting} more still waiting after you confirm this.` : "";
  await ctx.deps.reply({
    kind: "buttons",
    body: `${lead ? `${lead}\n\n` : ""}${outboundBody(pending)}${tail}`,
    buttons:
      pending.action === "archive"
        ? archiveButtons()
        : pending.action === "erase"
          ? eraseButtons()
          : agentButtons(),
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

async function quietClients(ctx: AgentContext): Promise<ScopedClient[]> {
  const st = await import("./practitioner-status.server");
  const ids = ctx.scopeClients.map((c) => c.id);
  if (!ids.length) return [];
  const { data } = await ctx.admin
    .from("clients")
    .select("id, full_name, created_at, auth_user_id")
    .in("id", ids)
    .limit(1000);
  const rows = (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    created_at: string | null;
    auth_user_id: string | null;
  }>;
  const statuses = await st.loadStatuses(ctx.adminIn, rows.length ? rows : ctx.scopeClients.map((c) => ({
    id: c.id,
    full_name: c.full_name,
    created_at: null,
    auth_user_id: null,
  })), ctx.deps.now);
  const quiet = new Set(
    statuses.filter((s) => st.bucketOf(s, ctx.deps.now) === "quiet").map((s) => s.id),
  );
  return ctx.scopeClients.filter((c) => quiet.has(c.id));
}

async function quietClientNames(ctx: AgentContext): Promise<string[]> {
  return (await quietClients(ctx))
    .map((c) => String(c.full_name ?? "").trim())
    .filter(Boolean);
}

async function practitionerLabels(
  ctx: AgentContext,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data } = await ctx.admin
    .from("clients")
    .select("id, practitioner_id")
    .in("id", ids)
    .limit(1000);
  const rows = (data ?? []) as Array<{ id: string; practitioner_id: string | null }>;
  const pracIds = [...new Set(rows.map((row) => row.practitioner_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (pracIds.length) {
    const { data: profs } = await ctx.admin
      .from("profiles")
      .select("id, full_name")
      .in("id", pracIds)
      .limit(200);
    for (const prof of (profs ?? []) as Array<{ id: string; full_name: string | null }>) {
      names.set(
        prof.id,
        String(prof.full_name ?? "")
          .trim()
          .split(/\s+/)[0] || "Unknown",
      );
    }
  }
  for (const row of rows) {
    if (row.practitioner_id) out.set(row.id, names.get(row.practitioner_id) || "Unknown");
  }
  return out;
}

function scopeLabel(ctx: AgentContext): string {
  return ctx.privileged
    ? ctx.practiceName && ctx.practiceName !== "your clients"
      ? `whole practice (${ctx.practiceName})`
      : "whole practice"
    : "your clients only";
}

async function askClarify(ctx: AgentContext, decision: AgentDecision): Promise<void> {
  const buttons = clarifyButtons(decision.options);
  ctx.mem.clarifyOptions = buttons.filter((b) => b.id.startsWith("prac_cl_")).map((b) => b.title);
  await ctx.deps.reply({
    kind: "buttons",
    body: decision.question || `${ctx.prac.firstName}, what should I do?`,
    buttons,
  });
}

async function prepareClients(
  ctx: AgentContext,
  action: Extract<PracPending, { kind: "choose" }>["action"],
  names: string[],
  note: string | null,
): Promise<ScopedClient[] | null> {
  const expanded = expandReferences(
    names.length ? names : action === "status" || action === "messages" ? ["all"] : [],
    liveFocus(ctx),
  );
  if (expanded.unresolved) {
    const options = (ctx.mem.focus?.list ?? [])
      .slice(0, 3)
      .map((c) => c.name.split(/\s+/)[0] || c.name);
    await askClarify(ctx, {
      tool: "clarify",
      names: [],
      note: null,
      task: null,
      question: "Who do you mean?",
      options,
      frequency: null,
      weekday: null,
      time: null,
      enabled: null,
      goal: null,
    });
    return null;
  }
  let queries = expanded.names;
  if (queries.some((q) => q.toLowerCase() === "quiet")) {
    const quiet = await quietClientNames(ctx);
    queries = queries.flatMap((q) => (q.toLowerCase() === "quiet" ? quiet : [q]));
    if (!queries.length) {
      await replyText(ctx, "Nobody on your list has gone quiet.");
      return null;
    }
  }
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
  opts?: { verbatim?: boolean },
): Promise<void> {
  const verbatim = opts?.verbatim === true;
  const names = clients.map((c) => String(c.full_name ?? "").trim() || "A client");
  const hasCustom = verbatim
    ? Boolean(note?.trim())
    : Boolean(extraCheckinNote(note, ctx.practiceName));
  const reach = await previewCheckinReach(ctx, clients);
  const aside = checkinReachWarning(reach, hasCustom) || null;
  await showOutbound(ctx, {
    kind: "outbound",
    action: "checkin",
    clientIds: clients.map((c) => c.id),
    names,
    preview: checkinPreview(ctx.practiceName, note, verbatim),
    note,
    task: null,
    editing: false,
    verbatim,
    aside,
    at: ctx.deps.now.getTime(),
  });
}

async function previewCheckinReach(
  ctx: AgentContext,
  clients: ScopedClient[],
): Promise<Array<{ name: string; reach: "open" | "template" | "busy" | "other" }>> {
  const { windowOpen } = await import("./practitioner-status.server");
  const out: Array<{ name: string; reach: "open" | "template" | "busy" | "other" }> = [];
  for (const client of clients) {
    const name = String(client.full_name ?? "").trim() || "A client";
    const { data: convs } = await ctx.admin
      .from("whatsapp_conversations")
      .select("phone, opted_out_at, state")
      .eq("client_id", client.id)
      .limit(1);
    const conv = (
      (convs ?? []) as Array<{ phone: string; opted_out_at: string | null; state: string }>
    )[0];
    if (!conv || conv.opted_out_at || conv.state === "opted_out") {
      out.push({ name, reach: "other" });
      continue;
    }
    if (conv.state !== "idle") {
      out.push({ name, reach: "busy" });
      continue;
    }
    const open = await windowOpen(ctx.adminIn, conv.phone, ctx.deps.now);
    out.push({ name, reach: open ? "open" : "template" });
  }
  return out;
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
  rememberFocus(ctx, clients);
  if (clients.length === ctx.scopeClients.length && clients.length !== 1) {
    const rc = await import("./reception.server");
    const errands = await rc.openErrandLine(ctx.adminIn, [ctx.prac.userId], ctx.deps.now);
    const body = st.formatStatusAll(ctx.prac.firstName, statuses, ctx.deps.now, ctx.privileged);
    await replyText(ctx, errands ? `${body}\n\n${errands}` : body);
    return;
  }
  const bodies = statuses.map((s) => st.formatStatusOne(s, ctx.deps.now));
  const text = bodies.join("\n\n");
  if (clients.length === 1) ctx.mem.lastFacts = text.slice(0, 800);
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
  rememberFocus(ctx, clients);
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
  | "template_queued"
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
  verbatim = false,
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
  const body = checkinBody(
    firstOf(full),
    ctx.practiceName,
    note,
    { clientId: client.id, now: ctx.deps.now },
    verbatim,
  );
  const hasCustom = verbatim
    ? Boolean(note?.trim())
    : Boolean(extraCheckinNote(note, ctx.practiceName));
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
      if (ok) {
        if (hasCustom) {
          const saved = await queueCustomCheckin(ctx, conv.id, body);
          if (saved) return "template_queued";
        }
        return "template";
      }
    }
    if (clientRow?.auth_user_id) return pushCheckin(ctx, clientRow.auth_user_id, body);
    return "unreachable";
  }
  if (clientRow?.auth_user_id) return pushCheckin(ctx, clientRow.auth_user_id, body);
  return onWhatsApp ? "failed" : "not_registered";
}

/** Practitioner wording waits until the patient replies. Red flags are handled first, in the worker. */
async function queueCustomCheckin(
  ctx: AgentContext,
  conversationId: string,
  body: string,
): Promise<boolean> {
  const { data } = await ctx.admin
    .from("whatsapp_conversations")
    .select("id, draft")
    .eq("id", conversationId)
    .limit(1);
  const row = ((data ?? []) as Array<{ id: string; draft: Record<string, unknown> | null }>)[0];
  if (!row?.id) return false;
  const saved = await ctx.admin
    .from("whatsapp_conversations")
    .update({ draft: { ...(row.draft ?? {}), pendingCustomCheckin: body } })
    .eq("id", row.id)
    .then(
      () => true,
      () => false,
    );
  return saved;
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
  verbatim = false,
): Promise<void> {
  const { recordCheckinRequest } = await import("./practitioner-status.server");
  const rows: Array<{ name: string; how: string }> = [];
  for (const id of ids) {
    if (!ctx.scopeClients.some((c) => c.id === id)) continue;
    const client = ctx.scopeClients.find((c) => c.id === id)!;
    const how = await deliverCheckin(ctx, client, note, verbatim);
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
                : result === "needs_consent"
                  ? "needs_consent"
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

async function proposeCare(
  ctx: AgentContext,
  action: "discharge" | "reopen" | "data_copy",
  clients: ScopedClient[],
): Promise<void> {
  const names = clients.map((c) => String(c.full_name ?? "").trim() || "A client");
  await showOutbound(ctx, {
    kind: "outbound",
    action,
    clientIds: clients.map((c) => c.id),
    names,
    preview: action,
    note: null,
    task: null,
    editing: false,
    at: ctx.deps.now.getTime(),
  });
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
  if (pending.action === "archive") {
    await proposeArchive(ctx, clients, [], null, null, null);
    return;
  }
  if (pending.action === "erase") {
    await proposeErase(ctx, clients, pending.note, null);
    return;
  }
  if (pending.action === "discharge" || pending.action === "reopen" || pending.action === "data_copy") {
    await proposeCare(ctx, pending.action, clients);
    return;
  }
  await proposeCheckin(ctx, clients, pending.note);
}

const QUIET_WORDS =
  /^(?:quiet|the quiet ones?|gone quiet|quiet clients?|quiet patients?)$/i;
const IDLE_WORDS =
  /^(?:all|everyone|everybody|inactive|old|idle|unresponsive|not responding)$/i;

async function archiveTool(ctx: AgentContext, decision: AgentDecision): Promise<void> {
  const ar = await import("@/lib/client-archive.server");
  if (!(await ar.canArchive(ctx.adminIn, ctx.prac.userId))) {
    await replyText(
      ctx,
      "Only the practice owner can archive clients. Ask them if someone should come off the list.",
    );
    return;
  }
  const names = decision.names.filter((n) => n.trim());
  const exclude = decision.exclude ?? [];
  if (names.some((n) => QUIET_WORDS.test(n.trim()))) {
    await proposeExcluded(
      ctx,
      "archive",
      await quietClients(ctx),
      exclude,
      "gone quiet, no check-in for 4 days or more",
      null,
    );
    return;
  }
  const idleMode =
    decision.idleDays != null || !names.length || names.every((n) => IDLE_WORDS.test(n.trim()));
  if (!idleMode) {
    const clients = await prepareClients(ctx, "archive", names, null);
    if (clients?.length) await proposeExcluded(ctx, "archive", clients, exclude, null, null);
    return;
  }
  const days = decision.idleDays ?? ar.DEFAULT_IDLE_DAYS;
  const { idle, heldBack } = await ar.findIdleClients(
    ctx.adminIn,
    ctx.scopeClients,
    days,
    ctx.deps.now,
  );
  const held = heldBack.map((c) => String(c.full_name ?? "").trim() || "A client");
  if (!idle.length) {
    await replyText(
      ctx,
      `Nobody on your list has gone ${days} days without a check-in or message.${held.length ? ` ${joinNames(held)} ${held.length === 1 ? "has" : "have"} been quiet that long but ${held.length === 1 ? "has" : "have"} an open alert, so I've left them.` : ""}`,
    );
    return;
  }
  await proposeArchive(ctx, idle, held, days, null, null);
}

async function labelledNames(ctx: AgentContext, clients: ScopedClient[]): Promise<string[]> {
  const labels = await practitionerLabels(
    ctx,
    clients.map((c) => c.id),
  );
  return clients.map((c) =>
    withPractitioner(String(c.full_name ?? "").trim() || "A client", labels.get(c.id)),
  );
}

async function proposeArchive(
  ctx: AgentContext,
  clients: ScopedClient[],
  heldBack: string[],
  days: number | null,
  reason: string | null,
  extraNote: string | null,
): Promise<void> {
  const ar = await import("@/lib/client-archive.server");
  const capped = clients.slice(0, ar.MAX_ARCHIVE);
  const extra = clients.length - capped.length;
  const notes: string[] = [];
  if (heldBack.length)
    notes.push(
      `I've left out ${joinNames(heldBack)}: ${heldBack.length === 1 ? "they have" : "each has"} an open alert.`,
    );
  if (extra > 0)
    notes.push(`That's the first ${ar.MAX_ARCHIVE}. Ask again for the other ${extra}.`);
  if (extraNote) notes.push(extraNote);
  notes.push(`Scope: ${scopeLabel(ctx)}.`);
  await showOutbound(ctx, {
    kind: "outbound",
    action: "archive",
    clientIds: capped.map((c) => c.id),
    names: await labelledNames(ctx, capped),
    preview: reason || (days ? `no check-in or message from them in ${days} days` : ""),
    note: notes.join(" ") || null,
    task: null,
    editing: false,
    at: ctx.deps.now.getTime(),
  });
}

async function proposeErase(
  ctx: AgentContext,
  clients: ScopedClient[],
  extraNote: string | null,
  actorId: string | null,
): Promise<void> {
  if (!clients.length) {
    await replyText(ctx, "That leaves nobody. Nothing has been deleted.");
    return;
  }
  const capped = clients.slice(0, 50);
  const notes = [`Scope: ${scopeLabel(ctx)}.`, extraNote].filter(Boolean).join(" ");
  await showOutbound(ctx, {
    kind: "outbound",
    action: "erase",
    clientIds: capped.map((c) => c.id),
    names: await labelledNames(ctx, capped),
    preview: "permanent delete",
    note: notes || null,
    task: null,
    editing: false,
    actorId,
    at: ctx.deps.now.getTime(),
  });
}

async function proposeExcluded(
  ctx: AgentContext,
  action: "archive" | "erase",
  clients: ScopedClient[],
  exclusions: string[],
  reason: string | null,
  actorId: string | null,
): Promise<void> {
  const { kept, unmatched } = dropNamedClients(clients, exclusions);
  if (!clients.length) {
    await replyText(
      ctx,
      action === "erase"
        ? "Nobody on that list matches. Nothing has been deleted."
        : "Nobody on your list has gone quiet.",
    );
    return;
  }
  if (!kept.length) {
    await replyText(ctx, "That leaves nobody. I won't delete anyone.");
    return;
  }
  const note = unmatched.length
    ? `Nobody on that list matched ${joinNames(unmatched)}, so I didn't take anyone off for that name.`
    : null;
  if (action === "erase") await proposeErase(ctx, kept, note, actorId);
  else await proposeArchive(ctx, kept, [], null, reason, note);
}

const ADMIN_ONLY_ERASE =
  "Only the Buddy admin can permanently delete clients. I can archive them instead, and their records stay.";

async function eraseTool(ctx: AgentContext, decision: AgentDecision): Promise<void> {
  const { buddyAdminActor } = await import("./practitioner-mode.server");
  const actor = await buddyAdminActor(ctx.adminIn, ctx.prac.userId);
  if (!actor) {
    await replyText(ctx, ADMIN_ONLY_ERASE);
    return;
  }
  const names = decision.names.filter((n) => n.trim());
  const exclude = decision.exclude ?? [];
  if (names.some((n) => QUIET_WORDS.test(n.trim()))) {
    await proposeExcluded(ctx, "erase", await quietClients(ctx), exclude, null, actor);
    return;
  }
  const concrete = names.filter((n) => !QUIET_WORDS.test(n.trim()) && !IDLE_WORDS.test(n.trim()));
  if (!concrete.length) {
    await replyText(ctx, 'Who should I permanently delete? Name them, or say "the gone quiet clients".');
    return;
  }
  const clients = await prepareClients(ctx, "erase", concrete, null);
  if (clients?.length) await proposeExcluded(ctx, "erase", clients, exclude, null, actor);
}

async function executeErase(ctx: AgentContext, ids: string[], actorId: string | null): Promise<void> {
  const { buddyAdminActor } = await import("./practitioner-mode.server");
  const actor = actorId || (await buddyAdminActor(ctx.adminIn, ctx.prac.userId));
  ctx.mem.pending = null;
  if (!actor) {
    await replyText(ctx, ADMIN_ONLY_ERASE);
    return;
  }
  const inScope = ids.filter((id) => ctx.scopeClients.some((c) => c.id === id));
  if (!inScope.length) {
    await replyText(ctx, "Those clients aren't on your list. Nothing has been deleted.");
    return;
  }
  const { data } = await ctx.admin
    .from("clients")
    .select("id, phone, auth_user_id, email, full_name")
    .in("id", inScope)
    .limit(50);
  const rows = (data ?? []) as Array<{
    id: string;
    phone: string | null;
    auth_user_id: string | null;
    email: string | null;
    full_name: string | null;
  }>;
  const { eraseClientRecord } = await import("@/lib/retention.server");
  const gone: string[] = [];
  for (const row of rows) {
    const result = await eraseClientRecord(
      ctx.adminIn,
      row,
      { channel: "whatsapp", actorId: actor },
    );
    if (result.ok) gone.push(String(row.full_name ?? "").trim() || "A client");
  }
  log.info("practitioner agent erase", { count: gone.length });
  ctx.mem.focus = null;
  await replyText(
    ctx,
    gone.length
      ? `Permanently deleted ${gone.length === 1 ? gone[0] : `${gone.length} clients`} (${joinNames(gone)}). Their WhatsApp messages went with the records.`
      : "Sorry, I couldn't delete them just now. Nothing was removed.",
  );
}

async function replyClientList(ctx: AgentContext): Promise<void> {
  const st = await import("./practitioner-status.server");
  const ids = ctx.scopeClients.map((c) => c.id);
  const { data } = ids.length
    ? await ctx.admin
        .from("clients")
        .select("id, full_name, created_at, auth_user_id")
        .in("id", ids)
        .limit(1000)
    : { data: [] };
  const rows = (data ?? []) as Array<{
    id: string;
    full_name: string | null;
    created_at: string | null;
    auth_user_id: string | null;
  }>;
  const statuses = rows.length ? await st.loadStatuses(ctx.adminIn, rows, ctx.deps.now) : [];
  const current = statuses.filter((s) => st.bucketOf(s, ctx.deps.now) !== "inactive").length;
  const labels = await practitionerLabels(ctx, ids);
  const people = [...ctx.scopeClients]
    .map((c) => ({
      name: String(c.full_name ?? "").trim() || "A client",
      practitioner: labels.get(c.id) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (ctx.scopeClients.length) rememberFocus(ctx, ctx.scopeClients);
  await replyText(
    ctx,
    formatClientList({ scopeLabel: scopeLabel(ctx), people, current }),
  );
}

function clientsFromFocus(ctx: AgentContext): ScopedClient[] {
  const focus = liveFocus(ctx);
  return (focus?.list ?? [])
    .map((item) => ctx.scopeClients.find((c) => c.id === item.id))
    .filter((c): c is ScopedClient => Boolean(c));
}

async function handleDeleteRoster(ctx: AgentContext, text: string): Promise<boolean> {
  const ask = deleteRosterAsk(text);
  if (!ask) return false;
  if (ask.permanent) {
    const { buddyAdminActor } = await import("./practitioner-mode.server");
    const actor = await buddyAdminActor(ctx.adminIn, ctx.prac.userId);
    if (!actor) {
      await replyText(ctx, ADMIN_ONLY_ERASE);
      return true;
    }
    if (ask.quiet) {
      await proposeExcluded(ctx, "erase", await quietClients(ctx), ask.exclusions, null, actor);
      return true;
    }
    if (ask.them) {
      const base = clientsFromFocus(ctx);
      if (!base.length) {
        await replyText(
          ctx,
          "I don't have a list to take those from. Ask who's gone quiet, or name the clients.",
        );
        return true;
      }
      await proposeExcluded(ctx, "erase", base, ask.exclusions, null, actor);
      return true;
    }
    if (ask.all) {
      await proposeExcluded(ctx, "erase", ctx.scopeClients, ask.exclusions, null, actor);
      return true;
    }
    if (!ask.names.length) {
      await replyText(
        ctx,
        'Who should I permanently delete? Name them, or say "the gone quiet clients".',
      );
      return true;
    }
    const clients = await prepareClients(ctx, "erase", ask.names, null);
    if (clients?.length) await proposeExcluded(ctx, "erase", clients, ask.exclusions, null, actor);
    return true;
  }
  const ar = await import("@/lib/client-archive.server");
  if (!(await ar.canArchive(ctx.adminIn, ctx.prac.userId))) {
    await replyText(
      ctx,
      "Only the practice owner can archive clients. Ask them if someone should come off the list.",
    );
    return true;
  }
  const reason = ask.quiet ? "gone quiet, no check-in for 4 days or more" : null;
  if (ask.quiet) {
    await proposeExcluded(ctx, "archive", await quietClients(ctx), ask.exclusions, reason, null);
    return true;
  }
  if (ask.them) {
    const base = clientsFromFocus(ctx);
    if (!base.length) {
      await replyText(
        ctx,
        "I don't have a list to take those from. Ask who's gone quiet, or name the clients.",
      );
      return true;
    }
    await proposeExcluded(ctx, "archive", base, ask.exclusions, reason, null);
    return true;
  }
  if (ask.all && ask.exclusions.length) {
    await proposeExcluded(ctx, "archive", ctx.scopeClients, ask.exclusions, reason, null);
    return true;
  }
  return false;
}

async function executeArchive(ctx: AgentContext, ids: string[]): Promise<void> {
  const ar = await import("@/lib/client-archive.server");
  ctx.mem.pending = null;
  if (!(await ar.canArchive(ctx.adminIn, ctx.prac.userId))) {
    await replyText(ctx, "Only the practice owner can archive clients.");
    return;
  }
  const inScope = ids.filter((id) => ctx.scopeClients.some((c) => c.id === id));
  const result = await ar.archiveClients(ctx.adminIn, inScope, ctx.prac.userId, ctx.deps.now);
  log.info("practitioner agent archive", { count: result.count, ok: result.ok });
  if (!result.ok) {
    await replyText(
      ctx,
      "Sorry, I couldn't archive them just now. Archiving may not be switched on yet (it needs a small database update).",
    );
    return;
  }
  ctx.mem.focus = null;
  const names = inScope.map((id) => nameOf(ctx.scopeClients, id));
  await replyText(
    ctx,
    result.count === 0
      ? "They were already archived."
      : `Done. Archived ${result.count === 1 ? names[0] : `${result.count} clients`}. Their records are kept. Say "unarchive" and a name to bring anyone back.`,
  );
}

async function unarchiveTool(ctx: AgentContext, decision: AgentDecision): Promise<void> {
  const ar = await import("@/lib/client-archive.server");
  if (!(await ar.canArchive(ctx.adminIn, ctx.prac.userId))) {
    await replyText(ctx, "Only the practice owner can unarchive clients.");
    return;
  }
  const archived = await ar.loadArchivedInScope(ctx.adminIn, ctx.prac.userId);
  if (!archived.length) {
    await replyText(ctx, "There's nobody archived at the moment.");
    return;
  }
  const names = decision.names.filter((n) => n.trim());
  if (!names.length) {
    await replyText(ctx, 'Who should I bring back? Say a name, or "all".');
    return;
  }
  const hits = resolveNames(names, archived);
  const { resolved, ambiguous, missing } = clientsFromHits(hits);
  if (ambiguous.length) {
    await replyText(
      ctx,
      `I found more than one archived client for that: ${joinNames(ambiguous.map((c) => String(c.full_name ?? "").trim() || "A client"))}. Say the full name.`,
    );
    return;
  }
  if (!resolved.length) {
    await replyText(ctx, `I couldn't find ${joinNames(missing)} among the archived clients.`);
    return;
  }
  const result = await ar.unarchiveClients(
    ctx.adminIn,
    resolved.map((c) => c.id),
  );
  log.info("practitioner agent unarchive", { count: result.count, ok: result.ok });
  const shown = resolved.map((c) => String(c.full_name ?? "").trim() || "A client");
  await replyText(
    ctx,
    !result.ok
      ? "Sorry, I couldn't do that just now. Please try again in a minute."
      : `Done. ${joinNames(shown)} ${shown.length === 1 ? "is" : "are"} back on your list.${missing.length ? ` I couldn't find ${joinNames(missing)} among the archived clients.` : ""} Reminders start again at their usual time.`,
  );
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

function toDecision(row: PracQueued): AgentDecision | null {
  return validDecision(row);
}

const OUTBOUND_TOOLS = new Set<AgentTool>([
  "send_checkin",
  "programme_sent",
  "ask_reception",
  "archive_clients",
  "erase_clients",
  "discharge_client",
  "reopen_episode",
  "prepare_data_copy",
]);

function stash(decision: AgentDecision): PracQueued {
  return {
    tool: decision.tool,
    names: decision.names,
    note: decision.note,
    task: decision.task,
    question: decision.question,
    options: decision.options,
    frequency: decision.frequency,
    weekday: decision.weekday,
    time: decision.time,
    enabled: decision.enabled,
    goal: decision.goal,
    idleDays: decision.idleDays ?? null,
  };
}

/** Run queued actions until the next one needs a confirmation. */
async function drainQueue(ctx: AgentContext): Promise<void> {
  while (ctx.mem.queued?.length && !ctx.mem.pending) {
    const [next, ...rest] = ctx.mem.queued;
    ctx.mem.queued = rest;
    const decision = toDecision(next);
    if (!decision) continue;
    await applyDecision(ctx, decision);
  }
}

async function applyDecision(ctx: AgentContext, decision: AgentDecision): Promise<void> {
  const tool = decision.tool;
  log.info("practitioner agent", { tool, names: decision.names.length });
  if (tool === "confirm_pending") {
    if (ctx.mem.pending?.kind === "outbound") {
      await confirmPending(ctx);
      await drainQueue(ctx);
      return;
    }
    if (ctx.mem.pending?.kind === "choose") {
      await finishChoice(
        ctx,
        ctx.mem.pending.candidates.map((c) => c.id),
      );
      await drainQueue(ctx);
      return;
    }
    await askClarify(ctx, {
      ...decision,
      tool: "clarify",
      question: "I don't have anything waiting. What should I do?",
      options: [],
    });
    return;
  }
  if (tool === "cancel_pending") {
    ctx.mem.pending = null;
    ctx.mem.queued = [];
    await replyText(ctx, "Okay, I won't.");
    return;
  }
  if (tool === "clarify") {
    await askClarify(ctx, decision);
    return;
  }
  if (tool === "help") {
    const { PRAC_MSG } = await import("./practitioner-mode.server");
    const { HEIDI_MSG } = await import("./heidi");
    await ctx.deps.reply({
      kind: "buttons",
      body: PRAC_MSG.help(ctx.prac.firstName) + (heidiConfig() ? `\n${HEIDI_MSG.helpLine}` : ""),
      buttons: [
        { id: "prac_status", title: "How are my clients" },
        { id: "prac_updates", title: "Regular updates" },
      ],
    });
    return;
  }
  ctx.mem.pending = null;
  if (tool === "archive_clients") {
    await archiveTool(ctx, decision);
    return;
  }
  if (tool === "erase_clients") {
    await eraseTool(ctx, decision);
    return;
  }
  if (tool === "list_clients") {
    await replyClientList(ctx);
    return;
  }
  if (tool === "unarchive_clients") {
    await unarchiveTool(ctx, decision);
    return;
  }
  if (tool === "list_practitioners") {
    if (isClientListAsk(ctx.inboundText)) {
      await replyClientList(ctx);
      return;
    }
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
  if (tool === "dismiss_morning") {
    const { MORNING_MSG } = await import("./morning-checkin");
    await replyText(ctx, MORNING_MSG.skipped);
    return;
  }
  if (tool === "set_morning_checkin") {
    const { MORNING_MSG } = await import("./morning-checkin");
    const { saveMorningCheckinEnabled } = await import("./morning-checkin.server");
    const enabled = decision.enabled === true;
    const ok = await saveMorningCheckinEnabled(ctx.adminIn, ctx.prac.userId, enabled, ctx.deps.now);
    await replyText(
      ctx,
      ok ? (enabled ? MORNING_MSG.optedIn : MORNING_MSG.optedOut) : MORNING_MSG.failed,
    );
    return;
  }
  if (tool === "set_programme_reminder") {
    const clients = await prepareClients(ctx, "status", decision.names, null);
    const client = clients?.[0];
    if (!client) return;
    const tools = await import("./capability-tools.server");
    const days = decision.programmeDays ?? [];
    const ok = await tools.saveProgrammeReminder(
      ctx.adminIn,
      client.id,
      days,
      decision.programmeOptIn === true,
    );
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const named = days
      .map((d) => labels[d] ?? "")
      .filter(Boolean)
      .join(", ");
    await replyText(
      ctx,
      ok
        ? decision.programmeOptIn
          ? `Saved. ${client.full_name ?? "They"} will get a programme reminder on ${named}. I have not sent one yet.`
          : `Saved ${named} for ${client.full_name ?? "them"}. I won't message them until they opt in.`
        : "Sorry, I couldn't save those reminder days just now.",
    );
    return;
  }
  if (tool === "case_brief" || tool === "set_goal") {
    const clients = await prepareClients(ctx, "status", decision.names, null);
    const client = clients?.[0];
    if (!client) return;
    const tools = await import("./capability-tools.server");
    if (tool === "set_goal") {
      const ok = await tools.saveClientGoal(ctx.adminIn, client.id, decision.goal ?? "");
      await replyText(
        ctx,
        ok
          ? `Saved. I won't change ${client.full_name ?? "their"} goal.`
          : "Sorry, I couldn't save that goal just now.",
      );
      return;
    }
    await replyText(ctx, await tools.replyCaseBrief(ctx.adminIn, client));
    return;
  }
  if (tool === "explain_client") {
    const clients = await prepareClients(ctx, "status", decision.names, null);
    const client = clients?.[0];
    if (!client) return;
    await replyText(ctx, await explainClient(ctx, client));
    return;
  }
  if (tool === "caseload_query") {
    await replyText(ctx, await caseloadAnswer(ctx, decision.question || ctx.inboundText));
    return;
  }
  if (tool === "summarise_thread") {
    await replyText(ctx, summariseThread(ctx.mem.turns ?? []));
    return;
  }
  if (tool === "pause_buddy" || tool === "resume_buddy") {
    const clients = await prepareClients(ctx, "status", decision.names, null);
    const client = clients?.[0];
    if (!client) return;
    const paused = tool === "pause_buddy";
    const ok = await setBuddyPaused(ctx, client.id, paused);
    const who = String(client.full_name ?? "").trim() || "them";
    await replyText(
      ctx,
      ok
        ? paused
          ? `I'll stay quiet on ${who}'s chat until you hand it back. Nothing was sent to them.`
          : `I'll pick ${who}'s chat back up, with what was already saved.`
        : "I couldn't update that chat just now. Nothing was sent.",
    );
    return;
  }
  if (tool === "who_improved") {
    const tools = await import("./capability-tools.server");
    await replyText(ctx, await tools.replyWhoImproved(ctx.adminIn, ctx.scopeClients, ctx.deps.now));
    return;
  }
  if (tool === "outcomes") {
    const tools = await import("./capability-tools.server");
    await replyText(
      ctx,
      await tools.replyScorecard(ctx.adminIn, ctx.prac.userId, ctx.scopeClients, ctx.deps.now),
    );
    return;
  }
  if (tool === "confirm_quiet_nudges") {
    const { sendPendingQuietNudges } = await import("./quiet-nudge.server");
    const n = await sendPendingQuietNudges(
      ctx.adminIn,
      { provider: ctx.deps.provider, secrets: ctx.deps.secrets },
      ctx.prac.userId,
      ctx.deps.now,
    );
    await replyText(
      ctx,
      n === 0
        ? "There isn't a quiet-patient reminder waiting for a yes."
        : `Sent today's check-in reminder to ${n}.`,
    );
    return;
  }
  if (tool === "book_reception") {
    await proposeReception(ctx, decision.task ?? "");
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
    return;
  }
  if (tool === "discharge_client" || tool === "reopen_episode" || tool === "prepare_data_copy") {
    const flagged =
      tool === "prepare_data_copy" ? BUDDY_FLAGS.dataExportSend : BUDDY_FLAGS.discharge;
    if (!patientFlag(flagged)) {
      await replyText(
        ctx,
        tool === "prepare_data_copy"
          ? "Sending a copy is not switched on yet. Nothing was sent. You can still prepare the file on their client page."
          : "Discharge is not switched on yet. I have not changed their reminders.",
      );
      return;
    }
    if (decision.names.some((n) => n.toLowerCase() === "all")) {
      await replyText(ctx, "Name the client. I will not do that for everyone at once.");
      return;
    }
    const action =
      tool === "discharge_client" ? "discharge" : tool === "reopen_episode" ? "reopen" : "data_copy";
    const clients = await prepareClients(ctx, action, decision.names, null);
    if (clients) await proposeCare(ctx, action, clients);
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
  if (pending.action === "archive") {
    await executeArchive(ctx, pending.clientIds);
    return;
  }
  if (pending.action === "erase") {
    await executeErase(ctx, pending.clientIds, pending.actorId ?? null);
    return;
  }
  if (pending.action === "discharge" || pending.action === "reopen") {
    await executeEpisode(ctx, pending.action, pending.clientIds);
    return;
  }
  if (pending.action === "data_copy") {
    await executeDataCopy(ctx, pending.clientIds);
    return;
  }
  if (pending.action === "appointment") {
    await executeAppointment(ctx, pending.clientIds[0], pending.task, pending.names[0]);
    return;
  }
  await executeCheckins(ctx, pending.clientIds, pending.note, pending.verbatim === true);
}

function scopedIds(ctx: AgentContext, ids: string[]): string[] {
  return [...new Set(ids)].filter((id) => ctx.scopeClients.some((c) => c.id === id));
}

async function executeEpisode(
  ctx: AgentContext,
  action: "discharge" | "reopen",
  ids: string[],
): Promise<void> {
  ctx.mem.pending = null;
  if (!patientFlag(BUDDY_FLAGS.discharge)) {
    await replyText(ctx, "Discharge is not switched on yet. I have not changed their reminders.");
    return;
  }
  const allowed = scopedIds(ctx, ids);
  if (!allowed.length) {
    await replyText(ctx, "Those clients are not on your list, so I did not change anything.");
    return;
  }
  const { setDischarged, tellDischargePaused } = await import("./care.server");
  const admin = ctx.admin as unknown as import("@supabase/supabase-js").SupabaseClient;
  const lines: string[] = [];
  for (const id of allowed) {
    const name = nameOf(ctx.scopeClients, id);
    const saved = await setDischarged(admin, id, action === "discharge", ctx.deps.now);
    if (!saved) {
      lines.push(`I could not update ${name} just now.`);
      continue;
    }
    if (action === "reopen") {
      lines.push(reopenPhysioResult(name));
      continue;
    }
    const told = await tellDischargePaused(
      admin,
      { provider: ctx.deps.provider, secrets: ctx.deps.secrets },
      id,
      ctx.deps.now,
    );
    lines.push(dischargePhysioResult(name, told));
  }
  await replyText(ctx, lines.join("\n"));
}

async function executeDataCopy(ctx: AgentContext, ids: string[]): Promise<void> {
  ctx.mem.pending = null;
  if (!patientFlag(BUDDY_FLAGS.dataExportSend)) {
    await replyText(
      ctx,
      "Sending a copy is not switched on yet. Nothing was sent. You can still prepare the file on their client page.",
    );
    return;
  }
  const allowed = scopedIds(ctx, ids).slice(0, 3);
  if (!allowed.length) {
    await replyText(ctx, "Those clients are not on your list, so I did not prepare a copy.");
    return;
  }
  const { loadExportBundle, mintExportLink, sendExportLink, exportCounts, exportReadyNote } =
    await import("./data-copy.server");
  const admin = ctx.admin as unknown as import("@supabase/supabase-js").SupabaseClient;
  const lines: string[] = [];
  for (const id of allowed) {
    const name = nameOf(ctx.scopeClients, id);
    const bundle = await loadExportBundle(admin, [id]);
    const counts = exportCounts(bundle);
    const link = await mintExportLink(admin, id, ctx.prac.userId);
    if (!link) {
      lines.push(`I could not prepare a link for ${name} just now.`);
      continue;
    }
    const sent = await sendExportLink(
      admin,
      { provider: ctx.deps.provider, secrets: ctx.deps.secrets },
      id,
      link.url,
      ctx.deps.now,
    );
    lines.push(exportReadyNote(name, counts, sent));
  }
  await replyText(ctx, lines.join("\n"));
}

async function executeAppointment(
  ctx: AgentContext,
  clientId: string | undefined,
  iso: string | null,
  name: string | undefined,
): Promise<void> {
  ctx.mem.pending = null;
  if (!patientFlag(BUDDY_FLAGS.appointmentWrite)) {
    await replyText(ctx, "Saving a visit time is not switched on yet. I did not store one.");
    return;
  }
  if (!clientId || !iso || !ctx.scopeClients.some((c) => c.id === clientId)) {
    await replyText(ctx, "I could not match that visit to one client, so I did not store a time.");
    return;
  }
  const { error } = await ctx.admin.from("clients").update({ next_appointment: iso }).eq("id", clientId);
  if (error) {
    log.warn("next appointment save failed", { code: (error as { code?: string }).code });
    await replyText(ctx, "I could not store that time just now.");
    return;
  }
  const who = name || nameOf(ctx.scopeClients, clientId);
  await replyText(ctx, `Saved. ${who}'s next visit is stored. I did not invent a slot.`);
}

function blankDecision(tool: AgentTool, names: string[]): AgentDecision {
  return {
    tool,
    names,
    note: null,
    task: null,
    question: null,
    options: [],
    frequency: null,
    weekday: null,
    time: null,
    enabled: null,
    goal: null,
  };
}

async function repropose(
  ctx: AgentContext,
  pending: Extract<PracPending, { kind: "outbound" }>,
  clients: ScopedClient[],
): Promise<void> {
  if (!clients.length) {
    ctx.mem.pending = null;
    ctx.mem.queued = [];
    await replyText(ctx, "Okay, I won't.");
    return;
  }
  if (pending.action === "programme") {
    await proposeProgramme(ctx, clients);
    return;
  }
  if (pending.action === "archive") {
    await proposeArchive(ctx, clients, [], null, pending.preview || null, null);
    return;
  }
  if (pending.action === "erase") {
    await proposeErase(ctx, clients, null, pending.actorId ?? null);
    return;
  }
  if (pending.action === "discharge" || pending.action === "reopen" || pending.action === "data_copy") {
    await proposeCare(ctx, pending.action, clients);
    return;
  }
  await proposeCheckin(ctx, clients, pending.note, { verbatim: pending.verbatim === true });
}

async function swapRecipients(
  ctx: AgentContext,
  pending: Extract<PracPending, { kind: "outbound" }>,
  name: string,
): Promise<void> {
  const hits = resolveNames([name], ctx.scopeClients);
  const { resolved, ambiguous } = clientsFromHits(hits);
  if (ambiguous.length && resolved.length !== 1) {
    const action =
      pending.action === "programme"
        ? "programme"
        : pending.action === "discharge"
          ? "discharge"
          : pending.action === "reopen"
            ? "reopen"
            : pending.action === "data_copy"
              ? "data_copy"
              : "checkin";
    await askChoice(ctx, action, ambiguous, [], pending.note, `Who did you mean by ${name}?`);
    return;
  }
  const client = resolved[0];
  if (!client) {
    await replyText(ctx, `I couldn't find ${name} on your list. I have not sent anything.`);
    return;
  }
  await repropose(ctx, pending, [client]);
}

async function dropRecipient(
  ctx: AgentContext,
  pending: Extract<PracPending, { kind: "outbound" }>,
  drop: "pronoun" | string,
): Promise<void> {
  let ids = pending.clientIds;
  if (drop === "pronoun") {
    const last = ctx.mem.focus?.clientId ?? ctx.mem.lastClientId;
    ids = last && ids.includes(last) ? ids.filter((id) => id !== last) : ids.slice(0, -1);
  } else {
    const needle = drop.toLowerCase();
    ids = ids.filter((id) => {
      const full = nameOf(ctx.scopeClients, id).toLowerCase();
      const first = full.split(/\s+/)[0] ?? "";
      return full !== needle && first !== needle && !full.startsWith(`${needle} `);
    });
  }
  const clients = ids.map((id) => ctx.scopeClients.find((c) => c.id === id)).filter((c): c is ScopedClient => Boolean(c));
  await repropose(ctx, pending, clients);
}

async function explainClient(ctx: AgentContext, client: ScopedClient): Promise<string> {
  const name = String(client.full_name ?? "").trim() || "This client";
  const { data: risks } = await ctx.admin
    .from("risk_scores")
    .select("risk_score, summary, delta_vs_baseline")
    .eq("client_id", client.id)
    .order("score_date", { ascending: false })
    .limit(1);
  const risk = ((risks ?? []) as Array<Record<string, unknown>>)[0];
  const { data: checks } = await ctx.admin
    .from("check_ins")
    .select("pain_level, sleep_quality, energy_level, stress_level, notes")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })
    .limit(1);
  const check = ((checks ?? []) as Array<Record<string, unknown>>)[0];
  const breakdown = Array.isArray((risk?.delta_vs_baseline as { breakdown?: unknown } | undefined)?.breakdown)
    ? ((risk?.delta_vs_baseline as { breakdown: Array<{ metric?: string; direction?: string }> }).breakdown)
    : [];
  const worse = breakdown.filter((b) => b.direction === "worse").map((b) => String(b.metric ?? "")).filter(Boolean);
  const better = breakdown.filter((b) => b.direction === "better").map((b) => String(b.metric ?? "")).filter(Boolean);
  const line = explainFromStored({
    name,
    riskScore: typeof risk?.risk_score === "number" ? risk.risk_score : null,
    summary: typeof risk?.summary === "string" ? risk.summary : null,
    worse,
    better,
    lastPain: typeof check?.pain_level === "number" ? check.pain_level : null,
    lastSleep: typeof check?.sleep_quality === "number" ? check.sleep_quality : null,
    lastEnergy: typeof check?.energy_level === "number" ? check.energy_level : null,
    lastStress: typeof check?.stress_level === "number" ? check.stress_level : null,
    lastNote: typeof check?.notes === "string" ? check.notes : null,
  });
  ctx.mem.lastFacts = line.slice(0, 800);
  ctx.mem.lastClientId = client.id;
  ctx.mem.lastClientName = name;
  ctx.mem.lastClientAt = ctx.deps.now.getTime();
  return line;
}

async function caseloadAnswer(ctx: AgentContext, question: string): Promise<string> {
  const ids = ctx.scopeClients.map((c) => c.id);
  if (!ids.length) return "Nobody on your list matches that from the stored check ins.";
  const { data: clients } = await ctx.admin
    .from("clients")
    .select("id, full_name, primary_complaint")
    .in("id", ids)
    .limit(200);
  const { data: checks } = await ctx.admin
    .from("check_ins")
    .select("client_id, pain_level, sleep_quality, exercise_adherence, created_at")
    .in("client_id", ids)
    .order("created_at", { ascending: false })
    .limit(800);
  const weekAgo = ctx.deps.now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const byClient = new Map<string, Array<Record<string, unknown>>>();
  for (const row of (checks ?? []) as Array<Record<string, unknown>>) {
    const id = String(row.client_id ?? "");
    const list = byClient.get(id) ?? [];
    list.push(row);
    byClient.set(id, list);
  }
  const rows: CaseloadRow[] = ((clients ?? []) as Array<Record<string, unknown>>).map((c) => {
    const list = byClient.get(String(c.id)) ?? [];
    const latest = list[0];
    const previous = list.find((row) => row !== latest && typeof row.pain_level === "number");
    const adherence = latest?.exercise_adherence;
    return {
      name: String(c.full_name ?? "").trim() || "A client",
      complaint: typeof c.primary_complaint === "string" ? c.primary_complaint : null,
      adherence:
        adherence === "all" || adherence === "most" || adherence === "some" || adherence === "none"
          ? adherence
          : null,
      pain: typeof latest?.pain_level === "number" ? latest.pain_level : null,
      previousPain: typeof previous?.pain_level === "number" ? previous.pain_level : null,
      sleep: typeof latest?.sleep_quality === "number" ? latest.sleep_quality : null,
      checkedInThisWeek: list.some((row) => new Date(String(row.created_at ?? 0)).getTime() >= weekAgo),
    };
  });
  return answerCaseload(question, rows) ?? "Nobody on your list matches that from the stored check ins.";
}

async function setBuddyPaused(ctx: AgentContext, clientId: string, paused: boolean): Promise<boolean> {
  const { data } = await ctx.admin
    .from("whatsapp_conversations")
    .select("id, draft")
    .eq("client_id", clientId)
    .limit(1);
  const row = ((data ?? []) as Array<{ id: string; draft: Record<string, unknown> | null }>)[0];
  if (!row?.id) return false;
  const draft = { ...(row.draft ?? {}) };
  if (paused) draft.buddyPaused = { at: ctx.deps.now.toISOString(), told: false };
  else delete draft.buddyPaused;
  const saved = await ctx.admin
    .from("whatsapp_conversations")
    .update({ draft })
    .eq("id", row.id)
    .then(
      () => true,
      () => false,
    );
  if (!saved) return false;
  await ctx.admin
    .from("whatsapp_conversations")
    .update(
      paused
        ? { buddy_paused_at: ctx.deps.now.toISOString(), buddy_paused_by: ctx.prac.userId }
        : { buddy_paused_at: null, buddy_paused_by: null, buddy_pause_note: null },
    )
    .eq("id", row.id)
    .then(
      () => undefined,
      () => undefined,
    );
  return true;
}

async function answerFollowUp(ctx: AgentContext, follow: ReturnType<typeof followUpOf>): Promise<boolean> {
  if (!follow) return false;
  if (follow === "summary") {
    await replyText(ctx, summariseThread(ctx.mem.turns ?? []));
    return true;
  }
  const focus = liveFocus(ctx);
  if (follow === "others") {
    const rest = (ctx.mem.focus?.list ?? []).filter((c) => c.id !== focus?.clientId);
    if (!rest.length) {
      await replyText(ctx, "I don't have another client from that list.");
      return true;
    }
    await applyDecision(
      ctx,
      blankDecision(
        "client_status",
        rest.map((c) => c.name),
      ),
    );
    return true;
  }
  const name = focus?.clientName;
  if (!name) return false;
  if (follow === "why") {
    await applyDecision(ctx, blankDecision("explain_client", [name]));
    return true;
  }
  if (ctx.mem.lastFacts) {
    await replyText(ctx, sliceStored(follow, ctx.mem.lastFacts));
    return true;
  }
  await applyDecision(ctx, blankDecision("client_status", [name]));
  return true;
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
  if (pending.kind === "outbound" && pending.action === "archive" && pending.editing) {
    pending.editing = false;
  }
  if (pending.kind === "outbound" && pending.editing) {
    const typed = text.replace(/\s+/g, " ").trim().slice(0, 500);
    if (!typed) {
      await replyText(ctx, "What should I say instead?");
      return true;
    }
    const clients = pending.clientIds
      .map((id) => ctx.scopeClients.find((c) => c.id === id))
      .filter((c): c is ScopedClient => Boolean(c));
    if (pending.action === "reception") {
      await proposeReception(ctx, typed);
      return true;
    }
    if (pending.action === "programme") {
      await proposeProgramme(ctx, clients);
      return true;
    }
    await proposeCheckin(ctx, clients, typed, { verbatim: true });
    return true;
  }
  if (
    pending.kind === "outbound" &&
    (pending.action === "archive" || pending.action === "erase" || pending.action === "checkin")
  ) {
    const exclusions = exclusionNames(text);
    if (exclusions.length) {
      const current = pending.clientIds
        .map((id) => ctx.scopeClients.find((c) => c.id === id))
        .filter((c): c is ScopedClient => Boolean(c));
      if (pending.action === "checkin") {
        const { kept, unmatched } = dropNamedClients(current, exclusions);
        if (unmatched.length) {
          await replyText(
            ctx,
            `Nobody on that list matched ${joinNames(unmatched)}, so I didn't take anyone off for that name.`,
          );
        }
        if (!kept.length) {
          ctx.mem.pending = null;
          await replyText(ctx, "That leaves nobody. I won't message anyone.");
          return true;
        }
        await proposeCheckin(ctx, kept, pending.note, { verbatim: pending.verbatim === true });
        return true;
      }
      await proposeExcluded(
        ctx,
        pending.action,
        current,
        exclusions,
        pending.action === "archive" ? pending.preview || null : null,
        pending.actorId ?? null,
      );
      return true;
    }
  }
  if (pending.kind === "outbound" && pending.action === "erase") {
    const count = pending.clientIds.length || pending.names.length;
    if (!replyId && typedEraseConfirm(text, count)) {
      await confirmPending(ctx);
      await drainQueue(ctx);
      return true;
    }
    if (replyId === "prac_ag_yes" || (!replyId && isYes(text))) {
      await replyText(ctx, `Nothing has been deleted. Reply exactly: DELETE ${count}`);
      return true;
    }
  }
  if (
    pending.kind === "outbound" &&
    pending.action !== "archive" &&
    pending.action !== "erase" &&
    (replyId === "prac_ag_edit" || /^edit$/i.test(text.trim()))
  ) {
    if (
      pending.action === "discharge" ||
      pending.action === "reopen" ||
      pending.action === "data_copy" ||
      pending.action === "appointment"
    ) {
      await replyText(ctx, "Reply Yes to go ahead, or Cancel.");
      return true;
    }
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
    pending.action !== "erase" &&
    (replyId === "prac_ag_yes" ||
      (!replyId &&
        (isYes(text) || acceptsAll(text, pending.clientIds.length || pending.names.length))))
  ) {
    await confirmPending(ctx);
    await drainQueue(ctx);
    return true;
  }
  if (pending.kind === "choose") {
    const picked = resolveChoice(text, pending.candidates);
    if (picked) {
      await finishChoice(ctx, [...pending.resolvedIds, ...picked]);
      await drainQueue(ctx);
      return true;
    }
  }
  if (pending.kind === "outbound" && pending.action !== "reception" && pending.action !== "appointment") {
    const replacement = replacedName(text);
    if (replacement) {
      await swapRecipients(ctx, pending, replacement);
      return true;
    }
    const drop = droppedName(text);
    if (drop) {
      await dropRecipient(ctx, pending, drop);
      return true;
    }
  }
  if (
    pending.kind === "outbound" &&
    (pending.action === "checkin" || pending.action === "programme")
  ) {
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

function asDecisions(raw: unknown): AgentDecision[] {
  if (Array.isArray(raw)) {
    return raw
      .map((row) => validDecision(row))
      .filter((row): row is AgentDecision => row != null)
      .slice(0, 4);
  }
  const fromGateway = decisionsFromGateway(raw);
  if (fromGateway.length) return fromGateway;
  const one = validDecision(raw);
  return one ? [one] : [];
}

async function understand(ctx: AgentContext, text: string): Promise<AgentDecision[]> {
  const pending = pendingSummary(ctx.mem.pending);
  const input: AgentTurnInput = {
    practitionerName: ctx.prac.firstName,
    practiceName: ctx.practiceName,
    message: text,
    history: ctx.mem.turns ?? [],
    pending,
    context: conversationContext(liveFocus(ctx), pending),
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
    return asDecisions(raw);
  } catch (e) {
    log.warn("practitioner agent failed", { error: e instanceof Error ? e.message : "unknown" });
    return [];
  }
}

const TEXT_READS = new Set<AgentTool>([
  "client_status",
  "read_messages",
  "list_practitioners",
  "practice_overview",
  "red_flags",
  "quiet_clients",
  "usage",
  "case_brief",
  "who_improved",
  "outcomes",
  "explain_client",
  "caseload_query",
  "summarise_thread",
]);

/** Answer every ask. Read-only answers share the one confirm. Nothing sends here. */
async function applyMany(ctx: AgentContext, decisions: AgentDecision[]): Promise<void> {
  const work = decisions.filter((d) => d.tool !== "clarify" || decisions.length === 1);
  const use = work.some((d) => d.tool !== "clarify")
    ? work.filter((d) => d.tool !== "clarify")
    : work;
  if (!use.length) return;
  const reads = use.filter((d) => !OUTBOUND_TOOLS.has(d.tool));
  const outs = use.filter((d) => OUTBOUND_TOOLS.has(d.tool));
  if (outs.length >= 1 && reads.length >= 1 && reads.every((d) => TEXT_READS.has(d.tool))) {
    ctx.hold = [];
    for (const decision of reads) await applyDecision(ctx, decision);
    const prefix = (ctx.hold ?? []).filter(Boolean).join("\n\n");
    ctx.hold = null;
    ctx.mem.queued = outs.slice(1).map(stash).slice(0, 4);
    ctx.leadIn = prefix || null;
    await applyDecision(ctx, outs[0]);
    ctx.leadIn = null;
    return;
  }
  ctx.mem.queued = use.slice(1).map(stash);
  await applyDecision(ctx, use[0]);
  if (!OUTBOUND_TOOLS.has(use[0].tool)) await drainQueue(ctx);
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
    inboundText: msg.text,
    hold: null,
    leadIn: null,
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

  if (isClientListAsk(msg.text)) {
    ctx.mem.pending = null;
    await replyClientList(ctx);
    return true;
  }

  if (await handleDeleteRoster(ctx, msg.text)) return true;

  const follow = followUpOf(msg.text);
  if (follow && (await answerFollowUp(ctx, follow))) return true;

  const hand = handoverOf(msg.text);
  if (hand) {
    await applyDecision(ctx, blankDecision(hand.action, [hand.name]));
    return true;
  }

  if (answerCaseload(msg.text, []) != null && !/\b(message|send|ask reception)\b/i.test(msg.text)) {
    await applyDecision(ctx, { ...blankDecision("caseload_query", []), question: msg.text.slice(0, 300) });
    return true;
  }

  const care = carePhrase(msg.text);
  if (care) {
    await applyDecision(ctx, {
      tool: care.tool,
      names: [care.name],
      note: null,
      task: null,
      question: null,
      options: [],
      frequency: null,
      weekday: null,
      time: null,
      enabled: null,
      goal: null,
    });
    return true;
  }

  const decisions = await understand(ctx, msg.text);
  if (!decisions.length) {
    if (mem.pending?.kind === "choose") {
      await replyText(
        ctx,
        choiceBody('Which one? Reply with a number, a name, or "all".', mem.pending.candidates),
      );
      return true;
    }
    if (mem.pending?.kind === "outbound") {
      await ctx.deps.reply({
        kind: "buttons",
        body: outboundBody(mem.pending),
        buttons:
          mem.pending.action === "archive"
            ? archiveButtons()
            : mem.pending.action === "erase"
              ? eraseButtons()
              : agentButtons(),
      });
      return true;
    }
    return false;
  }
  await applyMany(ctx, decisions);
  return true;
}
