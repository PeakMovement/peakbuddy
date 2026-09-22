import { createClient } from "@supabase/supabase-js";
import { brokeredPreviewStorage } from "@/integrations/supabase/previewAuthStorage";

/**
 * The one browser/SSR Supabase client for Buddy.
 * Implicit flow is required so password-reset / magic-link tokens in the URL
 * hash work on a different device from the one that requested them.
 */
// Publishable (anon) values are client-safe by design. They are kept as
// literal fallbacks so a deploy whose VITE_* env injection didn't run still
// boots instead of throwing and rendering the "This page didn't load" screen.
const FALLBACK_URL = "https://gkgdqfghvjjaapluxcrz.supabase.co";
const FALLBACK_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrZ2RxZmdodmpqYWFwbHV4Y3J6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MTk5NzUsImV4cCI6MjA5NjI5NTk3NX0.eW3S-AasSR0HwZWy4W6A8nwWVtZNG30d2Hg1mYYuJZM";

function createBrowserClient() {
  const SUPABASE_URL =
    import.meta.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || FALLBACK_URL;
  const SUPABASE_PUBLISHABLE_KEY =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    FALLBACK_PUBLISHABLE_KEY;


  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: brokeredPreviewStorage(),
      flowType: "implicit",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _supabase: ReturnType<typeof createBrowserClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createBrowserClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createBrowserClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
