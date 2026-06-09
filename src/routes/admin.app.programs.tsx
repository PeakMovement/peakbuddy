import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, ExternalLink } from "lucide-react";
import {
  listAllPrograms,
  upsertProgram,
  deleteProgram,
} from "@/lib/admin-programs.functions";
import { log } from "@/lib/log";

export const Route = createFileRoute("/admin/app/programs")({
  head: () => ({ meta: [{ title: "Programs — Buddy Admin" }] }),
  component: AdminPrograms,
});

type Program = {
  id: string;
  name: string;
  description: string;
  external_url: string;
  image_url: string | null;
  symptom_tags: string[];
  pain_min: number | null;
  pain_max: number | null;
  active: boolean;
  priority: number;
};

const emptyForm: Omit<Program, "id"> & { id: string | null } = {
  id: null,
  name: "",
  description: "",
  external_url: "",
  image_url: "",
  symptom_tags: [],
  pain_min: null,
  pain_max: null,
  active: true,
  priority: 0,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  background: "var(--navy)",
  border: "1px solid var(--navy-border)",
  color: "var(--white)",
  fontFamily: "var(--font-ui)",
  fontSize: 14,
  marginTop: 6,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginTop: 14,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "var(--white-muted)",
  fontFamily: "var(--font-data)",
};

