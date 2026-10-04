import { createFileRoute, Link } from "@tanstack/react-router";
import { publicSiteOrigin } from "@/lib/app-url";

/**
 * Terms of service.
 *
 * Written as a draft for a lawyer to check, not as finished legal text. Two
 * things in it are deliberate rather than boilerplate and should survive any
 * rewrite:
 *
 * 1. The clinical disclaimers are specific and early. Buddy records what a
 *    patient reports and flags what looks concerning; it does not diagnose and
 *    it is not watched around the clock. A patient needs to know that before
 *    they rely on it, not in clause 14.
 * 2. The liability section does NOT attempt a blanket exclusion. Under the
 *    Consumer Protection Act you cannot contract out of liability for gross
 *    negligence, or for death or personal injury caused by negligence, and a
 *    clinical service trying to would be both unenforceable and indefensible.
 */

const LAST_UPDATED = "4 October 2026";

type Section = { title: string; paragraphs: string[] };

const SECTIONS: Section[] = [
  {
    title: "1. Who we are",
    paragraphs: [
      "Buddy is provided by Peak Movement (Pty) Ltd, registration number 2024/680047/07, of 94 Strand Street, Cape Town, South Africa. In these terms, “we” and “us” mean Peak Movement, and “you” means the person using Buddy.",
      "By using Buddy you agree to these terms. If you do not agree to them, please do not use Buddy and speak to your practitioner instead. Declining will not affect your treatment in any way.",
    ],
  },
  {
    title: "2. What Buddy is",
    paragraphs: [
      "Buddy is a way to record how you are doing between appointments and to share that with your treating clinical team at Peak Movement. You log symptoms, pain, sleep and how your exercises are going, either in the app or by replying to WhatsApp check-ins. Your practitioner sees what you record and uses it alongside everything else they know about you.",
      "Buddy also looks at what you write and flags anything that appears to need attention sooner, so that your practitioner is prompted to look. That flagging is an aid to your practitioner's judgement. It is not a judgement of its own.",
    ],
  },
  {
    title: "3. What Buddy is not",
    paragraphs: [
      "Buddy does not diagnose you, does not treat you, and does not replace your practitioner or any other healthcare professional. Nothing Buddy shows you is medical advice.",
      "Buddy will not catch everything. It may flag things that turn out to be nothing, and it may fail to flag something that matters. Never delay seeking care because Buddy has not raised a concern, and never stop or change treatment because of something Buddy displayed. If you are worried about a symptom, contact your practitioner or a doctor, whatever Buddy says.",
    ],
  },
  {
    title: "4. Buddy is not an emergency service",
    paragraphs: [
      "Nobody monitors Buddy around the clock. Messages and check-ins are read during clinic hours, which are 08:30 to 18:00 on weekdays. A message sent outside those hours may not be seen until the next working day.",
      "If something is wrong and it cannot wait, do not wait for a reply from us. Phone an ambulance on 10177, or 112 from any cellphone, or go to your nearest emergency unit. If you are in mental health crisis, the SADAG 24 hour Suicide Crisis Helpline is 0800 567 567, or you can SMS 31393.",
    ],
  },
  {
    title: "5. Who may use Buddy",
    paragraphs: [
      "Buddy is for patients of Peak Movement, invited by their practitioner. It is not a general health app and it is not available to the public.",
      "You must be 18 or older to hold your own Buddy account. A patient under 18 may be tracked on Buddy only with the consent of a parent or legal guardian, who must hold and use the account on their behalf.",
    ],
  },
  {
    title: "6. Your account",
    paragraphs: [
      "Keep your sign-in details to yourself. If you use a short sign-in code, treat it like a PIN: anyone who has it can see your health information. Tell us immediately at hello@peakmovement.co.za if you think someone else has access to your account.",
      "Please keep what you record accurate and honest. Your practitioner may make clinical decisions based on it, so an inaccurate record is worse than no record.",
    ],
  },
  {
    title: "7. WhatsApp check-ins",
    paragraphs: [
      "If you opt in, Buddy will send you check-in messages on WhatsApp and record your replies. Messages travel through WhatsApp, which is operated by Meta, and are subject to WhatsApp's own terms as well as these.",
      "You can stop the check-ins at any time by replying STOP. They end immediately and permanently, and it will not affect your treatment. Standard network charges from your mobile provider may apply.",
      "The WhatsApp line is automated. It asks how you are doing and records your answer. It is not a way to have a conversation with your practitioner, and nobody is reading it in real time. If you ask to be contacted, Buddy will pass that on, but a person will come back to you rather than the line answering you.",
    ],
  },
  {
    title: "8. Automated processing",
    paragraphs: [
      "Buddy uses automated systems, including artificial intelligence provided by third parties, to summarise what you write for your practitioner and to flag anything that may need attention. We tell you who those providers are in our Privacy Policy, and we ask for your agreement before sending your information to them.",
      "No automated system makes a decision about your care. Your practitioner does.",
    ],
  },
  {
    title: "9. Availability",
    paragraphs: [
      "We try to keep Buddy running and we do not promise that it always will be. It may be unavailable for maintenance, because of a fault, or because something a third party provides has failed. Because Buddy is not an emergency service, an outage should never be the reason you do not get care.",
    ],
  },
  {
    title: "10. Your information",
    paragraphs: [
      "How we collect, use, store and protect your personal and health information is set out in our Privacy Policy, which forms part of these terms. In short: we process it to provide your care, we name every outside company that handles it, some of that handling happens outside South Africa, we do not sell it, and you can withdraw at any time.",
    ],
  },
  {
    title: "11. Ending your use of Buddy",
    paragraphs: [
      "You can stop using Buddy whenever you like. You can delete your account in the app, reply STOP to end WhatsApp check-ins, or email hello@peakmovement.co.za and ask us to close it. None of this affects your treatment.",
      "We may suspend or close an account if it is being misused, if we are required to, or if we stop offering Buddy. We will tell you if we do.",
      "Your clinical record is a separate thing from your Buddy account. We are obliged to keep clinical records for the period South African law and the Health Professions Council require, so closing your account does not delete your treatment history.",
    ],
  },
  {
    title: "12. Our responsibility to you",
    paragraphs: [
      "We do not exclude or limit our responsibility to you for death or personal injury caused by our negligence, for gross negligence, for fraud, or for anything else the law does not allow us to limit. We would not try to, and a term attempting it would not be enforceable in any event.",
      "Beyond that, Buddy is provided as it is. We are not responsible for a decision you make on the basis of something Buddy displayed rather than on your practitioner's advice, nor for a failure of a network or a third party service outside our control.",
      "Nothing in these terms affects your rights under the Consumer Protection Act 68 of 2008 or any other law that applies to you.",
    ],
  },
  {
    title: "13. Changes to these terms",
    paragraphs: [
      "We may update these terms. If a change matters to you, we will tell you in the app or by message rather than quietly changing the page, and where the change affects how your information is handled we will ask you to agree again.",
    ],
  },
  {
    title: "14. Law and disputes",
    paragraphs: [
      "These terms are governed by the law of the Republic of South Africa, and the courts of South Africa have jurisdiction.",
      "If something goes wrong, please tell us first at hello@peakmovement.co.za. We would far rather fix it directly. You also have the right to complain to the Information Regulator of South Africa about how your personal information is handled, and to the Health Professions Council of South Africa about clinical care.",
    ],
  },
];

