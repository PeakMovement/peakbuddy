import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getConsentLinkDetails, signConsentLink } from "@/lib/whatsapp/onboarding.functions";
import { publicSiteOrigin } from "@/lib/app-url";
import { currentConsent } from "@/lib/consent/wording";

// Always the current versions, the same ones the server records when signing.
const POPIA_CORE = currentConsent("popia_core");
const WHATSAPP_CHECKINS = currentConsent("whatsapp_checkins");

/**
 * The page a patient lands on from the WhatsApp invitation.
 *
 * It renders from src/lib/consent/wording.ts, the same source the in-app
 * consent gate uses, so a patient reading this and a patient tapping the gate
 * are agreeing to identical words. That is the whole reason the wording lives
 * in one module.
 *
 * Two modes:
 *  - /consent            read only, for anyone who wants to read the terms.
 *  - /consent?t=TOKEN    the personal link Buddy sends on WhatsApp. Shows who
 *    it is for and lets them sign: POPIA and WhatsApp check-ins required, AI
 *    optional. Signing records consent_records with the exact wording, then
 *    Buddy carries on in WhatsApp. The token is single use and expires.
 *
 * Built mobile first, because every single visitor arrives by tapping a link
 * inside WhatsApp on a phone.
 */

export const Route = createFileRoute("/consent")({
  head: () => {
    const site = publicSiteOrigin();
    return {
      meta: [
        { title: "What you are agreeing to — Buddy" },
        {
          name: "description",
          content:
            "What Peak Movement collects through Buddy, why, who else handles it, how long it is kept, and how to stop at any time.",
        },
        { property: "og:url", content: `${site}/consent` },
        { property: "og:type", content: "article" },
      ],
      links: [{ rel: "canonical", href: `${site}/consent` }],
    };
  },
  validateSearch: (search: Record<string, unknown>): { t?: string } =>
    typeof search.t === "string" && search.t.length >= 20 && search.t.length <= 100
      ? { t: search.t }
      : {},
  component: ConsentPage,
});

const BUDDY_CHAT = "https://wa.me/27675724314";

type LinkState =
  | { status: "loading" }
  | { status: "ready"; firstName: string; practiceName: string; aiConsent: boolean }
  | { status: "invalid" | "expired" | "used" | "error" }
  | { status: "signed"; firstName: string };

