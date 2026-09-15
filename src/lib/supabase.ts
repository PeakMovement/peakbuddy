import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

// Implicit flow keeps recovery / magic-link tokens self-contained in the URL
// hash, so a password-reset link works even when opened on a different device
// from the one that requested it (PKCE would need a code verifier that only
// lives in the requesting browser). detectSessionInUrl lets the reset-password
// and auth-callback pages pick the session straight up from the link.
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    flowType: "implicit",
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
});
