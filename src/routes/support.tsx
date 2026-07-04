import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { log } from "@/lib/log";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Support — Buddy Symptom Tracker" },
      {
        name: "description",
        content:
          "Get help with Buddy Symptom Tracker. Submit bug reports, feature requests, technical issues, or general inquiries.",
      },
      { property: "og:title", content: "Support — Buddy Symptom Tracker" },
      { property: "og:description", content: "Submit a support request to the Buddy team." },
      { property: "og:url", content: "https://buddytracker.netlify.app/support" },
    ],
    links: [{ rel: "canonical", href: "https://buddytracker.netlify.app/support" }],
  }),
  component: SupportPage,
});

// Webhook endpoint — replace this URL when configured.
const SUPPORT_WEBHOOK_URL = (import.meta.env.VITE_SUPPORT_WEBHOOK_URL as string | undefined) ?? "";

const SubjectEnum = z.enum(["Bug Report", "Feature Request", "Technical Issue", "General Inquiry"]);
const PriorityEnum = z.enum(["Low", "Medium", "High"]);
const DeviceEnum = z.enum(["iOS", "Android", "Web"]);

const supportSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().email("Please enter a valid email").max(255),
  subject: SubjectEnum,
  message: z.string().trim().min(10, "Message must be at least 10 characters").max(2000),
  priority: PriorityEnum.optional(),
  device: DeviceEnum.optional(),
});

type FormState = z.infer<typeof supportSchema>;

const inputCls =
  "w-full rounded-lg border bg-[var(--navy-card)] px-4 py-3 text-[var(--white)] placeholder:text-[var(--white-muted)] outline-none transition focus:border-[var(--blue-accent)]";

function SupportPage() {
  const [form, setForm] = useState<Partial<FormState>>({
    name: "",
    email: "",
    subject: "General Inquiry",
    message: "",
    priority: undefined,
    device: undefined,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [serverMsg, setServerMsg] = useState<string>("");

  const set = <K extends keyof FormState>(k: K, v: FormState[K] | undefined) => {
    setForm((prev) => ({ ...prev, [k]: v }));
    setErrors((prev) => {
      const { [k as string]: _omit, ...rest } = prev;
      return rest;
    });
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerMsg("");
    const parsed = supportSchema.safeParse(form);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        errs[issue.path.join(".")] = issue.message;
      }
      setErrors(errs);
      return;
    }

    const payload = {
      ...parsed.data,
      source: "buddy-web-support",
      submittedAt: new Date().toISOString(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    };

    setStatus("submitting");
    try {
      if (SUPPORT_WEBHOOK_URL) {
        const res = await fetch(SUPPORT_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
      } else {
        // No webhook configured yet — log the JSON payload for now.
        log.info("[buddy-support] payload (no webhook configured):", payload);
      }
      setStatus("success");
      setForm({
        name: "",
        email: "",
        subject: "General Inquiry",
        message: "",
        priority: undefined,
        device: undefined,
      });
    } catch (err) {
      setStatus("error");
      setServerMsg(err instanceof Error ? err.message : "Failed to submit");
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--navy)", color: "var(--white)" }}>
      <header className="border-b" style={{ borderColor: "var(--navy-border)" }}>
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link
            to="/"
            className="text-lg font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-hero)" }}
          >
            Buddy
          </Link>
          <span
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{ background: "var(--navy-card)", color: "var(--white-muted)" }}
          >
            Support
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1
          className="text-4xl font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-hero)" }}
        >
          How can we help?
        </h1>
        <p className="mt-3 text-sm" style={{ color: "var(--white-muted)" }}>
          Submit a request and the Buddy team will respond shortly. For urgent clinical issues,
          contact your practitioner directly.
        </p>

        {status === "success" ? (
          <div
            className="mt-8 rounded-xl border p-6"
            style={{ background: "var(--navy-card)", borderColor: "var(--blue-accent)" }}
            role="status"
          >
            <h2 className="text-lg font-medium" style={{ color: "var(--blue-accent)" }}>
              Thank you!
            </h2>
            <p className="mt-2 text-sm" style={{ color: "var(--white-muted)" }}>
              We've received your support request and will respond shortly.
            </p>
            <button
              type="button"
              onClick={() => setStatus("idle")}
              className="mt-4 text-sm underline"
              style={{ color: "var(--blue-cold)" }}
            >
              Submit another request
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
            <Field label="Name" error={errors.name}>
              <input
                type="text"
                value={form.name ?? ""}
                onChange={(e) => set("name", e.target.value)}
                className={inputCls}
                style={{ borderColor: "var(--navy-border)" }}
                maxLength={100}
                required
              />
            </Field>

            <Field label="Email" error={errors.email}>
              <input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => set("email", e.target.value)}
                className={inputCls}
                style={{ borderColor: "var(--navy-border)" }}
                maxLength={255}
                required
              />
            </Field>

            <Field label="Subject" error={errors.subject}>
              <select
                value={form.subject ?? "General Inquiry"}
                onChange={(e) => set("subject", e.target.value as FormState["subject"])}
                className={inputCls}
                style={{ borderColor: "var(--navy-border)" }}
              >
                {SubjectEnum.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Priority (optional)">
                <select
                  value={form.priority ?? ""}
                  onChange={(e) =>
                    set("priority", (e.target.value || undefined) as FormState["priority"])
                  }
                  className={inputCls}
                  style={{ borderColor: "var(--navy-border)" }}
                >
                  <option value="">— Select —</option>
                  {PriorityEnum.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Device / OS (optional)">
                <select
                  value={form.device ?? ""}
                  onChange={(e) =>
                    set("device", (e.target.value || undefined) as FormState["device"])
                  }
                  className={inputCls}
                  style={{ borderColor: "var(--navy-border)" }}
                >
                  <option value="">— Select —</option>
                  {DeviceEnum.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Message" error={errors.message}>
              <textarea
                value={form.message ?? ""}
                onChange={(e) => set("message", e.target.value)}
                rows={6}
                className={inputCls}
                style={{ borderColor: "var(--navy-border)", resize: "vertical" }}
                maxLength={2000}
                required
              />
            </Field>

            {status === "error" && (
              <p className="text-sm" style={{ color: "var(--red)" }}>
                Something went wrong{serverMsg ? `: ${serverMsg}` : ""}. Please try again or email{" "}
                <a href="mailto:hello@peakmovement.co.za" className="underline">
                  hello@peakmovement.co.za
                </a>
                .
              </p>
            )}

            <button
              type="submit"
              disabled={status === "submitting"}
              className="rounded-lg px-6 py-3 text-sm font-semibold transition disabled:opacity-60"
              style={{ background: "var(--blue-accent)", color: "var(--navy)" }}
            >
              {status === "submitting" ? "Submitting…" : "Submit request"}
            </button>
          </form>
        )}

        <p className="mt-10 text-xs" style={{ color: "var(--white-muted)" }}>
          Or email us directly at{" "}
          <a
            href="mailto:hello@peakmovement.co.za"
            className="underline"
            style={{ color: "var(--blue-cold)" }}
          >
            hello@peakmovement.co.za
          </a>
        </p>
      </main>
    </div>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium" style={{ color: "var(--white)" }}>
        {label}
      </span>
      {children}
      {error && (
        <span className="mt-1 block text-xs" style={{ color: "var(--red)" }}>
          {error}
        </span>
      )}
    </label>
  );
}
