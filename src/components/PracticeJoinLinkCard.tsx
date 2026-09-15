import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link2, Copy, Check, RefreshCw } from "lucide-react";
import {
  getPracticeJoinLink,
  setPracticeJoinEnabled,
  regeneratePracticeJoinToken,
} from "@/lib/practice-join.functions";

/**
 * "Client sign-up link" card for the Team page. Any practitioner in the practice
 * can view and copy the link; only the admin can disable or regenerate it.
 */
export function PracticeJoinLinkCard() {
  const load = useServerFn(getPracticeJoinLink);
  const setEnabled = useServerFn(setPracticeJoinEnabled);
  const regenerate = useServerFn(regeneratePracticeJoinToken);

  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [enabled, setEnabledState] = useState(true);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await load();
        if (!alive) return;
        if (r.ok) {
          setIsOwner(r.isOwner);
          setEnabledState(r.enabled);
          setUrl(r.url);
        }
      } catch {
        /* ignore */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  };

  const toggle = async () => {
    setBusy(true);
    const r = await setEnabled({ data: { enabled: !enabled } });
    setBusy(false);
    if (r.ok) setEnabledState(r.enabled);
  };

  const rotate = async () => {
    setBusy(true);
    const r = await regenerate({});
    setBusy(false);
    if (r.ok) {
      setUrl(r.url);
      setEnabledState(true);
    }
  };

  if (loading) return null;

  return (
    <section
      style={{
        background: "var(--navy-card)",
        border: "1px solid var(--navy-border)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link2 size={16} color="var(--blue-accent)" />
        <h2 style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 14, color: "var(--white)" }}>
          Client sign-up link
        </h2>
      </div>

      <p style={{ color: "var(--white-muted)", fontSize: 13, lineHeight: 1.5 }}>
        Share this link with new clients. They create their own account and are added straight to your
        practice — and if you have several practitioners, they pick who they're seeing.
      </p>

      {url && enabled ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--navy)",
              border: "1px solid var(--navy-border)",
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            <span
              style={{
                flex: 1,
                color: "var(--white)",
                fontFamily: "var(--font-ui)",
                fontSize: 13,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {url}
            </span>
            <button
              type="button"
              onClick={() => void copy()}
              aria-label="Copy link"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "var(--blue-accent)",
                border: "none",
                borderRadius: 6,
                color: "var(--white)",
                fontFamily: "var(--font-ui)",
                fontWeight: 600,
                fontSize: 13,
                padding: "8px 12px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </>
      ) : (
        <p style={{ color: "var(--white-muted)", fontSize: 13 }}>
          The sign-up link is currently turned off. New clients can't self-register until it's turned back on.
        </p>
      )}

      {isOwner && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
          <button
            type="button"
            onClick={() => void toggle()}
            disabled={busy}
            style={secondaryBtn}
          >
            {enabled ? "Turn off link" : "Turn on link"}
          </button>
          <button
            type="button"
            onClick={() => void rotate()}
            disabled={busy}
            style={secondaryBtn}
          >
            <RefreshCw size={13} style={{ marginRight: 6 }} />
            Reset link
          </button>
        </div>
      )}
      {isOwner && (
        <p style={{ color: "var(--white-muted)", fontSize: 11, lineHeight: 1.5 }}>
          Resetting creates a new link and immediately stops the old one from working.
        </p>
      )}
    </section>
  );
}

const secondaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 40,
  padding: "0 14px",
  borderRadius: 8,
  background: "transparent",
  border: "1px solid var(--navy-border)",
  color: "var(--white-muted)",
  fontFamily: "var(--font-ui)",
  fontSize: 13,
  cursor: "pointer",
};

export default PracticeJoinLinkCard;
