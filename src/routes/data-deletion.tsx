import { createFileRoute, Link } from "@tanstack/react-router";
import { publicSiteOrigin } from "@/lib/app-url";
import { CLINICAL_RECORD_RETENTION } from "@/lib/consent/wording";

/**
 * How to delete your data, as instructions rather than as rights.
 *
 * Meta requires a data deletion instructions URL before an app goes Live, and
 * a reviewer wants a page that says what to press, not a privacy policy that
 * says a right exists. POPIA wants the same thing for a different reason:
 * withdrawing consent has to be as easy as giving it, and a right nobody can
 * find is not easy.
 *
 * The honest part of this page is the retention paragraph. We cannot delete a
 * clinical record on request because the HPCSA requires it to be kept, and
 * saying so plainly is better than a reviewer or a patient discovering it
 * after they asked.
 */

const LAST_UPDATED = "10 October 2026";

export const Route = createFileRoute("/data-deletion")({
  head: () => {
    const site = publicSiteOrigin();
    return {
      meta: [
        { title: "Delete your data — Buddy Symptom Tracker" },
        {
          name: "description",
          content:
            "How to delete your Buddy account and your personal information, stop WhatsApp check-ins, or ask Peak Movement for a copy of what we hold.",
        },
        { property: "og:url", content: `${site}/data-deletion` },
        { property: "og:type", content: "article" },
      ],
      links: [{ rel: "canonical", href: `${site}/data-deletion` }],
    };
  },
  component: DataDeletionPage,
});

const STEPS: Array<{ title: string; body: string[] }> = [
  {
    title: "Delete your account in the app",
    body: [
      "Open Buddy, go to your Profile, and choose Delete my account. You will be asked to confirm. This removes your Buddy account, your sign-in, your check-in history and anything you connected, such as a wearable.",
      "This happens immediately and cannot be undone.",
    ],
  },
  {
    title: "Stop WhatsApp check-ins",
    body: [
      "Reply STOP to any Buddy WhatsApp message. The check-ins end immediately and permanently.",
      `${CLINICAL_RECORD_RETENTION} They are not deleted on a 90 day timer. Deleting your Buddy account removes the WhatsApp messages tied to that account.`,
    ],
  },
  {
    title: "Ask us to do it for you",
    body: [
      "Email hello@peakmovement.co.za from the address on your account, or phone the practice on 067 369 0593, and ask us to delete your data. You do not have to give a reason.",
      "We will confirm once it is done. If anything has to be kept, we will tell you exactly what and why.",
    ],
  },
];

function DataDeletionPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--navy)" }}>
      <header className="border-b" style={{ borderColor: "var(--navy-border)" }}>
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
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
            Delete your data
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1
          className="text-3xl font-semibold tracking-tight sm:text-4xl"
          style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
        >
          Deleting your data
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--white-muted)" }}>
          Last updated: {LAST_UPDATED}
        </p>

        <p className="mt-6 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
          You can delete your Buddy data at any time, in three ways. None of them affect your
          treatment at Peak Movement, and you never have to explain why.
        </p>

        {STEPS.map((step, i) => (
          <section className="mt-8" key={step.title}>
            <h2
              className="text-xl font-semibold"
              style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
            >
              {i + 1}. {step.title}
            </h2>
            {step.body.map((p, j) => (
              <p
                key={j}
                className="mt-3 text-sm leading-relaxed"
                style={{ color: "var(--white-muted)" }}
              >
                {p}
              </p>
            ))}
          </section>
        ))}

        <section className="mt-10">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            What we cannot delete, and why
          </h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            Your clinical record is a separate thing from your Buddy account. As a registered
            healthcare practice we are required to keep clinical records for a minimum period set by
            South African law and the Health Professions Council of South Africa, and we cannot
            delete those on request even if you ask us to.
          </p>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            What this means in practice: deleting your Buddy account removes your access, your
            sign-in, and the app's own copy of your information. The clinical notes your
            physiotherapist made about your treatment stay in your patient file, as they would if
            you had never used Buddy at all.
          </p>
        </section>

        <section className="mt-10">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            Other things you can ask for
          </h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            Under the Protection of Personal Information Act you can also ask us for a copy of the
            personal information we hold about you, ask us to correct anything that is wrong, or
            object to how we are using it. Email hello@peakmovement.co.za and we will come back to
            you.
          </p>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            If you are not satisfied with how we have handled a request, you may complain to the
            Information Regulator of South Africa.
          </p>
        </section>

        <section className="mt-10">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            Contact
          </h2>
          <div className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            <p>
              <strong style={{ color: "var(--white)" }}>Peak Movement (Pty) Ltd</strong>
            </p>
            <p className="mt-1">94 Strand Street, Cape Town, 8001, South Africa</p>
            <p className="mt-1">
              <strong style={{ color: "var(--white)" }}>Email:</strong>{" "}
              <a
                href="mailto:hello@peakmovement.co.za"
                className="underline underline-offset-2"
                style={{ color: "var(--blue-accent)" }}
              >
                hello@peakmovement.co.za
              </a>
            </p>
            <p className="mt-1">
              <strong style={{ color: "var(--white)" }}>Phone:</strong> 067 369 0593
            </p>
            <p className="mt-3">
              See also our{" "}
              <Link
                to="/privacy-policy"
                className="underline underline-offset-2"
                style={{ color: "var(--blue-accent)" }}
              >
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link
                to="/terms"
                className="underline underline-offset-2"
                style={{ color: "var(--blue-accent)" }}
              >
                Terms of Service
              </Link>
              .
            </p>
          </div>
        </section>

        <div
          className="mt-12 border-t pt-6 text-center text-xs"
          style={{ borderColor: "var(--navy-border)", color: "var(--white-muted)" }}
        >
          &copy; {new Date().getFullYear()} Peak Movement. All rights reserved. Built with care in
          South Africa.
        </div>
      </main>
    </div>
  );
}
