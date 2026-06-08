import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    // Dummy values so modules that create a Supabase client at import time
    // (src/lib/supabase.ts) load without real credentials. No network calls
    // are made in unit tests.
    env: {
      VITE_SUPABASE_URL: "http://localhost:54321",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    },
  },
});
