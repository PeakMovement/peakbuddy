import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle, Copy, Check, Send } from "lucide-react";
import {
  getPracticeWhatsAppLink,
  getWhatsAppInviteLink,
} from "@/lib/whatsapp/onboarding.functions";

/**
 * "Chat to Buddy" links. Tapping one opens WhatsApp with a message to Buddy
 * already typed, including a join code. Because the patient sends the first
 * message, Buddy can onboard them without any app sign-up: consent link,
 * first check-in, the lot.
 */

function digits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("0")) d = `27${d.slice(1)}`;
  return d.length >= 9 ? d : null;
}

function useCopy(): [boolean, (v: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  return [
    copied,
    async (v: string) => {
      try {
        await navigator.clipboard.writeText(v);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        /* clipboard blocked: the link is selectable */
      }
    },
  ];
}

function Shell({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <MessageCircle size={16} color="#25D366" aria-hidden />
        <h2 style={heading}>{title}</h2>
      </div>
      <p style={muted}>{sub}</p>
      {children}
    </section>
  );
}

/** On a client's page: a personal link for this patient. */
export function ClientWhatsAppInviteCard({
  clientId,
  clientName,
  phone,
}: {
  clientId: string;
  clientName: string;
  phone: string | null;
}) {
  const getLink = useServerFn(getWhatsAppInviteLink);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, copy] = useCopy();

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await getLink({ data: { clientId } });
      if (r.ok) setLink(r.link);
      else setError(r.error);
    } catch {
      setError("Could not create a link.");
    } finally {
      setBusy(false);
    }
  };

  const first = clientName.trim().split(/\s+/)[0] || "there";
  const message = link
    ? `Hi ${first}, this is your practitioner. Tap this link to start your Buddy check-ins on WhatsApp. It opens a chat with Buddy, just press send: ${link}`
    : "";
  const to = digits(phone);
  const shareHref = link
    ? `https://wa.me/${to ?? ""}?text=${encodeURIComponent(message)}`
    : undefined;

  return (
    <Shell
      title="Start Buddy on WhatsApp"
      sub="Send this patient a link. Tapping it opens WhatsApp with a message to Buddy ready to send. Buddy then sends their consent form and starts their check-ins. No app sign-up needed."
    >
      {!link ? (
        <button type="button" onClick={create} disabled={busy} style={button}>
          {busy ? "Creating..." : "Get WhatsApp link"}
        </button>
      ) : (
        <>
          <div style={linkBox}>{link}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a
              href={shareHref}
              target="_blank"
              rel="noreferrer"
              style={{ ...button, background: "#25D366", color: "#0b1a12" }}
            >
              <Send size={14} aria-hidden />{" "}
              {to ? `Send to ${first} on WhatsApp` : "Share on WhatsApp"}
            </a>
            <button type="button" onClick={() => copy(message)} style={ghost}>
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} Copy
              message
            </button>
          </div>
          <p style={{ ...muted, fontSize: 11.5 }}>
            Works once, for this patient only, and expires in 14 days.
          </p>
        </>
      )}
      {error && <p style={{ ...muted, color: "var(--red)" }}>{error}</p>}
    </Shell>
  );
}

/** In settings: the practice's standing link for posters, QR codes and the website. */
export function PracticeWhatsAppLinkCard() {
  const getLink = useServerFn(getPracticeWhatsAppLink);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, copy] = useCopy();

  useEffect(() => {
    let alive = true;
    getLink()
      .then((r) => {
        if (!alive) return;
        if (r.ok) setLink(r.link);
        else setError(r.error);
      })
      .catch(() => alive && setError("Could not load the link."));
    return () => {
      alive = false;
    };
  }, [getLink]);

  return (
    <Shell
      title="Buddy WhatsApp link for new patients"
      sub="Put this on a poster or QR code at reception, or on your website. A new patient taps it, tells Buddy their name and which practitioner they see, signs their consent and starts checking in. Their profile is created for them and the practitioner is notified."
    >
      {link && (
        <>
          <div style={linkBox}>{link}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => copy(link)} style={ghost}>
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} Copy link
            </button>
          </div>
          <p style={{ ...muted, fontSize: 11.5 }}>
            Tip: paste the link into any free QR code maker to print it for reception.
          </p>
        </>
      )}
      {error && <p style={muted}>{error}</p>}
    </Shell>
  );
}

const card: CSSProperties = {
  background: "var(--navy-card)",
  border: "1px solid var(--navy-border)",
  borderRadius: 12,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  marginTop: 12,
  marginBottom: 14,
};
const heading: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 600,
  fontSize: 15,
  color: "var(--white)",
  margin: 0,
};
const muted: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  lineHeight: 1.5,
  color: "var(--white-muted)",
  margin: 0,
};
const linkBox: CSSProperties = {
  fontFamily: "var(--font-data)",
  fontSize: 11.5,
  color: "var(--white)",
  background: "var(--navy)",
  border: "1px solid var(--navy-border)",
  borderRadius: 8,
  padding: "8px 10px",
  wordBreak: "break-all",
  userSelect: "all",
};
const button: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "9px 14px",
  borderRadius: 8,
  border: "none",
  background: "var(--blue-accent)",
  color: "var(--white)",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "none",
  alignSelf: "flex-start",
};
const ghost: CSSProperties = {
  ...button,
  background: "transparent",
  border: "1px solid var(--navy-border)",
};
