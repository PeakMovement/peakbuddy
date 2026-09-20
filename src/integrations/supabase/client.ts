// Re-export the single browser client. Do not create a second Supabase
// instance here — dual clients caused split sessions (idle-signout vs login).
export { supabase } from "@/lib/supabase";
