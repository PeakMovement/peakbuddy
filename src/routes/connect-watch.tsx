import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getWatchLinkDetails,
  startWatchLinkConnect,
  syncAfterWatchConnect,
} from "@/lib/wearables/watch-link.functions";
import { GarminAttribution } from "@/components/wearables/GarminAttribution";

/**
 * Connect a watch or ring without a Buddy app login.
 *
 * Buddy sends WhatsApp-only patients a personal link here (?t=TOKEN). It runs
 * the same Garmin / Oura / Polar connect as the in-app Wearables panel, for
 * their profile, and the provider sends them back here (with ?status=) when
 * they're done. Mobile first: everyone arrives from WhatsApp on a phone.
 */

type Provider = "garmin" | "oura" | "polar";

type Search = { t?: string; wearable?: Provider; status?: string };

export const Route = createFileRoute("/connect-watch")({
  head: () => ({
    meta: [{ title: "Connect your watch | Buddy" }, { name: "robots", content: "noindex" }],
  }),
  validateSearch: (s: Record<string, unknown>): Search => ({
    t: typeof s.t === "string" && s.t.length <= 200 ? s.t : undefined,
    wearable:
      s.wearable === "garmin" || s.wearable === "oura" || s.wearable === "polar"
        ? s.wearable
        : undefined,
    status: typeof s.status === "string" ? s.status.slice(0, 20) : undefined,
  }),
  component: ConnectWatchPage,
});

const BUDDY_CHAT = "https://wa.me/27675724314";

const DEVICES: { id: Provider; name: string; note: string }[] = [
  { id: "garmin", name: "Garmin", note: "Watches and fitness trackers" },
  { id: "oura", name: "Oura Ring", note: "Sleep, readiness and heart rate" },
  { id: "polar", name: "Polar", note: "Watches and heart rate sensors" },
];

const NAME: Record<Provider, string> = { garmin: "Garmin", oura: "Oura Ring", polar: "Polar" };

type Load =
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "ready"; firstName: string; connected: Provider[] };

function ConnectWatchPage() {
  const { t, wearable, status } = Route.useSearch() as Search;
  const details = useServerFn(getWatchLinkDetails);
  const start = useServerFn(startWatchLinkConnect);
  const syncAfter = useServerFn(syncAfterWatchConnect);
  const [load, setLoad] = useState<Load>({ status: t ? "loading" : "invalid" });
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const synced = useRef(false);

  useEffect(() => {
    if (!t) return;
    details({ data: { token: t } })
      .then((r) =>
        setLoad(
          r.ok
            ? { status: "ready", firstName: r.firstName, connected: r.connected as Provider[] }
            : { status: "invalid" },
        ),
      )
      .catch(() => setLoad({ status: "invalid" }));
  }, [t, details]);

  // Back from Garmin: ask for recent history once (it then arrives by itself).
  useEffect(() => {
    if (!t || synced.current || wearable !== "garmin" || status !== "connected") return;
    synced.current = true;
    syncAfter({ data: { token: t, provider: "garmin" } }).catch(() => {});
  }, [t, wearable, status, syncAfter]);

  const connect = async (provider: Provider) => {
    if (!t) return;
    setBusy(provider);
    setError(null);
    try {
      const r = await start({ data: { token: t, provider } });
      if (r.ok) {
        window.location.href = r.authUrl;
        return;
      }
      setError(r.error);
    } catch {
      setError("Couldn't start the connection. Please try again.");
    }
    setBusy(null);
  };

  return (
    <main
      className="min-h-screen px-4 py-8"
      style={{ background: "var(--navy)", color: "var(--white)" }}
    >
      <div className="mx-auto max-w-md">
        <p
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: "var(--blue-accent)" }}
        >
          Buddy
        </p>
        <h1 className="mt-2 text-2xl font-semibold" style={{ fontFamily: "var(--font-hero)" }}>
          Connect your watch
        </h1>

        {load.status === "loading" && (
          <p className="mt-6 text-sm" style={{ color: "var(--white-muted)" }}>
            Loading...
          </p>
        )}

        {load.status === "invalid" && (
          <Panel>
            This link isn't working or has expired. Send Buddy the word WATCH on WhatsApp and it
            will send you a fresh one.{" "}
            <a href={BUDDY_CHAT} className="underline" style={{ color: "var(--blue-accent)" }}>
              Open WhatsApp
            </a>
          </Panel>
        )}

        {load.status === "ready" && (
          <>
            {wearable && status === "connected" && (
              <Panel tone="good">
                <strong style={{ color: "var(--white)" }}>{NAME[wearable]} connected.</strong> Your
                data will start showing for your physiotherapist shortly. You can head back to
                WhatsApp now.
                <div className="mt-3">
                  <a
                    href={BUDDY_CHAT}
                    className="inline-block rounded-lg px-4 py-2.5 text-sm font-semibold"
                    style={{ background: "#25D366", color: "#0b1a12" }}
                  >
                    Back to WhatsApp
                  </a>
                </div>
              </Panel>
            )}
            {wearable && status === "consent" && (
              <Panel>
                {NAME[wearable]} needs data sharing switched on. In the {NAME[wearable]} app, allow
                sharing with Buddy, then tap {NAME[wearable]} below again.
              </Panel>
            )}
            {wearable && status === "error" && (
              <Panel>That didn't go through. Please try {NAME[wearable]} again below.</Panel>
            )}

            <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--white-muted)" }}>
              Hi {load.firstName}. Pick your device and sign in with that device's own account (not
              Buddy). Your physiotherapist will see your sleep, heart rate and activity alongside
              your check-ins.
            </p>

            <div className="mt-5 flex flex-col gap-3">
              {DEVICES.map((d) => {
                const on = load.connected.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={busy !== null}
                    onClick={() => connect(d.id)}
                    className="flex items-center justify-between rounded-lg border px-4 py-3 text-left"
                    style={{
                      background: "var(--navy-card)",
                      borderColor: on ? "var(--green)" : "var(--navy-border)",
                      color: "var(--white)",
                      opacity: busy && busy !== d.id ? 0.5 : 1,
                    }}
                  >
                    <span>
                      <span className="block text-base font-semibold">
                        {d.id === "garmin" ? (
                          <GarminAttribution variant="logo" size="md" />
                        ) : (
                          d.name
                        )}
                      </span>
                      <span className="block text-xs" style={{ color: "var(--white-muted)" }}>
                        {d.note}
                      </span>
                    </span>
                    <span className="text-sm font-semibold" style={{ color: "var(--blue-accent)" }}>
                      {busy === d.id ? "Opening..." : on ? "Connected" : "Connect"}
                    </span>
                  </button>
                );
              })}
            </div>

            {error && (
              <p className="mt-3 text-sm" style={{ color: "var(--red)" }}>
                {error}
              </p>
            )}

            <p className="mt-6 text-xs leading-relaxed" style={{ color: "var(--white-muted)" }}>
              You can disconnect at any time by removing Buddy from your device's connected apps, or
              by asking your physiotherapist.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function Panel({ children, tone }: { children: React.ReactNode; tone?: "good" }) {
  return (
    <div
      className="mt-6 rounded-lg border p-4 text-sm leading-relaxed"
      style={{
        background: "var(--navy-card)",
        borderColor: tone === "good" ? "var(--green)" : "var(--navy-border)",
        color: "var(--white-muted)",
      }}
    >
      {children}
    </div>
  );
}
