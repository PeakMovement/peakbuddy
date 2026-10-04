import { createFileRoute, Link } from "@tanstack/react-router";
import { publicSiteOrigin } from "@/lib/app-url";
import { POPIA_CORE_V2, WHATSAPP_CHECKINS_V1 } from "@/lib/consent/wording";

/**
 * The page a patient lands on from the WhatsApp invitation.
 *
 * It renders from src/lib/consent/wording.ts, the same source the in-app
 * consent gate uses, so a patient reading this and a patient tapping the gate
 * are agreeing to identical words. That is the whole reason the wording lives
 * in one module.
 *
 * Deliberately READ ONLY for now. There is no agree button because there is
 * nothing honest to wire it to yet: a patient arriving from WhatsApp is not
 * logged in, and until the WhatsApp onboarding flow exists there is no token
 * identifying who they are, so an acceptance could not be recorded against
 * anyone. A button that looks like it records consent and does not would be
 * worse than no button. Agreement happens by replying YES on WhatsApp until
 * the tokenised flow lands, at which point the accept path drops in here.
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
  component: ConsentPage,
});

function ConsentPage() {
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

        {POPIA_CORE_V2.sections.map((section) => (
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
            {WHATSAPP_CHECKINS_V1.heading}
          </h2>
          {WHATSAPP_CHECKINS_V1.sections.map((s, i) => (
            <p
              key={i}
              className="mt-2 text-sm leading-relaxed"
              style={{ color: "var(--white-muted)" }}
            >
              {s.body}
            </p>
          ))}
        </section>

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
            Go back to WhatsApp and reply <strong style={{ color: "var(--white)" }}>YES</strong> to
            start. Reply <strong style={{ color: "var(--white)" }}>NO</strong> and we will not
            message you again.
          </p>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            You can change your mind at any time by replying{" "}
            <strong style={{ color: "var(--white)" }}>STOP</strong>. It takes effect immediately and
            it will not affect your treatment in any way.
          </p>
          <p className="mt-3 text-xs" style={{ color: "var(--white-muted)" }}>
            Version {POPIA_CORE_V2.version}
          </p>
        </div>

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
