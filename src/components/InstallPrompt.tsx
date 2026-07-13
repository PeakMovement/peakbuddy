import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Share, X, Plus, MoreVertical, Bell, Download, ArrowDown } from "lucide-react";
import { getRuntimeContext, isIosSafari } from "@/lib/runtime-context";

// Guided "Add Buddy to your phone" walkthrough shown to new clients running in
// a normal browser tab (not already installed, not inside the Despia app).
// iOS shows no install prompt, so we render illustrated step-by-step guidance;
// Android/Chromium gets the native beforeinstallprompt button plus steps.

const DISMISS_KEY = "buddy.install_prompt_dismissed";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function wasDismissed(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.includes(`${DISMISS_KEY}=1`);
}
function rememberDismissed(): void {
  if (typeof document === "undefined") return;
  // Remember for 60 days.
  document.cookie = `${DISMISS_KEY}=1; path=/; max-age=${60 * 24 * 60 * 60}; samesite=lax`;
}

export function InstallPrompt() {
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "other">("other");
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [iosStep, setIosStep] = useState(0);

  useEffect(() => {
    const ctx = getRuntimeContext();
    // Only offer install in a plain browser tab. Not in the native app, not
    // when already installed, not during SSR.
    if (ctx !== "browser") return;
    if (wasDismissed()) return;

    if (isIosSafari()) setPlatform("ios");
    else if (/android/i.test(navigator.userAgent)) setPlatform("android");
    else setPlatform("other");

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    // Show shortly after load so it doesn't fight with first paint.
    const t = window.setTimeout(() => setShow(true), 1200);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.clearTimeout(t);
    };
  }, []);

  if (!show) return null;

  const close = () => {
    setShow(false);
    rememberDismissed();
  };

  const androidInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    close();
  };

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Add Buddy to your phone">
      <div style={sheet}>
        <button type="button" onClick={close} style={closeBtn} aria-label="Close">
          <X size={18} />
        </button>

        <div style={eyebrow}>Get the full experience</div>
        <h2 style={title}>Add Buddy to your phone</h2>
        <p style={sub}>
          It takes a minute and makes Buddy feel like a normal app — it stays logged in and can send
          you gentle reminders.
        </p>

        {platform === "android" && deferred && (
          <button type="button" onClick={androidInstall} style={primaryBtn}>
            <Download size={18} /> Install Buddy
          </button>
        )}

        {platform === "ios" ? (
          <IosGuide step={iosStep} setStep={setIosStep} onDone={close} />
        ) : platform === "android" ? (
          <ol style={steps}>
            <Step icon={<Download size={18} />}>
              Tap <strong>Install Buddy</strong> above. If you don&apos;t see it, tap the{" "}
              <strong>⋮ menu</strong> and choose <strong>Install app</strong>.
            </Step>
            <Step icon={<Plus size={18} />}>
              Confirm with <strong>Install</strong> / <strong>Add</strong>. Buddy appears on your home
              screen.
            </Step>
            <Step icon={<Bell size={18} />}>
              Open <strong>Buddy</strong> and tap <strong>Allow</strong> when it asks to send
              notifications.
            </Step>
          </ol>
        ) : (
          <ol style={steps}>
            <Step icon={<MoreVertical size={18} />}>
              Open your browser menu and look for <strong>Install app</strong> or{" "}
              <strong>Add to Home screen</strong>.
            </Step>
            <Step icon={<Bell size={18} />}>
              Open Buddy from the new icon and allow notifications so you get your reminders.
            </Step>
          </ol>
        )}

        <button type="button" onClick={close} style={laterBtn}>
          Maybe later
        </button>
      </div>
    </div>
  );
}