function SignPanel({ token }: { token: string }) {
  const load = useServerFn(getConsentLinkDetails);
  const sign = useServerFn(signConsentLink);
  const [state, setState] = useState<LinkState>({ status: "loading" });
  const [popia, setPopia] = useState(false);
  const [whatsapp, setWhatsapp] = useState(false);
  const [ai, setAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load({ data: { token } })
      .then((r) =>
        r.ok
          ? setState({
              status: "ready",
              firstName: r.firstName,
              practiceName: r.practiceName,
              aiConsent: r.aiConsent,
            })
          : setState({ status: r.reason }),
      )
      .catch(() => setState({ status: "error" }));
  }, [token, load]);

  const box = {
    background: "var(--navy-card)",
    borderColor: "var(--navy-border)",
  } as const;

  if (state.status === "loading") {
    return (
      <div
        className="mt-6 rounded-lg border p-4 text-sm"
        style={{ ...box, color: "var(--white-muted)" }}
      >
        Loading your consent form...
      </div>
    );
  }
  if (state.status === "signed") {
    return (
      <div className="mt-6 rounded-lg border p-5" style={box}>
        <h2
          className="text-lg font-semibold"
          style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
        >
          Thank you, {state.firstName}. You're all set.
        </h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
          Your consent is saved to your Buddy profile. Head back to WhatsApp, Buddy is ready for
          your first check-in.
        </p>
        <a
          href={BUDDY_CHAT}
          className="mt-4 inline-block rounded-lg px-4 py-2.5 text-sm font-semibold"
          style={{ background: "#25D366", color: "#0b1a12" }}
        >
          Back to WhatsApp
        </a>
      </div>
    );
  }
  if (state.status !== "ready") {
    const why =
      state.status === "used"
        ? "This link has already been used, so your consent is saved."
        : state.status === "expired"
          ? "This link has expired."
          : "This link isn't working.";
    return (
      <div
        className="mt-6 rounded-lg border p-4 text-sm leading-relaxed"
        style={{ ...box, color: "var(--white-muted)" }}
      >
        {why} Send Buddy a message on WhatsApp and it will send you a fresh link if one is needed.{" "}
        <a href={BUDDY_CHAT} className="underline" style={{ color: "var(--blue-accent)" }}>
          Open WhatsApp
        </a>
      </div>
    );
  }

  const canSign = popia && whatsapp && !busy;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await sign({
        data: {
          token,
          aiConsent: ai,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        },
      });
      if (r.ok) setState({ status: "signed", firstName: r.firstName });
      else if (r.reason === "used") setState({ status: "used" });
      else if (r.reason === "expired") setState({ status: "expired" });
      else setError("Something went wrong saving your consent. Please try again.");
    } catch {
      setError("Something went wrong saving your consent. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const tick = (checked: boolean, set: (v: boolean) => void, label: string, required: boolean) => (
    <label
      className="mt-3 flex cursor-pointer items-start gap-3 text-sm leading-relaxed"
      style={{ color: "var(--white)" }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => set(e.target.checked)}
        className="mt-1 h-5 w-5 shrink-0"
        style={{ accentColor: "var(--blue-accent)" }}
      />
      <span>
        {label}
        {!required && <span style={{ color: "var(--white-muted)" }}> (optional)</span>}
      </span>
    </label>
  );

  return (
    <div id="sign" className="mt-8 rounded-lg border p-5" style={box}>
      <h2
        className="text-lg font-semibold"
        style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
      >
        Sign your consent, {state.firstName}
      </h2>
      <p className="mt-1 text-sm" style={{ color: "var(--white-muted)" }}>
        For your Buddy profile with {state.practiceName}.
      </p>
      {tick(popia, setPopia, POPIA_CORE.affirmation, true)}
      {tick(whatsapp, setWhatsapp, WHATSAPP_CHECKINS.affirmation, true)}
      {!state.aiConsent &&
        tick(
          ai,
          setAi,
          "I allow Buddy's AI to read my messages and voice notes so it can understand my answers and summarise them for my practitioner.",
          false,
        )}
      {error && (
        <p className="mt-3 text-sm" style={{ color: "var(--red)" }}>
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={!canSign}
        onClick={submit}
        className="mt-5 w-full rounded-lg px-4 py-3 text-sm font-semibold"
        style={{
          background: canSign ? "var(--blue-accent)" : "var(--navy-border)",
          color: "var(--white)",
          opacity: canSign ? 1 : 0.7,
        }}
      >
        {busy ? "Saving..." : "Sign and continue"}
      </button>
      <p className="mt-3 text-xs" style={{ color: "var(--white-muted)" }}>
        You can withdraw at any time by replying STOP on WhatsApp. It won't affect your treatment.
        Version {POPIA_CORE.version}.
      </p>
    </div>
  );
}

function ConsentPage() {
  const { t } = Route.useSearch();
  return (
    <div className="min-h-screen" style={{ background: "var(--navy)" }}>
      <header className="border-b" style={{ borderColor: "var(--navy-border)" }}>
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <Link
            to="/"
            className="text-lg font-semibold tracking-tight"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            Buddy
          </Link>
          <span
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{ background: "var(--navy-card)", color: "var(--white-muted)" }}
          >
            Peak Movement
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-8">
        <h1
          className="text-2xl font-semibold tracking-tight sm:text-3xl"
          style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
        >
          What you are agreeing to
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--white-muted)" }}>
          Please read this before you start. It is short on purpose.
        </p>
        {t && (
          <a
            href="#sign"
            className="mt-3 inline-block text-sm underline underline-offset-2"
            style={{ color: "var(--blue-accent)" }}
          >
            Skip to signing
          </a>
        )}

        <div
          className="mt-5 rounded-lg border p-4 text-sm leading-relaxed"
          style={{
            background: "var(--navy-card)",
            borderColor: "var(--navy-border)",
            color: "var(--white-muted)",
          }}
        >
          <strong style={{ color: "var(--white)" }}>This is not an emergency service.</strong>{" "}
          Nobody watches these messages around the clock. If something is wrong and it cannot wait,
          phone an ambulance on <strong style={{ color: "var(--white)" }}>10177</strong>, or{" "}
          <strong style={{ color: "var(--white)" }}>112</strong> from any cellphone, or go to your
          nearest emergency unit. Please do not wait for a reply from us.
        </div>

        {POPIA_CORE.sections.map((section) => (
          <section className="mt-7" key={section.heading ?? section.body.slice(0, 20)}>
            {section.heading && (
              <h2
                className="text-base font-semibold"
                style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
              >
                {section.heading}
              </h2>
            )}
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
              {section.body}
            </p>
          </section>
        ))}

        <section className="mt-9">
          <h2
            className="text-base font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            {WHATSAPP_CHECKINS.heading}
          </h2>
          {WHATSAPP_CHECKINS.sections.map((s, i) => (
            <p
              key={i}
              className="mt-2 text-sm leading-relaxed"
              style={{ color: "var(--white-muted)" }}
            >
              {s.body}
            </p>
          ))}
        </section>

        {t ? (
          <SignPanel token={t} />
        ) : (
          <div
            className="mt-8 rounded-lg border p-4"
            style={{ background: "var(--navy-card)", borderColor: "var(--navy-border)" }}
          >
            <h2
              className="text-base font-semibold"
              style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
            >
              How to agree
            </h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
              Go back to WhatsApp and reply <strong style={{ color: "var(--white)" }}>YES</strong>{" "}
              to start. Reply <strong style={{ color: "var(--white)" }}>NO</strong> and we will not
              message you again.
            </p>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
              You can change your mind at any time by replying{" "}
              <strong style={{ color: "var(--white)" }}>STOP</strong>. It takes effect immediately
              and it will not affect your treatment in any way.
            </p>
            <p className="mt-3 text-xs" style={{ color: "var(--white-muted)" }}>
              Version {POPIA_CORE.version}
            </p>
          </div>
        )}

        <section className="mt-8">
          <h2
            className="text-base font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            Questions
          </h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            Ask your physiotherapist, email{" "}
            <a
              href="mailto:hello@peakmovement.co.za"
              className="underline underline-offset-2"
              style={{ color: "var(--blue-accent)" }}
            >
              hello@peakmovement.co.za
            </a>{" "}
            or phone the practice on 067 369 0593. See also our{" "}
            <Link
              to="/privacy-policy"
              className="underline underline-offset-2"
              style={{ color: "var(--blue-accent)" }}
            >
              Privacy Policy
            </Link>
            ,{" "}
            <Link
              to="/terms"
              className="underline underline-offset-2"
              style={{ color: "var(--blue-accent)" }}
            >
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link
              to="/data-deletion"
              className="underline underline-offset-2"
              style={{ color: "var(--blue-accent)" }}
            >
              how to delete your data
            </Link>
            .
          </p>
        </section>

        <div
          className="mt-10 border-t pt-5 text-center text-xs"
          style={{ borderColor: "var(--navy-border)", color: "var(--white-muted)" }}
        >
          &copy; {new Date().getFullYear()} Peak Movement. Built with care in South Africa.
        </div>
      </main>
    </div>
  );
}
