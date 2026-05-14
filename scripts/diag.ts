import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = "https://vzzpmsmtjlhpsrkbzqlh.supabase.co";
const KEY = process.env.SEED_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, KEY);
// Test: can we query clients by email as anon? First, sign in then query
const anon = createClient(SUPABASE_URL, "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6enBtc210amxocHNya2J6cWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3ODU1NjMsImV4cCI6MjA5NDM2MTU2M30.rVSCAM50-GIQREkVUo63ddoxozGurVnAwitEBmmmOUY");
const { data: s, error: se } = await anon.auth.signInWithPassword({ email: "client@demo.com", password: "Demo1234!" });
console.log("signin", se, s?.session?.user?.email);
const { data, error } = await anon.from("clients").select("id,email").eq("email","client@demo.com").maybeSingle();
console.log("lookup", { data, error });
