import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/marketing")({
  head: () => ({
    meta: [
      { title: "Buddy Symptom Tracker — Daily health, clinically connected" },
      {
        name: "description",
        content:
          "Buddy is a clinical symptom tracking app from Peak Movement. Log pain, sleep, stress, energy and mood — share trends with your practitioner, with AI-powered early warnings.",
      },
      { property: "og:title", content: "Buddy Symptom Tracker — Daily health, clinically connected" },
      { property: "og:description", content: "Track symptoms, share with your practitioner, catch issues early with AI." },
      { property: "og:url", content: "https://peakbuddy.lovable.app/marketing" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://peakbuddy.lovable.app/marketing" }],
  }),
  component: MarketingPage,
});

function MarketingPage() {
  return (
    <div className="min-h-screen" style={{ background: "var(--navy)", color: "var(--white)" }}>
      <header className="border-b" style={{ borderColor: "var(--navy-border)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-lg font-semibold tracking-tight" style={{ fontFamily: "var(--font-hero)" }}>
            Buddy
          </Link>
          <nav className="flex items-center gap-6 text-sm" style={{ color: "var(--white-muted)" }}>
            <Link to="/privacy-policy" className="hover:text-[var(--blue-cold)]">Privacy</Link>
            <Link to="/support" className="hover:text-[var(--blue-cold)]">Support</Link>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-6 py-20 text-center sm:py-28">
        <span
          className="inline-block rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wider"
          style={{ background: "var(--navy-card)", color: "var(--blue-cold)" }}
        >
          By Peak Movement
        </span>
        <h1
          className="mx-auto mt-6 max-w-3xl text-5xl font-semibold leading-tight tracking-tight sm:text-6xl"
          style={{ fontFamily: "var(--font-hero)" }}
        >
          Your health, monitored daily — clinically connected.
        </h1>
        <p
          className="mx-auto mt-6 max-w-2xl text-lg"
          style={{ color: "var(--white-muted)" }}
        >
          Buddy is the daily symptom tracker that turns five quick check-ins into actionable
          insights for you and your healthcare practitioner.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <a
            href="#download"
            className="rounded-lg px-6 py-3 text-sm font-semibold"
            style={{ background: "var(--blue-accent)", color: "var(--navy)" }}
          >
            Download on the App Store
          </a>
          <Link
            to="/support"
            className="rounded-lg border px-6 py-3 text-sm font-semibold"
            style={{ borderColor: "var(--navy-border)", color: "var(--white)" }}
          >
            Talk to us
          </Link>
        </div>
      </section>

      {/* BENEFITS */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="grid gap-6 sm:grid-cols-3">
          {[
            {
              title: "Real-time tracking",
              body: "Log pain, sleep, stress, energy and mood in under 30 seconds. Buddy builds a clinical-grade trend line over time.",
            },
            {
              title: "AI early warning",
              body: "Our pattern engine, Yves, flags sudden changes and quietly correlated risks before they become flare-ups.",
            },
            {
              title: "Practitioner connected",
              body: "Share your check-ins with your clinician with one tap. They see the same dashboard you do — no more guesswork between visits.",
            },
          ].map((c) => (
            <div
              key={c.title}
              className="rounded-2xl border p-6"
              style={{ background: "var(--navy-card)", borderColor: "var(--navy-border)" }}
            >
              <h3 className="text-lg font-semibold" style={{ color: "var(--blue-accent)" }}>
                {c.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
                {c.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2
          className="text-3xl font-semibold tracking-tight sm:text-4xl"
          style={{ fontFamily: "var(--font-hero)" }}
        >
          How Buddy works
        </h2>
        <ol className="mt-10 grid gap-6 sm:grid-cols-3">
          {[
            { n: "01", t: "Daily check-in", d: "Five sliders. One screen. Pain, sleep, stress, energy, mood." },
            { n: "02", t: "AI detects patterns", d: "Yves watches your timeline and highlights correlations and risk windows." },
            { n: "03", t: "Practitioner reviews", d: "Your clinician sees flagged days and trends in their dashboard." },
          ].map((s) => (
            <li
              key={s.n}
              className="rounded-2xl border p-6"
              style={{ background: "var(--navy-card)", borderColor: "var(--navy-border)" }}
            >
              <div className="text-xs font-semibold tracking-widest" style={{ color: "var(--blue-cold)" }}>
                STEP {s.n}
              </div>
              <h3 className="mt-2 text-lg font-medium">{s.t}</h3>
              <p className="mt-2 text-sm" style={{ color: "var(--white-muted)" }}>{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* CTA */}
      <section id="download" className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h2
          className="text-3xl font-semibold tracking-tight sm:text-4xl"
          style={{ fontFamily: "var(--font-hero)" }}
        >
          Start your first check-in today.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-sm" style={{ color: "var(--white-muted)" }}>
          Buddy is free to download. Available on iPhone, iPad and Apple Watch.
        </p>
        <a
          href="https://apps.apple.com/"
          className="mt-8 inline-block rounded-lg px-8 py-4 text-sm font-semibold"
          style={{ background: "var(--blue-accent)", color: "var(--navy)" }}
        >
          Download on the App Store
        </a>
      </section>

      {/* FOOTER */}
      <footer className="border-t" style={{ borderColor: "var(--navy-border)" }}>
        <div className="mx-auto grid max-w-6xl gap-6 px-6 py-10 sm:grid-cols-2">
          <div>
            <div className="text-lg font-semibold" style={{ fontFamily: "var(--font-hero)" }}>
              Peak Movement
            </div>
            <p className="mt-1 text-sm" style={{ color: "var(--white-muted)" }}>
              Medical &amp; High Performance Center
            </p>
            <p className="mt-3 text-sm">
              <a
                href="mailto:hello@peakmovement.co.za"
                className="underline"
                style={{ color: "var(--blue-cold)" }}
              >
                hello@peakmovement.co.za
              </a>
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-6 text-sm sm:justify-end" style={{ color: "var(--white-muted)" }}>
            <Link to="/privacy-policy" className="hover:text-[var(--blue-cold)]">Privacy Policy</Link>
            <Link to="/support" className="hover:text-[var(--blue-cold)]">Support</Link>
          </div>
        </div>
        <div
          className="px-6 pb-8 text-center text-xs"
          style={{ color: "var(--white-muted)" }}
        >
          © {new Date().getFullYear()} Peak Movement Medical &amp; High Performance Center.
        </div>
      </footer>
    </div>
  );
}