export const Route = createFileRoute("/terms")({
  head: () => {
    const site = publicSiteOrigin();
    return {
      meta: [
        { title: "Terms of Service — Buddy Symptom Tracker" },
        {
          name: "description",
          content:
            "Terms of Service for Buddy, the patient symptom tracker from Peak Movement. What Buddy is, what it is not, and the terms on which it is provided.",
        },
        { property: "og:title", content: "Terms of Service — Buddy Symptom Tracker" },
        {
          property: "og:description",
          content: "The terms on which Peak Movement provides the Buddy symptom tracker.",
        },
        { property: "og:url", content: `${site}/terms` },
        { property: "og:type", content: "article" },
      ],
      links: [{ rel: "canonical", href: `${site}/terms` }],
    };
  },
  component: TermsPage,
});

function TermsPage() {
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
            Terms of Service
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1
          className="text-3xl font-semibold tracking-tight sm:text-4xl"
          style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
        >
          Terms of Service
        </h1>
        <p className="mt-2 text-sm" style={{ color: "var(--white-muted)" }}>
          Last updated: {LAST_UPDATED}
        </p>

        <div
          className="mt-4 rounded-lg border p-4 text-sm leading-relaxed"
          style={{
            background: "var(--navy-card)",
            borderColor: "var(--navy-border)",
            color: "var(--white-muted)",
          }}
        >
          <strong style={{ color: "var(--white)" }}>Buddy is not an emergency service.</strong> If
          something is wrong and it cannot wait, phone 10177, or 112 from any cellphone, or go to
          your nearest emergency unit. Do not wait for a reply from us.
        </div>

        {SECTIONS.map((section) => (
          <section className="mt-8" key={section.title}>
            <h2
              className="text-xl font-semibold"
              style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
            >
              {section.title}
            </h2>
            {section.paragraphs.map((p, i) => (
              <p
                key={i}
                className="mt-3 text-sm leading-relaxed"
                style={{ color: "var(--white-muted)" }}
              >
                {p}
              </p>
            ))}
          </section>
        ))}

        <section className="mt-8">
          <h2
            className="text-xl font-semibold"
            style={{ color: "var(--white)", fontFamily: "var(--font-hero)" }}
          >
            15. Contact us
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
