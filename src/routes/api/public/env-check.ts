import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/env-check")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          geminiModel: process.env.GEMINI_MODEL,
          geminiKeyPresent: !!process.env.GEMINI_API_KEY,
        });
      },
    },
  },
});
