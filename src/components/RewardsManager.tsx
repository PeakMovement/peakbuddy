import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
  listAllRewards,
  upsertReward,
  deleteReward,
  getRewardsSchedule,
  updateRewardsSchedule,
  type Reward,
} from "@/lib/rewards.functions";

type FormState = {
  id: string | null;
  name: string;
  voucher_code: string;
  description: string;
  maps_url: string;
  active: boolean;
};

const EMPTY: FormState = {
  id: null,
  name: "",
  voucher_code: "",
  description: "",
  maps_url: "",
  active: true,
};

/**
 * Super-admin rewards pool manager. Lives in admin Settings for now.
 * Clients earn a random active reward when a practitioner approves (Stage 2).
 */
export function RewardsManager() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [schedEnabled, setSchedEnabled] = useState(true);
  const [schedDays, setSchedDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [schedSaving, setSchedSaving] = useState(false);
  const [schedMsg, setSchedMsg] = useState<string | null>(null);

  const load = async () => {
    try {
      const [list, sched] = await Promise.all([listAllRewards(), getRewardsSchedule()]);
      setRewards(list);
      setSchedEnabled(sched.enabled);
      setSchedDays(sched.allowedDays);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load rewards");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleDay = (d: number) => {
    setSchedDays((cur) =>
      cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort(),
    );
  };

  const saveSchedule = async () => {
    setSchedSaving(true);
    setSchedMsg(null);
    try {
      const next = await updateRewardsSchedule({
        data: { enabled: schedEnabled, allowedDays: schedDays },
      });
      setSchedEnabled(next.enabled);
      setSchedDays(next.allowedDays);
      setSchedMsg("Saved.");
    } catch (e) {
      setSchedMsg(e instanceof Error ? e.message : "Could not save schedule");
    } finally {
      setSchedSaving(false);
    }
  };


  const reset = () => {
    setForm({ ...EMPTY });
    setEditing(false);
  };

  const save = async () => {
    if (!form.name.trim() || !form.voucher_code.trim()) {
      setErr("Discount name and voucher code are required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await upsertReward({
        data: {
          id: form.id,
          name: form.name.trim(),
          voucher_code: form.voucher_code.trim(),
          description: form.description.trim(),
          maps_url: form.maps_url.trim() || null,
          active: form.active,
        },
      });
      reset();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save reward");
    } finally {
      setSaving(false);
    }
  };

  const edit = (r: Reward) => {
    setForm({
      id: r.id,
      name: r.name,
      voucher_code: r.voucher_code,
      description: r.description,
      maps_url: r.maps_url ?? "",
      active: r.active,
    });
    setEditing(true);
    setErr(null);
  };

  const remove = async (id: string) => {
    setErr(null);
    try {
      await deleteReward({ data: { id } });
      await load();
    } catch {
      setErr("Could not delete (it may already be issued). Turn it Off instead.");
    }
  };

  return (
    <section style={{ marginTop: 32 }}>
      <div style={titleStyle}>Rewards</div>
      <p style={{ color: "var(--white-muted)", fontSize: 12, marginTop: 4 }}>
        Discount vouchers clients can earn. When a practitioner approves a reward, a random active
        reward is given.
      </p>

      <div style={{ ...cardStyle, marginTop: 12 }}>
        <div style={{ color: "var(--white)", fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 600 }}>
          Reward availability
        </div>
        <label style={toggleRow}>
          <span style={{ color: "var(--white)", fontFamily: "var(--font-ui)", fontSize: 14 }}>
            Rewards enabled
          </span>
          <input
            type="checkbox"
            checked={schedEnabled}
            onChange={(e) => setSchedEnabled(e.target.checked)}
            style={{ width: 22, height: 22, accentColor: "var(--blue-accent)" }}
          />
        </label>
        <div style={{ color: "var(--white-muted)", fontSize: 12 }}>
          Days practitioners can approve rewards (UTC):
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, idx) => {
            const on = schedDays.includes(idx);
            return (
              <button
                key={idx}
                type="button"
                onClick={() => toggleDay(idx)}
                style={{
                  minWidth: 56,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--navy-border)",
                  background: on ? "var(--blue-accent)" : "var(--navy)",
                  color: "var(--white)",
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {schedMsg && (
          <div style={{ color: "var(--white-muted)", fontSize: 12 }}>{schedMsg}</div>
        )}
        <button type="button" onClick={saveSchedule} disabled={schedSaving} style={primaryBtn}>
          {schedSaving ? "Saving…" : "Save availability"}
        </button>
      </div>


      <div style={cardStyle}>
        <input
          style={inp}
          placeholder="Discount name (e.g. 20% off at FitFuel)"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          style={inp}
          placeholder="Voucher code (e.g. BUDDY20)"
          value={form.voucher_code}
          onChange={(e) => setForm({ ...form, voucher_code: e.target.value })}
        />
        <textarea
          style={{ ...inp, minHeight: 64, resize: "vertical" }}
          placeholder="Short description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <input
          style={inp}
          placeholder="Google Maps link (https://maps.app.goo.gl/…)"
          value={form.maps_url}
          onChange={(e) => setForm({ ...form, maps_url: e.target.value })}
          inputMode="url"
        />
        <label style={toggleRow}>
          <span style={{ color: "var(--white)", fontFamily: "var(--font-ui)", fontSize: 14 }}>
            Active
          </span>
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => setForm({ ...form, active: e.target.checked })}
            style={{ width: 22, height: 22, accentColor: "var(--blue-accent)" }}
          />
        </label>
        {err && <div style={{ color: "var(--red)", fontSize: 13 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={save} disabled={saving} style={primaryBtn}>
            {saving ? "Saving…" : editing ? "Update reward" : "Add reward"}
          </button>
          {editing && (
            <button type="button" onClick={reset} style={ghostBtn}>
              Cancel
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={muted}>Loading…</div>
      ) : rewards.length === 0 ? (
        <div style={muted}>No rewards yet. Add your first above.</div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {rewards.map((r) => (
            <div key={r.id} style={listItem}>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    color: "var(--white)",
                    fontFamily: "var(--font-ui)",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {r.name}
                  {!r.active && (
                    <span style={{ color: "var(--white-muted)", fontWeight: 400 }}> · off</span>
                  )}
                </div>
                <div
                  style={{ color: "var(--white-muted)", fontFamily: "var(--font-data)", fontSize: 12 }}
                >
                  {r.voucher_code}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" onClick={() => edit(r)} style={iconBtn} aria-label="Edit reward">
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  style={iconBtn}
                  aria-label="Delete reward"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const titleStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 700,
  color: "var(--white)",
  fontSize: 14,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};
const cardStyle: CSSProperties = {
  marginTop: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 10,
  padding: 14,
};
const inp: CSSProperties = {
  width: "100%",
  background: "var(--navy)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  padding: "12px 14px",
  color: "var(--white)",
  fontFamily: "var(--font-ui)",
  fontSize: 16,
};
const toggleRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: "var(--navy)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  padding: "12px 14px",
  minHeight: 48,
  cursor: "pointer",
};
const primaryBtn: CSSProperties = {
  flex: 1,
  minHeight: 46,
  background: "var(--blue-accent)",
  color: "var(--white)",
  border: "none",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 15,
  cursor: "pointer",
};
const ghostBtn: CSSProperties = {
  minHeight: 46,
  padding: "0 16px",
  background: "transparent",
  color: "var(--white-muted)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};
const iconBtn: CSSProperties = {
  width: 38,
  height: 38,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  color: "var(--white-muted)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  cursor: "pointer",
};
const listItem: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 10,
  padding: "12px 14px",
};
const muted: CSSProperties = { color: "var(--white-muted)", fontSize: 13, marginTop: 12 };
