import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://vzzpmsmtjlhpsrkbzqlh.supabase.co", process.env.SEED_SERVICE_ROLE_KEY!);
const r = await sb.from("practices").select("id,is_approved,onboarding_complete").limit(1);
console.log(JSON.stringify(r, null, 2));