function AdminPrograms() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await listAllPrograms();
      setPrograms((data as Program[]) ?? []);
    } catch (e) {
      log.error(e);
      setError("Failed to load programs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openNew = () => {
    setForm({ ...emptyForm, symptom_tags: [] });
    setTagInput("");
    setError(null);
  };

  const openEdit = (p: Program) => {
    setForm({
      id: p.id,
      name: p.name,
      description: p.description,
      external_url: p.external_url,
      image_url: p.image_url ?? "",
      symptom_tags: [...p.symptom_tags],
      pain_min: p.pain_min,
      pain_max: p.pain_max,
      active: p.active,
      priority: p.priority,
    });
    setTagInput("");
    setError(null);
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await upsertProgram({
        data: {
          id: form.id ?? undefined,
          name: form.name.trim(),
          description: form.description.trim(),
          external_url: form.external_url.trim(),
          image_url: form.image_url?.trim() || null,
          symptom_tags: form.symptom_tags,
          pain_min: form.pain_min,
          pain_max: form.pain_max,
          active: form.active,
          priority: form.priority,
        },
      });
      setForm(null);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this program?")) return;
    try {
      await deleteProgram({ data: { id } });
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Could not delete");
    }
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t || !form) return;
    if (form.symptom_tags.includes(t)) return;
    setForm({ ...form, symptom_tags: [...form.symptom_tags, t] });
    setTagInput("");
  };

  return (
    <div style={{ padding: "24px 20px 32px", color: "var(--white)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontFamily: "var(--font-hero)", fontSize: 24, fontWeight: 400 }}>Programs</h1>
        <button
          onClick={openNew}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "var(--blue-accent)",
            color: "var(--navy)",
            border: "none",
            borderRadius: 8,
            padding: "8px 14px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Plus size={16} /> New
        </button>
      </div>
      <p style={{ marginTop: 6, color: "var(--white-muted)", fontSize: 13 }}>
        Programs suggested to clients after a check-in based on tags and pain level.
      </p>

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            background: "rgba(220,80,80,0.1)",
            border: "1px solid var(--red, #c0392b)",
            borderRadius: 8,
            color: "var(--red, #e74c3c)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ marginTop: 20, color: "var(--white-muted)" }}>Loading…</p>
      ) : (
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          {programs.length === 0 && (
            <p style={{ color: "var(--white-muted)" }}>No programs yet. Click New to add one.</p>
          )}
          {programs.map((p) => (
            <div
              key={p.id}
              style={{
                background: "var(--navy-card)",
                border: "1px solid var(--navy-border)",
                borderRadius: 12,
                padding: 14,
                display: "flex",
                gap: 12,
              }}
            >
              {p.image_url ? (
                <img
                  src={p.image_url}
                  alt=""
                  style={{ width: 64, height: 64, borderRadius: 8, objectFit: "cover" }}
                />
              ) : (
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 8,
                    background: "var(--navy)",
                    border: "1px dashed var(--navy-border)",
                  }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 15 }}>{p.name}</strong>
                  {!p.active && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: "2px 6px",
                        background: "var(--navy)",
                        borderRadius: 4,
                        color: "var(--white-muted)",
                      }}
                    >
                      INACTIVE
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: "var(--white-muted)" }}>
                    priority {p.priority}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--white-muted)",
                    marginTop: 4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.description || "(no description)"}
                </p>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                  {p.symptom_tags.map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        background: "var(--navy)",
                        borderRadius: 999,
                        color: "var(--blue-accent)",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                  {(p.pain_min != null || p.pain_max != null) && (
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        background: "var(--navy)",
                        borderRadius: 999,
                        color: "var(--white-muted)",
                      }}
                    >
                      pain {p.pain_min ?? 0}–{p.pain_max ?? 10}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <a
                  href={p.external_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open link"
                  style={{ color: "var(--white-muted)" }}
                >
                  <ExternalLink size={16} />
                </a>
                <button
                  onClick={() => openEdit(p)}
                  style={{ background: "transparent", border: "none", color: "var(--white-muted)", cursor: "pointer" }}
                  title="Edit"
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={() => remove(p.id)}
                  style={{ background: "transparent", border: "none", color: "var(--red, #e74c3c)", cursor: "pointer" }}
                  title="Delete"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 100,
            padding: 0,
          }}
          onClick={() => !saving && setForm(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--navy-card)",
              borderTop: "1px solid var(--navy-border)",
              borderRadius: "16px 16px 0 0",
              padding: 20,
              width: "100%",
              maxWidth: 560,
              maxHeight: "90vh",
              overflowY: "auto",
              paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)",
            }}
          >
            <h2 style={{ fontFamily: "var(--font-hero)", fontWeight: 400, fontSize: 20 }}>
              {form.id ? "Edit program" : "New program"}
            </h2>

            <label style={labelStyle}>Name</label>
            <input
              style={inputStyle}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />

            <label style={labelStyle}>Description</label>
            <textarea
              style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />

            <label style={labelStyle}>Sign-up link (external URL)</label>
            <input
              style={inputStyle}
              placeholder="https://…"
              value={form.external_url}
              onChange={(e) => setForm({ ...form, external_url: e.target.value })}
            />

            <label style={labelStyle}>Image URL</label>
            <input
              style={inputStyle}
              placeholder="https://… (paste an image link)"
              value={form.image_url ?? ""}
              onChange={(e) => setForm({ ...form, image_url: e.target.value })}
            />
            {form.image_url ? (
              <img
                src={form.image_url}
                alt=""
                style={{ marginTop: 8, width: 120, height: 80, borderRadius: 8, objectFit: "cover" }}
              />
            ) : null}

            <label style={labelStyle}>Symptom tags</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                style={{ ...inputStyle, marginTop: 0 }}
                placeholder="e.g. lower-back, sleep, stress"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <button
                onClick={addTag}
                type="button"
                style={{
                  padding: "0 14px",
                  background: "var(--navy)",
                  border: "1px solid var(--navy-border)",
                  color: "var(--white)",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Add
              </button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {form.symptom_tags.map((t) => (
                <button
                  key={t}
                  onClick={() =>
                    setForm({ ...form, symptom_tags: form.symptom_tags.filter((x) => x !== t) })
                  }
                  style={{
                    fontSize: 12,
                    padding: "4px 10px",
                    background: "var(--navy)",
                    borderRadius: 999,
                    color: "var(--blue-accent)",
                    border: "1px solid var(--navy-border)",
                    cursor: "pointer",
                  }}
                  title="Remove"
                >
                  {t} ×
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Pain min (0–10)</label>
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  max={10}
                  value={form.pain_min ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      pain_min: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Pain max (0–10)</label>
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  max={10}
                  value={form.pain_max ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      pain_max: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Priority</label>
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  max={100}
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 0 })}
                />
              </div>
            </div>

            <label
              style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 14 }}
            >
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Active (visible to clients)
            </label>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button
                onClick={() => setForm(null)}
                disabled={saving}
                style={{
                  flex: 1,
                  padding: 12,
                  background: "transparent",
                  border: "1px solid var(--navy-border)",
                  color: "var(--white)",
                  borderRadius: 10,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !form.name.trim() || !form.external_url.trim()}
                style={{
                  flex: 2,
                  padding: 12,
                  background: "var(--blue-accent)",
                  color: "var(--navy)",
                  border: "none",
                  borderRadius: 10,
                  fontWeight: 600,
                  cursor: "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? "Saving…" : "Save program"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
