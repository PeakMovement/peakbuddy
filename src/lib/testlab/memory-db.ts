/**
 * An in-memory stand-in for the parts of supabase-js Buddy's WhatsApp code
 * uses. The Test Lab runs the real worker against this, so nothing it does
 * touches live patients. The tables round-trip through JSON, so a Lab
 * session can be saved between messages.
 *
 * Unknown tables read as empty. Unknown query methods are ignored rather
 * than throwing, so a new filter somewhere degrades to "matches more".
 */

export type Row = Record<string, any>;
export type Tables = Record<string, Row[]>;

export interface MemoryUser {
  id: string;
  email?: string | null;
  phone?: string | null;
}

export interface MemoryDb {
  tables: Tables;
  users: MemoryUser[];
  admin: any;
}

/** Unique keys the live database enforces that Buddy relies on. */
const UNIQUE_KEYS: Record<string, string[][]> = {};

export function memoryDb(tables: Tables, users: MemoryUser[] = []): MemoryDb {
  let idSeq = Object.values(tables).reduce((n, rows) => n + rows.length, 0);
  const newId = () => {
    idSeq++;
    const hex = idSeq.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${hex}`;
  };

  function builder(table: string) {
    const rows = () => (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" | "insert" | "delete" = "select";
    let patch: Row | null = null;
    let inserted: Row[] = [];
    let orderBy: Array<{ col: string; asc: boolean }> = [];
    let lim = Infinity;
    let offset = 0;
    let head = false;
    let count = false;
    let returning = false;
    let error: { code: string; message: string } | null = null;

    const run = (): Row[] => {
      if (op === "insert") return inserted;
      let matched = rows().filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of matched) Object.assign(r, structuredClone(patch));
        return returning ? matched : [];
      }
      if (op === "delete") {
        tables[table] = rows().filter((r) => !matched.includes(r));
        return returning ? matched : [];
      }
      for (const { col, asc } of [...orderBy].reverse()) {
        matched = [...matched].sort(
          (a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1),
        );
      }
      return matched.slice(offset, offset + lim);
    };

    const likeRe = (v: string, flags = "") =>
      new RegExp(
        `^${String(v)
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/%/g, ".*")}$`,
        flags,
      );

    const cond = (c: string, opName: string, v: string): ((r: Row) => boolean) => {
      const val = v === "null" ? null : v;
      switch (opName) {
        case "eq":
          return (r) => String(r[c]) === String(val);
        case "neq":
          return (r) => String(r[c]) !== String(val);
        case "is":
          return (r) => (r[c] ?? null) === (val === "true" ? true : val === "false" ? false : val);
        case "ilike":
          return (r) => likeRe(String(val), "i").test(String(r[c] ?? ""));
        case "like":
          return (r) => likeRe(String(val)).test(String(r[c] ?? ""));
        case "gt":
          return (r) => r[c] != null && r[c] > val!;
        case "gte":
          return (r) => r[c] != null && r[c] >= val!;
        case "lt":
          return (r) => r[c] != null && r[c] < val!;
        case "lte":
          return (r) => r[c] != null && r[c] <= val!;
        case "in": {
          const list = String(val)
            .replace(/^\(|\)$/g, "")
            .split(",");
          return (r) => list.includes(String(r[c]));
        }
        default:
          return () => true;
      }
    };

    const api: any = new Proxy(
      {
        select(_cols?: string, o?: { count?: string; head?: boolean }) {
          if (op !== "select") returning = true;
          if (o?.head) head = true;
          if (o?.count) count = true;
          return api;
        },
        insert(r: Row | Row[]) {
          op = "insert";
          const list = (Array.isArray(r) ? r : [r]).map((x) => ({
            id: newId(),
            created_at: new Date().toISOString(),
            ...structuredClone(x),
          }));
          for (const row of list) {
            const clash = (UNIQUE_KEYS[table] ?? []).some((keys) =>
              rows().some((e) => keys.every((k) => e[k] != null && e[k] === row[k])),
            );
            if (clash) {
              error = {
                code: "23505",
                message: `duplicate key value violates unique constraint on ${table}`,
              };
              inserted = [];
              return api;
            }
          }
          rows().push(...list);
          inserted = list;
          return api;
        },
        upsert(r: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) {
          op = "insert";
          const keys = (o?.onConflict ?? "id").split(",").map((k) => k.trim());
          inserted = [];
          for (const x of Array.isArray(r) ? r : [r]) {
            const existing = rows().find((e) => keys.every((k) => e[k] === x[k]));
            if (existing) {
              if (!o?.ignoreDuplicates) Object.assign(existing, structuredClone(x));
              inserted.push(existing);
            } else {
              const row = {
                id: newId(),
                created_at: new Date().toISOString(),
                ...structuredClone(x),
              };
              rows().push(row);
              inserted.push(row);
            }
          }
          return api;
        },
        update(p: Row) {
          op = "update";
          patch = p;
          return api;
        },
        delete() {
          op = "delete";
          return api;
        },
        eq(c: string, v: any) {
          filters.push((r) => r[c] === v);
          return api;
        },
        neq(c: string, v: any) {
          filters.push((r) => r[c] !== v);
          return api;
        },
        is(c: string, v: any) {
          filters.push((r) => (r[c] ?? null) === v);
          return api;
        },
        not(c: string, o: string, v: any) {
          if (o === "is") filters.push((r) => (r[c] ?? null) !== v);
          else if (o === "in") {
            const list = String(v)
              .replace(/^\(|\)$/g, "")
              .split(",");
            filters.push((r) => !list.includes(String(r[c])));
          } else if (o === "eq") filters.push((r) => r[c] !== v);
          return api;
        },
        in(c: string, vs: any[]) {
          filters.push((r) => vs.includes(r[c]));
          return api;
        },
        like(c: string, v: any) {
          const re = likeRe(v);
          filters.push((r) => re.test(String(r[c] ?? "")));
          return api;
        },
        ilike(c: string, v: any) {
          const re = likeRe(v, "i");
          filters.push((r) => re.test(String(r[c] ?? "")));
          return api;
        },
        gt(c: string, v: any) {
          filters.push((r) => r[c] != null && r[c] > v);
          return api;
        },
        gte(c: string, v: any) {
          filters.push((r) => r[c] != null && r[c] >= v);
          return api;
        },
        lt(c: string, v: any) {
          filters.push((r) => r[c] != null && r[c] < v);
          return api;
        },
        lte(c: string, v: any) {
          filters.push((r) => r[c] != null && r[c] <= v);
          return api;
        },
        match(o: Row) {
          for (const [c, v] of Object.entries(o)) filters.push((r) => r[c] === v);
          return api;
        },
        or(expr: string) {
          const parts = String(expr)
            .split(/,(?![^(]*\))/)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p) => {
              const [c, o, ...rest] = p.split(".");
              return cond(c, o, rest.join("."));
            });
          if (parts.length) filters.push((r) => parts.some((f) => f(r)));
          return api;
        },
        order(col: string, o?: { ascending?: boolean }) {
          orderBy.push({ col, asc: o?.ascending !== false });
          return api;
        },
        limit(n: number) {
          lim = n;
          return api;
        },
        range(from: number, to: number) {
          offset = from;
          lim = to - from + 1;
          return api;
        },
        async maybeSingle() {
          if (error) return { data: null, error };
          const d = run();
          return { data: d[0] ? structuredClone(d[0]) : null, error: null };
        },
        async single() {
          if (error) return { data: null, error };
          const d = run();
          return d[0]
            ? { data: structuredClone(d[0]), error: null }
            : { data: null, error: { code: "PGRST116", message: "no rows" } };
        },
        then(resolve: any, reject: any) {
          try {
            if (error)
              return Promise.resolve({ data: null, error, count: null }).then(resolve, reject);
            const d = run();
            const out = head
              ? { data: null, count: d.length, error: null }
              : { data: structuredClone(d), count: count ? d.length : null, error: null };
            return Promise.resolve(out).then(resolve, reject);
          } catch (e) {
            return Promise.reject(e).then(resolve, reject);
          }
        },
      },
      {
        get(target: any, prop: string | symbol) {
          if (prop in target) return target[prop];
          if (typeof prop === "symbol") return undefined;
          // Unknown modifiers (returns, abortSignal, csv...) pass through.
          return () => api;
        },
      },
    );
    return api;
  }

  const admin = {
    from: (t: string) => builder(t),
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "rpc not in Test Lab" } }),
    auth: {
      admin: {
        listUsers: async () => ({ data: { users: structuredClone(users) }, error: null }),
        getUserById: async (id: string) => ({
          data: { user: users.find((u) => u.id === id) ?? null },
          error: null,
        }),
        deleteUser: async (id: string) => {
          const i = users.findIndex((u) => u.id === id);
          if (i >= 0) users.splice(i, 1);
          return { data: null, error: null };
        },
      },
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: { message: "storage not in Test Lab" } }),
        createSignedUrl: async () => ({
          data: null,
          error: { message: "storage not in Test Lab" },
        }),
      }),
    },
  };

  return { tables, users, admin };
}
