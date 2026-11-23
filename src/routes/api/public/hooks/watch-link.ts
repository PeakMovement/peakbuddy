import { createFileRoute } from "@tanstack/react-router";

/**
 * Mint a /connect-watch link for an external WhatsApp agent.
 * Off (404) unless WATCH_LINK_API_SECRET is set. See docs/OPERATIONS.md.
 */
export const Route = createFileRoute("/api/public/hooks/watch-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleWatchLinkRequest } = await import("@/lib/wearables/watch-link-api.server");
        return handleWatchLinkRequest(request);
      },
    },
  },
});
