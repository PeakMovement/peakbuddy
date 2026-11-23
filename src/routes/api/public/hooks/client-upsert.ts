import { createFileRoute } from "@tanstack/react-router";

/**
 * Add or return a Buddy client for the external Notion agent.
 * Off (404) unless CLIENT_UPSERT_API_SECRET is set. See docs/OPERATIONS.md.
 */
export const Route = createFileRoute("/api/public/hooks/client-upsert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleClientUpsertRequest } =
          await import("@/lib/clients/client-upsert-api.server");
        return handleClientUpsertRequest(request);
      },
    },
  },
});
