import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://vzzpmsmtjlhpsrkbzqlh.supabase.co";
const SERVICE_KEY = process.env.SEED_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("Missing SEED_SERVICE_ROLE_KEY env var");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ADMIN_EMAIL = "admin@demo.com";
const PRAC_EMAIL = "practitioner@demo.com";
const PASSWORD = "Demo1234!";
const CLIENT_CODE = "DEMO123";

async function ensureUser(email: string, password: string) {
  // Try to find existing user
  const { data: list, error: listErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) throw listErr;
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    console.log(`✓ user exists: ${email} (${existing.id})`);
    return existing.id;
  }
  const { data, error } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  console.log(`+ created user: ${email} (${data.user!.id})`);
  return data.user!.id;
}

async function upsertProfile(id: string, role: string, full_name: string, profession?: string) {
  const { error } = await sb
    .from("profiles")
    .upsert({ id, role, full_name, ...(profession ? { profession } : {}) }, { onConflict: "id" });
  if (error) throw error;
  console.log(`✓ profile: ${full_name} (${role})`);
}

async function ensurePractice(practitionerId: string) {
  const { data: existing } = await sb
    .from("practices")
    .select("id")
    .eq("practitioner_id", practitionerId)
    .maybeSingle();
  if (existing) {
    console.log(`✓ practice exists for practitioner`);
    return;
  }
  const now = new Date().toISOString();
  const { error } = await sb.from("practices").insert({
    practitioner_id: practitionerId,
    practice_name: "Demo Wellness",
    profession: "Physiotherapist",
    popia_agreed: true,
    popia_agreed_at: now,
    data_processing_agreed: true,
    data_processing_agreed_at: now,
    onboarding_complete: true,
  });
  if (error) throw error;
  console.log(`+ practice created: Demo Wellness`);
}

async function ensureClient(practitionerId: string) {
  const { data: existing } = await sb
    .from("clients")
    .select("id, practitioner_id")
    .eq("login_code", CLIENT_CODE)
    .maybeSingle();
  let clientId: string;
  if (existing) {
    clientId = existing.id;
    console.log(`✓ client exists: ${CLIENT_CODE} (${clientId})`);
  } else {
    const { data, error } = await sb
      .from("clients")
      .insert({
        practitioner_id: practitionerId,
        full_name: "Demo Client",
        email: "client@demo.com",
        primary_complaint: "Lower back pain after long sitting hours",
        notes: "Office worker, started yoga 2 weeks ago.",
        check_in_frequency: "daily",
        login_code: CLIENT_CODE,
        popia_accepted: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    clientId = data.id;
    console.log(`+ client created: Demo Client (${clientId})`);
  }

  // Sample check-in for today if none exists
  const { data: anyCheckin } = await sb
    .from("check_ins")
    .select("id")
    .eq("client_id", clientId)
    .limit(1)
    .maybeSingle();
  if (!anyCheckin) {
    const { error } = await sb.from("check_ins").insert({
      client_id: clientId,
      practitioner_id: practitionerId,
      pain_level: 4,
      sleep_quality: 7,
      stress_level: 5,
      energy_level: 6,
      mood: "okay",
      notes: "Felt a bit better today after morning stretches.",
      medication_taken: true,
      flagged: false,
    });
    if (error) throw error;
    console.log(`+ sample check-in inserted`);
  } else {
    console.log(`✓ check-ins already exist`);
  }
}

async function main() {
  const adminId = await ensureUser(ADMIN_EMAIL, PASSWORD);
  await upsertProfile(adminId, "super_admin", "Demo Admin");

  const pracId = await ensureUser(PRAC_EMAIL, PASSWORD);
  await upsertProfile(pracId, "practitioner", "Demo Practitioner", "Physiotherapist");
  await ensurePractice(pracId);
  await ensureClient(pracId);

  console.log("\n✅ Done. Demo logins:");
  console.log(`   /admin/login         → ${ADMIN_EMAIL} / ${PASSWORD}`);
  console.log(`   /practitioner/login  → ${PRAC_EMAIL} / ${PASSWORD}`);
  console.log(`   /client/login        → code ${CLIENT_CODE}`);
}

main().catch((e) => {
  console.error("❌ Seed failed:", e);
  process.exit(1);
});
