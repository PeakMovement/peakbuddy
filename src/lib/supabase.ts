import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://vzzpmsmtjlhpsrkbzqlh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ6enBtc210amxocHNya2J6cWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3ODU1NjMsImV4cCI6MjA5NDM2MTU2M30.rVSCAM50-GIQREkVUo63ddoxozGurVnAwitEBmmmOUY";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
