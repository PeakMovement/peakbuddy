import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy-policy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Buddy Symptom Tracker" },
      {
        name: "description",
        content:
          "Buddy Symptom Tracker Privacy Policy. Learn how we collect, use, store, and protect your personal and health information in compliance with POPIA.",
      },
      { property: "og:title", content: "Privacy Policy — Buddy Symptom Tracker" },
      {
        property: "og:description",
        content:
          "How Buddy protects your personal and health information under South African privacy law.",
      },
      { property: "og:url", content: "https://peakbuddy.lovable.app/privacy-policy" },
      { property: "og:type", content: "article" },
    ],
    links: [{ rel: "canonical", href: "https://peakbuddy.lovable.app/privacy-policy" }],
  }),
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
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
            style={{
              background: "var(--navy-card)",
              color: "var(--white-muted)",
            }}
          >
            Privacy Policy
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1
          className="text-3xl font-semibold tracking-tight sm:text-4xl"
          style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
        >
          Privacy Policy
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--white-muted)" }}>
          Last updated: 1 June 2026
        </p>

        <div
          className="mt-4 rounded-lg border p-4 text-sm leading-relaxed"
          style={{
            background: "var(--navy-card)",
            borderColor: "var(--navy-border)",
            color: "var(--white-muted)",
          }}
        >
          We use a third-party AI provider (Anthropic) to power our Yves feature. We only send your
          information to it after you agree.
        </div>

        <section className="mt-8">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            1. Introduction
          </h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            Buddy Symptom Tracker (“Buddy”, “we”, “us”, or "our") is committed to protecting your
            personal information and your right to privacy. This Privacy Policy explains how we
            collect, use, disclose, and safeguard your information when you use our mobile
            application and web platform (collectively, the “Service”).
          </p>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            This policy is drafted in compliance with the Protection of Personal Information Act 4
            of 2013 (POPIA) of South Africa. If you have any questions or concerns about this policy
            or our practices regarding your personal information, please contact us at{" "}
            <a
              href="mailto:hello@peakmovement.co.za"
              className="underline underline-offset-2"
              style={{ color: "var(--blue-accent)" }}
            >
              hello@peakmovement.co.za
            </a>
            .
          </p>
        </section>

        <section className="mt-8">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            2. What Data We Collect
          </h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            We collect information that you provide directly to us, as well as data generated
            through your use of the Service. This includes:
          </p>
          <ul
            className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed"
            style={{ color: "var(--white-muted)" }}
          >
            <li>
              <strong style={{ color: "var(--white)" }}>Identity and contact data:</strong> Full
              name, email address, phone number, and profession (for practitioners).
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Health and symptom data:</strong> Daily
              check-in metrics including pain level, sleep quality, stress level, energy level, mood
              ratings, medication adherence, and free-text notes describing symptoms or concerns.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Clinical context:</strong> Primary
              complaint, health history notes, treatment frequency, and appointment dates shared by
              you or your practitioner.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Technical data:</strong> Device type,
              operating system, IP address, and app usage analytics (collected anonymously where
              possible).
            </li>
          </ul>
        </section>

        <section className="mt-8" id="ai">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            3. How We Use Your Data (including AI)
          </h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            We process your personal information for the following lawful purposes under POPIA:
          </p>
          <ul
            className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed"
            style={{ color: "var(--white-muted)" }}
          >
            <li>
              <strong style={{ color: "var(--white)" }}>Clinical care:</strong> To enable your
              registered healthcare practitioner to review your symptom trends, track your progress,
              and make informed clinical decisions.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>AI-assisted pattern detection:</strong> To
              identify trends, correlations, and potential red flags in your symptom data using
              automated analysis, which supports — but does not replace — clinical judgment.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Service improvement:</strong> To maintain,
              secure, and improve the functionality, performance, and reliability of the Service.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Legal compliance:</strong> To comply with
              applicable laws, regulations, and professional healthcare standards in South Africa.
            </li>
          </ul>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            Automated decision-making (including AI triage and urgency scoring) is used to flag
            potential concerns for your practitioner. A qualified human clinician always reviews
            flagged outcomes before any clinical action is taken.
          </p>
        </section>

        <section className="mt-8">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            4. Data Sharing and Disclosure
          </h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            We do not sell, rent, or trade your personal information. Your health data is shared
            only under the following limited circumstances:
          </p>
          <ul
            className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed"
            style={{ color: "var(--white-muted)" }}
          >
            <li>
              <strong style={{ color: "var(--white)" }}>With your practitioner:</strong> Symptom
              data, check-ins, and AI-generated insights are shared exclusively with the healthcare
              practitioner linked to your account, based on your explicit consent given at
              registration.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Service providers:</strong> We engage
              trusted third-party providers (e.g. cloud hosting, analytics) under strict
              data-processing agreements that comply with POPIA. These providers process data only
              on our instructions and do not use it for their own purposes.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Legal obligations:</strong> We may disclose
              information if required by law, court order, or to protect the vital interests of you
              or another person.
            </li>
          </ul>
        </section>

        <section className="mt-8">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            5. Data Security and Encryption
          </h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            Protecting your health information is our highest priority. We implement appropriate
            technical and organisational measures consistent with POPIA’s security safeguards
            principle, including:
          </p>
          <ul
            className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed"
            style={{ color: "var(--white-muted)" }}
          >
            <li>
              <strong style={{ color: "var(--white)" }}>Encryption in transit:</strong> All data
              transmitted between your device and our servers is protected using TLS 1.2 or higher.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Encryption at rest:</strong> Health records
              and personally identifiable information stored in our databases are encrypted at rest.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Access controls:</strong> Role-based access
              ensures that only your registered practitioner and authorised support staff can view
              your data. Practitioners authenticate via secure login credentials.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Audit logging:</strong> We maintain logs of
              access to sensitive data to detect and investigate unauthorised access attempts.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Regular security reviews:</strong> We
              conduct periodic assessments of our infrastructure, dependencies, and procedures to
              address emerging threats.
            </li>
          </ul>
        </section>

        <section className="mt-8">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            6. Data Retention
          </h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            We retain your personal information only for as long as necessary to fulfil the purposes
            for which it was collected, or as required by law. Health data is typically retained for
            the duration of your therapeutic relationship with your practitioner, plus any statutory
            retention period applicable to healthcare records in South Africa. When data is no
            longer required, it is securely deleted or anonymised.
          </p>
        </section>

        <section className="mt-8">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            7. Your Rights Under POPIA
          </h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            As a data subject under POPIA, you have the following rights regarding your personal
            information:
          </p>
          <ul
            className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed"
            style={{ color: "var(--white-muted)" }}
          >
            <li>
              <strong style={{ color: "var(--white)" }}>Right of access:</strong> You may request a
              copy of the personal information we hold about you.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Right to correction:</strong> You may
              request that we correct any inaccurate or outdated information.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Right to deletion:</strong> You may request
              deletion of your personal information, subject to legal retention requirements and
              your practitioner’s professional obligations.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Right to object:</strong> You may object to
              the processing of your personal information in certain circumstances.
            </li>
            <li>
              <strong style={{ color: "var(--white)" }}>Right to withdraw consent:</strong> Where
              processing is based on your consent, you may withdraw it at any time. Withdrawal does
              not affect the lawfulness of processing before the withdrawal.
            </li>
          </ul>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            To exercise any of these rights, please email us at{" "}
            <a
              href="mailto:hello@peakmovement.co.za"
              className="underline underline-offset-2"
              style={{ color: "var(--blue-accent)" }}
            >
              hello@peakmovement.co.za
            </a>
            . We will respond within the timeframe prescribed by POPIA.
          </p>
        </section>

        <section className="mt-8">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            8. Children’s Privacy
          </h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            The Service is not intended for individuals under the age of 18 without the involvement
            of a parent, guardian, or registered healthcare practitioner. If we become aware that we
            have collected personal information from a minor without appropriate consent, we will
            take steps to delete that information promptly.
          </p>
        </section>

        <section className="mt-8">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            9. Changes to This Policy
          </h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            We may update this Privacy Policy from time to time to reflect changes in our practices,
            technology, or legal requirements. We will notify you of material changes via the app or
            email. The “Last updated” date at the top of this page indicates when the policy was
            last revised.
          </p>
        </section>

        <section className="mt-8">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            10. Contact Us
          </h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
            If you have any questions about this Privacy Policy, our data practices, or your rights
            under POPIA, please contact our Information Officer:
          </p>
          <div
            className="mt-4 rounded-lg border p-4 text-sm"
            style={{
              background: "var(--navy-card)",
              borderColor: "var(--navy-border)",
              color: "var(--white-muted)",
            }}
          >
            <p>
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
              <strong style={{ color: "var(--white)" }}>Business:</strong> Peak Movement
            </p>
            <p className="mt-1">
              <strong style={{ color: "var(--white)" }}>Website:</strong>{" "}
              <a
                href="https://peakbuddy.lovable.app"
                className="underline underline-offset-2"
                style={{ color: "var(--blue-accent)" }}
              >
                peakbuddy.lovable.app
              </a>
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
