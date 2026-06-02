import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://vzzpmsmtjlhpsrkbzqlh.supabase.co";
const SERVICE_KEY = process.env.SEED_SERVICE_ROLE_KEY!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PATIENT_EMAIL = "patient-demo@peakmovement.co.za";
const PRAC_EMAIL = "practitioner-demo@peakmovement.co.za";
const PASSWORD = "BuddyDemo2026!";
const LOGIN_CODE = "5678";

async function ensureUser(email: string) {
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    await sb.auth.admin.updateUserById(existing.id, { password: PASSWORD, email_confirm: true });
    console.log(`✓ user exists: ${email}`);
    return existing.id;
  }
  const { data, error } = await sb.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  console.log(`+ created: ${email}`);
  return data.user!.id;
}

async function upsertProfile(id: string, role: string, full_name: string, profession?: string) {
  const { error } = await sb.from("profiles").upsert(
    { id, role, full_name, ...(profession ? { profession } : {}) },
    { onConflict: "id" }
  );
  if (error) throw error;
}

async function ensurePractice(practitionerId: string) {
  const { data: existing } = await sb.from("practices").select("id").eq("practitioner_id", practitionerId).maybeSingle();
  const now = new Date().toISOString();
  const payload = {
    practitioner_id: practitionerId,
    practice_name: "Peak Movement Demo Clinic",
    profession: "Physiotherapist",
    popia_agreed: true,
    popia_agreed_at: now,
    data_processing_agreed: true,
    data_processing_agreed_at: now,
    onboarding_complete: true,
  };
  if (existing) {
    await sb.from("practices").update(payload).eq("id", existing.id);
    console.log("✓ practice updated");
  } else {
    const { error } = await sb.from("practices").insert(payload);
    if (error) throw error;
    console.log("+ practice created");
  }
}

async function ensureClient(practitionerId: string) {
  const { data: existing } = await sb.from("clients").select("id").eq("email", PATIENT_EMAIL).maybeSingle();
  const payload = {
    practitioner_id: practitionerId,
    full_name: "Demo Patient",
    email: PATIENT_EMAIL,
    primary_complaint: "Chronic lower back pain with intermittent flare-ups",
    notes: "Reviewer demo account. 7 days of synthetic check-in data.",
    check_in_frequency: "daily",
    login_code: LOGIN_CODE,
    popia_accepted: true,
  };
  let clientId: string;
  if (existing) {
    await sb.from("clients").update(payload).eq("id", existing.id);
    clientId = existing.id;
    console.log("✓ client updated");
  } else {
    const { data, error } = await sb.from("clients").insert(payload).select("id").single();
    if (error) throw error;
    clientId = data.id;
    console.log("+ client created");
  }
  return clientId;
}

async function seedCheckins(clientId: string, practitionerId: string) {
  await sb.from("check_ins").delete().eq("client_id", clientId);
  // 7 days, realistic trend showing slight improvement then a flare-up
  const days = [
    { pain: 7, sleep: 4, stress: 7, energy: 3, mood: 3, notes: "Bad night, back stiff on waking.", flagged: true },
    { pain: 6, sleep: 5, stress: 6, energy: 4, mood: 4, notes: "Slightly better. Did 10min mobility." },
    { pain: 5, sleep: 6, stress: 5, energy: 5, mood: 5, notes: "Steady. Walked at lunch." },
    { pain: 4, sleep: 7, stress: 4, energy: 6, mood: 6, notes: "Best day this week." },
    { pain: 4, sleep: 7, stress: 5, energy: 6, mood: 6, notes: "Stretched morning + evening." },
    { pain: 6, sleep: 5, stress: 7, energy: 4, mood: 4, notes: "Long meeting day, flare in afternoon.", flagged: true },
    { pain: 5, sleep: 6, stress: 6, energy: 5, mood: 5, notes: "Recovering. Took meds on time." },
  ];
  const rows = days.map((d, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    date.setHours(8, 30, 0, 0);
    return {
      client_id: clientId,
      practitioner_id: practitionerId,
      pain_level: d.pain,
      sleep_quality: d.sleep,
      stress_level: d.stress,
      energy_level: d.energy,
      mood: d.mood,
      notes: d.notes,
      medication_taken: true,
      flagged: !!d.flagged,
      created_at: date.toISOString(),
    };
  });
  const { error } = await sb.from("check_ins").insert(rows);
  if (error) throw error;
  console.log(`+ inserted ${rows.length} check-ins`);
}

async function seedAlert(clientId: string, practitionerId: string) {
  await sb.from("alerts").delete().eq("client_id", clientId);
  const { error } = await sb.from("alerts").insert({
    practitioner_id: practitionerId,
    client_id: clientId,
    alert_type: "pain_spike",
    message: "Pain level spiked to 7/10 with poor sleep — possible flare-up pattern detected.",
    urgency: "urgent",
    is_read: false,
  });
  if (error) throw error;
  console.log("+ alert created");
}

async function main() {
  const pracId = await ensureUser(PRAC_EMAIL);
  await upsertProfile(pracId, "practitioner", "Dr. Demo Practitioner", "Physiotherapist");
  await ensurePractice(pracId);

  const patientAuthId = await ensureUser(PATIENT_EMAIL);
  await upsertProfile(patientAuthId, "client", "Demo Patient");

  const clientId = await ensureClient(pracId);
  await seedCheckins(clientId, pracId);
  await seedAlert(clientId, pracId);

  console.log("\n✅ Apple reviewer accounts ready:");
  console.log(`  Patient:      ${PATIENT_EMAIL} / ${PASSWORD}   (login code: ${LOGIN_CODE})`);
  console.log(`  Practitioner: ${PRAC_EMAIL} / ${PASSWORD}`);
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
