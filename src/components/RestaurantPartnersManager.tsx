import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Pencil, Trash2, Utensils } from "lucide-react";
import {
  deleteRestaurantPartner,
  listRestaurantPartners,
  upsertRestaurantPartner,
  type RestaurantPartner,
} from "@/lib/restaurant-partners.functions";
import {
  deleteReward,
  listManageableRewards,
  upsertReward,
  type Reward,
} from "@/lib/rewards.functions";
import { RESTAURANT_REWARD_PARTNERS } from "@/lib/feature-flags";

type FormState = {
  id: string | null;
  name: string;
  description: string;
  city: string;
  address: string;
  maps_url: string;
  active: boolean;
  platformWide: boolean;
};

const EMPTY: FormState = {
  id: null,
  name: "",
  description: "",
  city: "",
  address: "",
  maps_url: "",
  active: true,
  platformWide: false,
};

type RewardForm = {
  partnerId: string;
  name: string;
  voucher_code: string;
  description: string;
  discount_percent: string;
  earn_on: "milestone" | "check_in_count" | "manual";
  min_streak: string;
  min_check_ins: string;
};

/**
 * Admin + practitioner restaurant-partner manager.
 * Super-admin can add platform-wide partners (Justin's list). Practitioners
 * add practice-scoped partners. Discount vouchers reuse `rewards`.
 * Never send patient PII to these venues — vouchers stay inside Buddy.
 */
