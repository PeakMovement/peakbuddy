import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import { useEffect } from "react";
import appCss from "../styles.css?url";

// Origin of the Supabase API — preconnected below so the first data/auth call
// doesn't pay the DNS+TLS handshake on top of the request.
let SUPABASE_ORIGIN = "";
try {
  const u = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (u) SUPABASE_ORIGIN = new URL(u).origin;
} catch {
  /* ignore */
}
import { log } from "@/lib/log";
import { registerServiceWorker } from "@/lib/runtime-context";
import { initOneSignalWeb } from "@/lib/onesignal-web";
import { initIdleSignout } from "@/lib/idle-signout";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  log.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Buddy Tracker by Peak Movement" },
      { name: "theme-color", content: "#1a2952" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Buddy" },
      {
        name: "description",
        content:
          "The ultimate symptom tracker and at home aid in making sure youre finding the route cause of your problems",
      },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Buddy Tracker by Peak Movement" },
      {
        property: "og:description",
        content:
          "The ultimate symptom tracker and at home aid in making sure youre finding the route cause of your problems",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Buddy Tracker by Peak Movement" },
      {
        name: "twitter:description",
        content:
          "The ultimate symptom tracker and at home aid in making sure youre finding the route cause of your problems",
      },
      {
        property: "og:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/9e3b7f08-fbc5-4cde-92e4-68f6499b0de7",
      },
      {
        name: "twitter:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/attachments/og-images/9e3b7f08-fbc5-4cde-92e4-68f6499b0de7",
      },
    ],
    links: [
      ...(SUPABASE_ORIGIN
        ? [
            { rel: "preconnect", href: SUPABASE_ORIGIN, crossOrigin: "anonymous" as const },
            { rel: "dns-prefetch", href: SUPABASE_ORIGIN },
          ]
        : []),
      { rel: "preconnect", href: "https://cdn.onesignal.com", crossOrigin: "anonymous" as const },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/icons/apple-touch-icon-180.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    registerServiceWorker();
    // Only initialise the OneSignal web SDK once the user has ALREADY granted
    // notification permission. This stops any OneSignal auto slide-prompt from
    // appearing to new clients on load — the "Enable notifications" button
    // initialises + asks on an explicit tap, so that is the single prompt.
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      initOneSignalWeb();
    }
    const cleanup = initIdleSignout({ maxIdleMs: 24 * 60 * 60 * 1000 });
    return cleanup;
  }, []);


  return (
    <QueryClientProvider client={queryClient}>
      <div
        style={{
          minHeight: "100vh",
          background: "var(--navy)",
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <Outlet />
      </div>
    </QueryClientProvider>
  );
}
