import { createFileRoute } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dumbbell, ExternalLink, Sparkles, Target, Users, X, Tag } from "lucide-react";
import {
  getLibraryPrograms,
  getLibraryIntroState,
  markLibraryIntroSeen,
  type LibraryProgram,
} from "@/lib/library.functions";

export const Route = createFileRoute("/client/app/library")({
  head: () => ({ meta: [{ title: "Exercise Library — Buddy" }] }),
  component: LibraryPage,
});

function LibraryPage() {
  const loadPrograms = useServerFn(getLibraryPrograms);
  const loadIntro = useServerFn(getLibraryIntroState);
  const markSeen = useServerFn(markLibraryIntroSeen);

  const [programs, setPrograms] = useState<LibraryProgram[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [showIntro, setShowIntro] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p, intro] = await Promise.all([loadPrograms(), loadIntro()]);
        if (cancelled) return;
        setPrograms(p.programs);
        setStatus("ready");
        if (!intro.introSeen) setShowIntro(true);
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPrograms, loadIntro]);

  const dismissIntro = async () => {
    setShowIntro(false);
    try {
      await markSeen();
    } catch {
      /* non-fatal — worst case the intro shows again next visit */
    }
  };

  return (
    <div style={wrap}>
      <header style={{ marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Dumbbell size={20} color="var(--blue-accent)" aria-hidden />
          <h1 style={h1}>Exercise Library</h1>
        </div>
        <p style={sub}>
          Curated programs from your Peak Movement team. We add new ones every week — check back often.
        </p>
      </header>

      {status === "loading" && <p style={muted}>Loading your library…</p>}
      {status === "error" && (
        <p style={muted}>We couldn't load the library just now. Please pull to refresh or try again shortly.</p>
      )}

      {status === "ready" && programs && programs.length === 0 && (
        <div style={emptyBox}>
          <Sparkles size={18} color="var(--blue-accent)" aria-hidden />
          <p style={{ ...muted, margin: 0 }}>
            New programs are on their way. We're building your library now — you'll get a nudge when the first ones land.
          </p>
        </div>
      )}

      {status === "ready" && programs && programs.length > 0 && (
        <div style={grid}>
          {programs.map((p) => (
            <article key={p.id} style={card}>
              {p.image_url && (
                <div style={imgWrap}>
                  <img src={p.image_url} alt="" style={img} loading="lazy" />
                </div>
              )}
              <div style={{ padding: 16 }}>
                <h2 style={name}>{p.name}</h2>

                {p.goal && (
                  <div style={metaRow}>
                    <Target size={14} color="var(--blue-accent)" aria-hidden style={{ marginTop: 2, flex: "0 0 auto" }} />
                    <div>
                      <span style={metaLabel}>Goal</span>
                      <p style={metaText}>{p.goal}</p>
                    </div>
                  </div>
                )}

                {p.applicable_for && (
                  <div style={metaRow}>
                    <Users size={14} color="var(--blue-accent)" aria-hidden style={{ marginTop: 2, flex: "0 0 auto" }} />
                    <div>
                      <span style={metaLabel}>Who it's for</span>
                      <p style={metaText}>{p.applicable_for}</p>
                    </div>
                  </div>
                )}

                {!p.goal && !p.applicable_for && p.description && (
                  <p style={{ ...metaText, marginTop: 8 }}>{p.description}</p>
                )}

                {p.symptom_tags.length > 0 && (
                  <div style={tagRow}>
                    <Tag size={12} color="var(--white-muted)" aria-hidden />
                    {p.symptom_tags.slice(0, 6).map((t) => (
                      <span key={t} style={chip}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                <a href={p.external_url} target="_blank" rel="noopener noreferrer" style={openBtn}>
                  Open program <ExternalLink size={15} aria-hidden />
                </a>
              </div>
            </article>
          ))}
        </div>
      )}

      {showIntro && <LibraryIntro onClose={dismissIntro} />}
    </div>
  );
}

function LibraryIntro({ onClose }: { onClose: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Welcome to your Exercise Library" style={overlay}>
      <div style={modal}>
        <button type="button" onClick={onClose} aria-label="Close" style={closeBtn}>
          <X size={18} />
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
          <Dumbbell size={22} color="var(--blue-accent)" aria-hidden />
          <span style={introEyebrow}>Your Exercise Library</span>
        </div>
        <h2 style={introTitle}>Welcome — this is your library.</h2>
        <p style={introBody}>
          This is a growing collection of guided programs, hand-picked by your Peak Movement team. Each one shows its
          goal and who it's best suited to, so you can find what fits how you're feeling.
        </p>
        <p style={introBody}>
          We add fresh programs <strong style={{ color: "var(--white)" }}>every week</strong>, and Buddy will point you
          toward the ones most relevant to you. Tap any program to open it and get started.
        </p>
        <button type="button" onClick={onClose} style={introCta}>
          Explore the library
        </button>
      </div>
    </div>
  );
}

const wrap: CSSProperties = { padding: "8px 2px 24px", display: "flex", flexDirection: "column", gap: 16 };
const h1: CSSProperties = { fontFamily: "var(--font-hero)", fontSize: 26, fontWeight: 700, color: "var(--white)", margin: 0 };
const sub: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 13.5, lineHeight: 1.5, color: "var(--white-muted)", marginTop: 6 };
const muted: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 14, color: "var(--white-muted)" };
const emptyBox: CSSProperties = {
  display: "flex", gap: 10, alignItems: "flex-start",
  background: "var(--navy-card)", border: "1px solid var(--navy-border)", borderRadius: 14, padding: 16,
};
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "1fr", gap: 14 };
const card: CSSProperties = {
  background: "linear-gradient(160deg, var(--navy-card), var(--navy))",
  border: "1px solid var(--navy-border)", borderRadius: 16, overflow: "hidden",
};
const imgWrap: CSSProperties = { width: "100%", height: 150, background: "var(--navy)", overflow: "hidden" };
const img: CSSProperties = { width: "100%", height: "100%", objectFit: "cover", display: "block" };
const name: CSSProperties = { fontFamily: "var(--font-hero)", fontSize: 19, fontWeight: 700, color: "var(--white)", margin: "0 0 10px" };
const metaRow: CSSProperties = { display: "flex", gap: 8, marginTop: 8 };
const metaLabel: CSSProperties = {
  fontFamily: "var(--font-ui)", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em",
  textTransform: "uppercase", color: "var(--white-muted)",
};
const metaText: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 13.5, lineHeight: 1.5, color: "var(--white)", margin: "2px 0 0" };
const tagRow: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 14 };
const chip: CSSProperties = {
  fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--white-muted)",
  border: "1px solid var(--navy-border)", borderRadius: 999, padding: "3px 9px",
};
const openBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7, marginTop: 16,
  background: "var(--blue-accent)", color: "var(--navy)", textDecoration: "none",
  fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 700, borderRadius: 10, padding: "10px 16px",
};
const overlay: CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(4,8,20,0.72)", backdropFilter: "blur(3px)",
  display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 60,
};
const modal: CSSProperties = {
  position: "relative", maxWidth: 380, width: "100%",
  background: "linear-gradient(165deg, var(--navy-card), var(--navy))",
  border: "1px solid var(--navy-border)", borderRadius: 20, padding: "24px 22px",
};
const closeBtn: CSSProperties = {
  position: "absolute", top: 12, right: 12, background: "transparent", border: "none",
  color: "var(--white-muted)", cursor: "pointer", padding: 4,
};
const introEyebrow: CSSProperties = {
  fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, letterSpacing: "0.12em",
  textTransform: "uppercase", color: "var(--white-muted)",
};
const introTitle: CSSProperties = { fontFamily: "var(--font-hero)", fontSize: 22, fontWeight: 700, color: "var(--white)", margin: "0 0 10px" };
const introBody: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 14, lineHeight: 1.55, color: "var(--white-muted)", margin: "0 0 12px" };
const introCta: CSSProperties = {
  width: "100%", marginTop: 6, background: "var(--blue-accent)", color: "var(--navy)",
  border: "none", borderRadius: 12, padding: "12px 16px", fontFamily: "var(--font-ui)",
  fontSize: 15, fontWeight: 700, cursor: "pointer",
};