export function RestaurantPartnersManager({ scope }: { scope: "admin" | "practice" }) {
  const [partners, setPartners] = useState<RestaurantPartner[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rewardForm, setRewardForm] = useState<RewardForm | null>(null);

  const load = async () => {
    try {
      const [plist, rlist] = await Promise.all([
        listRestaurantPartners(),
        listManageableRewards().catch(() => [] as Reward[]),
      ]);
      setPartners(plist);
      setRewards(rlist);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load restaurant partners");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!RESTAURANT_REWARD_PARTNERS) {
      setLoading(false);
      return;
    }
    void load();
  }, []);

  if (!RESTAURANT_REWARD_PARTNERS) return null;

  const reset = () => {
    setForm({ ...EMPTY, platformWide: scope === "admin" });
    setEditing(false);
  };

  const save = async () => {
    if (!form.name.trim()) {
      setErr("Restaurant name is required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await upsertRestaurantPartner({
        data: {
          id: form.id,
          name: form.name.trim(),
          description: form.description.trim(),
          city: form.city.trim(),
          address: form.address.trim(),
          maps_url: form.maps_url.trim() || null,
          active: form.active,
          platformWide: scope === "admin" ? form.platformWide : false,
        },
      });
      reset();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save partner");
    } finally {
      setSaving(false);
    }
  };

  const edit = (p: RestaurantPartner) => {
    setForm({
      id: p.id,
      name: p.name,
      description: p.description,
      city: p.city,
      address: p.address,
      maps_url: p.maps_url ?? "",
      active: p.active,
      platformWide: p.practice_id == null,
    });
    setEditing(true);
    setErr(null);
  };

  const remove = async (id: string) => {
    setErr(null);
    try {
      await deleteRestaurantPartner({ data: { id } });
      await load();
    } catch {
      setErr(
        "Could not delete. Linked discounts stay in the catalog (partner is cleared). Turn it Off instead.",
      );
    }
  };

  const saveDiscount = async () => {
    if (!rewardForm) return;
    if (!rewardForm.name.trim() || !rewardForm.voucher_code.trim()) {
      setErr("Discount name and voucher code are required.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await upsertReward({
        data: {
          name: rewardForm.name.trim(),
          voucher_code: rewardForm.voucher_code.trim(),
          description: rewardForm.description.trim(),
          maps_url: null,
          active: true,
          partner_id: rewardForm.partnerId,
          discount_percent: rewardForm.discount_percent
            ? Number(rewardForm.discount_percent)
            : null,
          earn_on: rewardForm.earn_on,
          min_streak: rewardForm.min_streak ? Number(rewardForm.min_streak) : null,
          min_check_ins: rewardForm.min_check_ins ? Number(rewardForm.min_check_ins) : null,
        },
      });
      setRewardForm(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save discount");
    } finally {
      setSaving(false);
    }
  };

  const canEdit = (p: RestaurantPartner) =>
    scope === "admin" || (p.practice_id != null && !p.is_placeholder);

  return (
    <section style={{ marginTop: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Utensils size={16} color="var(--blue-accent)" aria-hidden />
        <div style={titleStyle}>Restaurant partners</div>
      </div>
      <p style={{ color: "var(--white-muted)", fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
        Discounts clients earn by completing check-ins. Justin&apos;s venue list is not in the app
        yet — add partners here (or run the example SQL in{" "}
        <code style={{ fontFamily: "var(--font-data)" }}>
          docs/examples/restaurant-partners.example.sql
        </code>
        ). Patient details are never sent to restaurants.
      </p>

      <div style={cardStyle}>
        <input
          style={inp}
          placeholder="Restaurant name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          style={inp}
          placeholder="City"
          value={form.city}
          onChange={(e) => setForm({ ...form, city: e.target.value })}
        />
        <input
          style={inp}
          placeholder="Address (optional)"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
        />
        <input
          style={inp}
          placeholder="Google Maps or website URL (https://…) — optional"
          value={form.maps_url}
          onChange={(e) => setForm({ ...form, maps_url: e.target.value })}
          inputMode="url"
        />
        <textarea
          style={{ ...inp, minHeight: 56, resize: "vertical" }}
          placeholder="Short description for the client voucher"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        {scope === "admin" && (
          <label style={toggleRow}>
            <span style={{ color: "var(--white)", fontFamily: "var(--font-ui)", fontSize: 14 }}>
              Platform-wide (all practices)
            </span>
            <input
              type="checkbox"
              checked={form.platformWide}
              onChange={(e) => setForm({ ...form, platformWide: e.target.checked })}
              style={{ width: 22, height: 22, accentColor: "var(--blue-accent)" }}
            />
          </label>
        )}
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
            {saving ? "Saving…" : editing ? "Update partner" : "Add partner"}
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
      ) : partners.length === 0 ? (
        <div style={muted}>
          No restaurant partners yet. Add Justin&apos;s list above — tables are empty on purpose.
        </div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {partners.map((p) => {
            const linked = rewards.filter((r) => r.partner_id === p.id);
            return (
              <div key={p.id} style={listItem}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      color: "var(--white)",
                      fontFamily: "var(--font-ui)",
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    {p.name}
                    {p.is_placeholder && (
                      <span style={{ color: "var(--amber)", fontWeight: 400 }}> · EXAMPLE</span>
                    )}
                    {!p.active && (
                      <span style={{ color: "var(--white-muted)", fontWeight: 400 }}> · off</span>
                    )}
                    {p.practice_id == null && (
                      <span style={{ color: "var(--white-muted)", fontWeight: 400 }}>
                        {" "}
                        · platform
                      </span>
                    )}
                  </div>
                  <div style={{ color: "var(--white-muted)", fontSize: 12 }}>
                    {[p.city, p.address].filter(Boolean).join(" · ") || "No address yet"}
                  </div>
                  {linked.length > 0 && (
                    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                      {linked.map((r) => (
                        <div
                          key={r.id}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 8,
                            fontSize: 12,
                            color: "var(--white-muted)",
                          }}
                        >
                          <span>
                            {r.discount_percent ? `${r.discount_percent}% · ` : ""}
                            {r.name} ({r.voucher_code}) · {r.earn_on}
                            {r.min_streak ? ` @ ${r.min_streak}-day streak` : ""}
                            {r.min_check_ins ? ` @ ${r.min_check_ins} check-ins` : ""}
                          </span>
                          {canEdit(p) && (
                            <button
                              type="button"
                              onClick={() => void deleteReward({ data: { id: r.id } }).then(load)}
                              style={{ ...iconBtn, width: 28, height: 28 }}
                              aria-label="Remove discount"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {rewardForm?.partnerId === p.id ? (
                    <div
                      style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}
                    >
                      <input
                        style={inp}
                        placeholder="Discount name (e.g. 15% off lunch)"
                        value={rewardForm.name}
                        onChange={(e) => setRewardForm({ ...rewardForm, name: e.target.value })}
                      />
                      <input
                        style={inp}
                        placeholder="Voucher code"
                        value={rewardForm.voucher_code}
                        onChange={(e) =>
                          setRewardForm({ ...rewardForm, voucher_code: e.target.value })
                        }
                      />
                      <input
                        style={inp}
                        inputMode="numeric"
                        placeholder="Discount % (optional)"
                        value={rewardForm.discount_percent}
                        onChange={(e) =>
                          setRewardForm({
                            ...rewardForm,
                            discount_percent: e.target.value.replace(/[^\d]/g, ""),
                          })
                        }
                      />
                      <select
                        style={inp}
                        value={rewardForm.earn_on}
                        onChange={(e) =>
                          setRewardForm({
                            ...rewardForm,
                            earn_on: e.target.value as RewardForm["earn_on"],
                          })
                        }
                      >
                        <option value="milestone">
                          Earn on streak milestone (3 / 7 / 14 / 30)
                        </option>
                        <option value="check_in_count">Earn after N check-ins</option>
                        <option value="manual">Practitioner approve only</option>
                      </select>
                      {rewardForm.earn_on === "milestone" && (
                        <input
                          style={inp}
                          inputMode="numeric"
                          placeholder="Required streak (blank = any milestone)"
                          value={rewardForm.min_streak}
                          onChange={(e) =>
                            setRewardForm({
                              ...rewardForm,
                              min_streak: e.target.value.replace(/[^\d]/g, ""),
                            })
                          }
                        />
                      )}
                      {rewardForm.earn_on === "check_in_count" && (
                        <input
                          style={inp}
                          inputMode="numeric"
                          placeholder="Required check-in count"
                          value={rewardForm.min_check_ins}
                          onChange={(e) =>
                            setRewardForm({
                              ...rewardForm,
                              min_check_ins: e.target.value.replace(/[^\d]/g, ""),
                            })
                          }
                        />
                      )}
                      <textarea
                        style={{ ...inp, minHeight: 48, resize: "vertical" }}
                        placeholder="Terms shown on the client voucher"
                        value={rewardForm.description}
                        onChange={(e) =>
                          setRewardForm({ ...rewardForm, description: e.target.value })
                        }
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          onClick={saveDiscount}
                          disabled={saving}
                          style={primaryBtn}
                        >
                          Save discount
                        </button>
                        <button type="button" onClick={() => setRewardForm(null)} style={ghostBtn}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    canEdit(p) && (
                      <button
                        type="button"
                        onClick={() =>
                          setRewardForm({
                            partnerId: p.id,
                            name: "",
                            voucher_code: "",
                            description: "",
                            discount_percent: "",
                            earn_on: "milestone",
                            min_streak: "",
                            min_check_ins: "",
                          })
                        }
                        style={{ ...ghostBtn, marginTop: 8, width: "100%" }}
                      >
                        Add discount for this restaurant
                      </button>
                    )
                  )}
                </div>
                {canEdit(p) && (
                  <div style={{ display: "flex", gap: 6, alignSelf: "flex-start" }}>
                    <button
                      type="button"
                      onClick={() => edit(p)}
                      style={iconBtn}
                      aria-label="Edit partner"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(p.id)}
                      style={iconBtn}
                      aria-label="Delete partner"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
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
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 10,
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 10,
  padding: "12px 14px",
};
const muted: CSSProperties = { color: "var(--white-muted)", fontSize: 13, marginTop: 12 };
