import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/social")({
  head: () => ({
    meta: [
      { title: "Buddy — Social Media Kit" },
      {
        name: "description",
        content:
          "Download Instagram-ready posts showcasing Buddy's daily check-ins, AI insights, and clinician connection.",
      },
      { property: "og:title", content: "Buddy — Social Media Kit" },
      {
        property: "og:description",
        content:
          "Instagram-ready posts showcasing Buddy's daily check-ins, AI insights, and clinician connection.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: SocialPage,
});

const POSTS = [
  {
    id: "01",
    src: "/social/post-01.jpg",
    title: "Daily Check-In",
    headline: "Your health in 30 seconds",
    caption:
      "Five sliders. One screen. Under 30 seconds.\n\nBuddy turns your daily pain, sleep, stress, energy and mood into a clinical-grade trend your practitioner can actually use.\n\nSmall check-in. Big impact. 📊\n\n#BuddyHealth #SymptomTracker #DailyCheckIn #HealthTech #PeakMovement",
  },
  {
    id: "02",
    src: "/social/post-02.jpg",
    title: "AI Insights",
    headline: "Catch it before it flares",
    caption:
      "What if your phone noticed the pattern before the flare-up?\n\nBuddy's AI quietly watches your timeline and flags correlations and risk windows — so you and your clinician can act early, not react late.\n\nPrevention > reaction. 🧠✨\n\n#BuddyHealth #AIPowered #EarlyWarning #HealthInsights #PeakMovement",
  },
  {
    id: "03",
    src: "/social/post-03.jpg",
    title: "Clinician Connected",
    headline: "Your clinician sees what you see",
    caption:
      "No more guesswork between visits.\n\nWith Buddy, your practitioner sees the same dashboard you do — flagged days, trend shifts, and all. Real data. Real connection. Real care.\n\nYou're not tracking alone. 🤝\n\n#BuddyHealth #ClinicianConnected #PatientCare #HealthData #PeakMovement",
  },
];

function SocialPage() {
  return (
    <div className="min-h-screen" style={{ background: "#faf8f5", color: "#1a2952" }}>
      <header className="border-b" style={{ borderColor: "#e8e4dd" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link
            to="/"
            className="text-lg font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-hero)", color: "#1a2952" }}
          >
            Buddy
          </Link>
          <nav className="flex items-center gap-6 text-sm" style={{ color: "#6b7280" }}>
            <Link to="/marketing" className="hover:text-[#4a8df0]">
              Marketing
            </Link>
            <Link to="/privacy-policy" className="hover:text-[#4a8df0]">
              Privacy
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
        <div className="text-center">
          <h1
            className="text-4xl font-semibold tracking-tight sm:text-5xl"
            style={{ fontFamily: "var(--font-hero)", color: "#1a2952" }}
          >
            Social Media Kit
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base" style={{ color: "#6b7280" }}>
            Three Instagram-ready posts you can download and share. Each one highlights a
            different side of Buddy — quick tracking, AI insights, and clinical connection.
          </p>
        </div>

        <div className="mt-16 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          {POSTS.map((post) => (
            <div
              key={post.id}
              className="flex flex-col overflow-hidden rounded-2xl border"
              style={{ background: "#fff", borderColor: "#e8e4dd" }}
            >
              <div className="relative aspect-square">
                <img
                  src={post.src}
                  alt={post.headline}
                  loading="lazy"
                  width={1080}
                  height={1080}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex flex-1 flex-col p-6">
                <div
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "#4a8df0" }}
                >
                  {post.title}
                </div>
                <h3
                  className="mt-2 text-xl font-semibold"
                  style={{ fontFamily: "var(--font-hero)", color: "#1a2952" }}
                >
                  {post.headline}
                </h3>
                <p className="mt-3 flex-1 text-sm leading-relaxed" style={{ color: "#6b7280" }}>
                  {post.caption.split("\n")[0]}
                </p>
                <div className="mt-6 flex items-center gap-3">
                  <a
                    href={post.src}
                    download={`buddy-social-${post.id}.jpg`}
                    className="inline-flex items-center rounded-lg px-4 py-2 text-sm font-semibold"
                    style={{ background: "#1a2952", color: "#f0ece4" }}
                  >
                    Download image
                  </a>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(post.caption)}
                    className="inline-flex items-center rounded-lg border px-4 py-2 text-sm font-semibold"
                    style={{ borderColor: "#e8e4dd", color: "#1a2952" }}
                  >
                    Copy caption
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t" style={{ borderColor: "#e8e4dd" }}>
        <div className="mx-auto max-w-6xl px-6 py-10 text-center text-sm" style={{ color: "#9ca3af" }}>
          © {new Date().getFullYear()} Peak Movement Medical &amp; High Performance Center.
        </div>
      </footer>
    </div>
  );
}
