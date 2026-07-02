import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { sendTestPush, listPushUsers } from "@/lib/push.functions";

type TokenRow = { id: string; platform: string | null; last_seen: string | null };
type Result = {
  ok: boolean;
  target?: string;
  tokens?: TokenRow[];
  result?: {
    simulated: boolean;
    attempted: number;
    delivered: number;
    failures: { token_id: string; reason: string }[];
    response?: unknown;
  };
  reason?: string;
};

/** Super-admin test tool: send a push to any user id and see the raw outcome. */
export function PushTestPanel() {
  const [userId, setUserId] = useState("");
  const [title, setTitle] = useState("Buddy test notification");
  const [body, setBody] = useState("If you see this, push delivery is working ✅");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Result | null>(null);
  const [users, setUsers] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    listPushUsers()
      .then(setUsers)
      .catch(() => {});
  }, []);

  const fire = async (toSelf: boolean) => {
    setBusy(true);
    setOut(null);
    try {
      const data: { userId?: string; title: string; body: string } = { title, body };
      if (!toSelf && userId.trim()) data.userId = userId.trim();
      const r = (await sendTestPush({ data })) as Result;
      setOut(r);
    } catch (e) {
      setOut({ ok: false, reason: e instanceof Error ? e.message : "unknown" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={card}>
      <h2 style={h2}>Test push notification</h2>
      <p style={muted}>
        Sends through the OneSignal REST API using stored push_tokens. If
        OneSignal credentials aren't configured the call returns simulated=true.
      </p>

      <label style={label}>
        Recipient — choose a user, or leave blank to send to yourself
      </label>
      <select value={userId} onChange={(e) => setUserId(e.target.value)} style={input}>
        <option value="">— Send to myself —</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </select>

      <label style={label}>Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} />

      <label style={label}>Body</label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        style={{ ...input, height: "auto", padding: 10, resize: "vertical" }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" disabled={busy} onClick={() => fire(true)} style={btn}>
          <BellRing size={14} /> Send to me
        </button>
        <button
          type="button"
          disabled={busy || !userId.trim()}
          onClick={() => fire(false)}
          style={btn}
        >
          <BellRing size={14} /> Send to selected user
        </button>
      </div>

      {out && (
        <pre
          style={{
            marginTop: 12,
            background: "var(--navy)",
            color: "var(--white)",
            border: "1px solid var(--navy-border)",
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            overflow: "auto",
            maxHeight: 320,
          }}
        >
          {JSON.stringify(out, null, 2)}
        </pre>
      )}
    </section>
  );
}

const card: React.CSSProperties = {
  marginTop: 20,
  padding: 16,
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 12,
};
const h2: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-ui)",
  color: "var(--white)",
  fontSize: 16,
};
const muted: React.CSSProperties = {
  margin: "6px 0 14px",
  color: "var(--white-muted)",
  fontSize: 13,
};
const label: React.CSSProperties = {
  display: "block",
  marginTop: 10,
  marginBottom: 4,
  color: "var(--white-muted)",
  fontSize: 12,
  fontFamily: "var(--font-ui)",
  letterSpacing: "0.05em",
};
const input: React.CSSProperties = {
  width: "100%",
  height: 40,
  borderRadius: 8,
  background: "var(--navy)",
  border: "1px solid var(--navy-border)",
  color: "var(--white)",
  padding: "0 12px",
  fontFamily: "var(--font-ui)",
  fontSize: 14,
};
const btn: React.CSSProperties = {
  flex: 1,
  minHeight: 40,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  background: "var(--blue-accent)",
  color: "var(--white)",
  border: "none",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};
