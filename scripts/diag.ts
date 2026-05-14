import { createClient } from "@supabase/supabase-js";
const SUPABASE_URL = "https://vzzpmsmtjlhpsrkbzqlh.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6enBtc210amxocHNya2J6cWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3ODU1NjMsImV4cCI6MjA5NDM2MTU2M30.rVSCAM50-GIQREkVUo63ddoxozGurVnAwitEBmmmOUY";
const anon = createClient(SUPABASE_URL, ANON);
console.log("== as pure anon ==");
console.log(await anon.from("clients").select("id,email").eq("email","client@demo.com").maybeSingle());
console.log(await anon.from("clients").select("id,login_code").eq("login_code","1234").maybeSingle());