function Step({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li style={stepRow}>
      <span style={stepIcon} aria-hidden>
        {icon}
      </span>
      <span style={stepText}>{children}</span>
    </li>
  );
}

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  background: "rgba(10,18,40,0.6)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  padding: "0 12px calc(12px + env(safe-area-inset-bottom))",
};
const sheet: CSSProperties = {
  position: "relative",
  width: "100%",
  maxWidth: 460,
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 18,
  padding: "22px 20px 18px",
  boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
};
const closeBtn: CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  background: "transparent",
  border: "none",
  color: "var(--white-muted)",
  cursor: "pointer",
  padding: 4,
};
const eyebrow: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--blue-accent)",
};
const title: CSSProperties = {
  fontFamily: "var(--font-hero)",
  fontSize: 24,
  fontWeight: 600,
  color: "var(--white)",
  margin: "4px 0 6px",
};
const sub: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 14,
  lineHeight: 1.5,
  color: "var(--white-muted)",
  margin: "0 0 16px",
};
const steps: CSSProperties = {
  listStyle: "none",
  margin: "0 0 8px",
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  counterReset: "step",
};
const stepRow: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 12 };
const stepIcon: CSSProperties = {
  flex: "0 0 auto",
  width: 36,
  height: 36,
  borderRadius: 10,
  background: "rgba(74,141,240,0.14)",
  border: "1px solid rgba(74,141,240,0.35)",
  color: "var(--blue-accent)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const stepText: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 14,
  lineHeight: 1.5,
  color: "var(--white)",
  paddingTop: 6,
};
const primaryBtn: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  width: "100%",
  minHeight: 48,
  background: "var(--blue-accent)",
  color: "var(--white)",
  border: "none",
  borderRadius: 10,
  fontFamily: "var(--font-ui)",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
  marginBottom: 16,
};
const laterBtn: CSSProperties = {
  display: "block",
  width: "100%",
  minHeight: 40,
  marginTop: 6,
  background: "transparent",
  color: "var(--white-muted)",
  border: "none",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

// Guided iOS install: one step at a time. Step 1 shows a live animated arrow
// anchored to the bottom of the screen pointing at Safari's Share button (the
// closest we can get — the Share button + share sheet are native browser chrome
// outside the page, so we can point AT it but can't detect the tap).
function IosGuide({
  step,
  setStep,
  onDone,
}: {
  step: number;
  setStep: (n: number) => void;
  onDone: () => void;
}) {
  const content: { icon: React.ReactNode; title: string; body: React.ReactNode }[] = [
    {
      icon: <Share size={18} />,
      title: "Step 1 — Tap Share",
      body: (
        <>
          Tap the <strong>Share</strong> button in Safari&apos;s bottom bar (the square with an arrow
          pointing up). Follow the arrow below.
        </>
      ),
    },
    {
      icon: <Plus size={18} />,
      title: "Step 2 — Add to Home Screen",
      body: (
        <>
          In the menu that opens, scroll down and tap <strong>Add to Home Screen</strong>, then tap{" "}
          <strong>Add</strong>.
        </>
      ),
    },
    {
      icon: <Bell size={18} />,
      title: "Step 3 — Open &amp; allow",
      body: (
        <>
          Open <strong>Buddy</strong> from the new home-screen icon, then tap <strong>Allow</strong>{" "}
          when it asks to send notifications.
        </>
      ),
    },
  ];
  const c = content[step] ?? content[0];
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {content.map((_, i) => (
          <span
            key={i}
            style={{
              height: 4,
              flex: 1,
              borderRadius: 999,
              background: i <= step ? "var(--blue-accent)" : "var(--navy-border)",
              transition: "background .2s",
            }}
          />
        ))}
      </div>
      <div style={stepRow}>
        <span style={stepIcon} aria-hidden>
          {c.icon}
        </span>
        <span style={stepText}>
          <span style={{ display: "block", color: "var(--white)", fontWeight: 700, marginBottom: 2 }}>
            {c.title}
          </span>
          {c.body}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {step > 0 && (
          <button type="button" onClick={() => setStep(step - 1)} style={iosBackBtn}>
            Back
          </button>
        )}
        {step < content.length - 1 ? (
          <button type="button" onClick={() => setStep(step + 1)} style={iosNextBtn}>
            Next
          </button>
        ) : (
          <button type="button" onClick={onDone} style={iosNextBtn}>
            Got it
          </button>
        )}
      </div>
      {step === 0 && <ShareArrow />}
    </div>
  );
}

function ShareArrow() {
  return (
    <>
      <style>{"@keyframes buddyArrowBounce{0%,100%{transform:translateY(0)}50%{transform:translateY(9px)}}"}</style>
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: "50%",
          bottom: "calc(env(safe-area-inset-bottom) + 6px)",
          transform: "translateX(-50%)",
          zIndex: 1100,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            background: "var(--blue-accent)",
            color: "#fff",
            fontFamily: "var(--font-ui)",
            fontWeight: 700,
            fontSize: 13,
            padding: "6px 12px",
            borderRadius: 999,
            marginBottom: 4,
            whiteSpace: "nowrap",
            boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
          }}
        >
          Tap Share here
        </div>
        <div style={{ animation: "buddyArrowBounce 1s ease-in-out infinite" }}>
          <ArrowDown size={36} color="var(--blue-accent)" strokeWidth={3} />
        </div>
      </div>
    </>
  );
}

const iosNextBtn: React.CSSProperties = {
  flex: 1,
  minHeight: 44,
  background: "var(--blue-accent)",
  color: "var(--white)",
  border: "none",
  borderRadius: 10,
  fontFamily: "var(--font-ui)",
  fontWeight: 700,
  fontSize: 15,
  cursor: "pointer",
};
const iosBackBtn: React.CSSProperties = {
  minHeight: 44,
  padding: "0 18px",
  background: "transparent",
  color: "var(--white-muted)",
  border: "1px solid var(--navy-border)",
  borderRadius: 10,
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
};
