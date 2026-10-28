/**
 * The Test Lab's sandbox practice. Every name, number and score here is made
 * up. Phones use the 27600000xxx range, which is not a real SA mobile block
 * Buddy will ever see from Meta.
 */
import { currentConsent } from "@/lib/consent/wording";
import type { MemoryUser, Tables } from "./memory-db";

export const LAB_PRACTICE_ID = "1ab00000-0000-4000-8000-000000000001";

export interface LabPerson {
  key: string;
  label: string;
  phone: string;
  role: "patient" | "practitioner";
  note: string;
}

const P = {
  owner: "1ab00000-0000-4000-8000-0000000000a1",
  physio: "1ab00000-0000-4000-8000-0000000000a2",
  sam: "1ab00000-0000-4000-8000-0000000000c1",
  lerato: "1ab00000-0000-4000-8000-0000000000c2",
  pieter: "1ab00000-0000-4000-8000-0000000000c3",
  nomsa: "1ab00000-0000-4000-8000-0000000000c4",
  alex: "1ab00000-0000-4000-8000-0000000000c5",
};

/** Lab user ids to person keys, so captured pushes read "owner", not a uuid. */
export const LAB_USER_KEYS: Record<string, string> = {
  [P.owner]: "owner",
  [P.physio]: "physio",
};

export const LAB_PEOPLE: LabPerson[] = [
  {
    key: "owner",
    label: "Justin (test owner)",
    phone: "27600000001",
    role: "practitioner",
    note: "Practice owner and Buddy admin. Can archive and delete.",
  },
  {
    key: "physio",
    label: "Zoe (test physio)",
    phone: "27600000002",
    role: "practitioner",
    note: "Treating physio for Sam, Lerato and Pieter.",
  },
  {
    key: "sam",
    label: "Sam Fakename",
    phone: "27600000101",
    role: "patient",
    note: "Knee rehab, daily check-ins, improving over 2 weeks.",
  },
  {
    key: "lerato",
    label: "Lerato Fakename",
    phone: "27600000102",
    role: "patient",
    note: "Low back pain, weekly on Mondays, pain stuck around 5.",
  },
  {
    key: "pieter",
    label: "Pieter Fakename",
    phone: "27600000103",
    role: "patient",
    note: "Shoulder, writes in Afrikaans, pain rising the last 3 check-ins.",
  },
  {
    key: "nomsa",
    label: "Nomsa Fakename",
    phone: "27600000104",
    role: "patient",
    note: "Ankle, gone quiet for 10 days.",
  },
  {
    key: "alex",
    label: "Alex Fakename",
    phone: "27600000105",
    role: "patient",
    note: "Brand new profile, has not agreed to WhatsApp yet.",
  },
  {
    key: "stranger",
    label: "Unknown number",
    phone: "27600000199",
    role: "patient",
    note: "Not on any profile. Tests how Buddy handles strangers and join codes.",
  },
];

const day = (now: Date, daysAgo: number, hour = 17) =>
  new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo, hour - 2, 15),
  ).toISOString();

function consents(clientId: string, at: string) {
  return (["popia_core", "whatsapp_checkins"] as const).map((t) => ({
    client_id: clientId,
    consent_type: t,
    version: currentConsent(t).version,
    withdrawn_at: null,
    superseded_by: null,
    created_at: at,
  }));
}

function checkins(
  clientId: string,
  now: Date,
  series: Array<[daysAgo: number, pain: number, sleep: number, energy: number]>,
) {
  return series.map(([d, pain, sleep, energy]) => ({
    client_id: clientId,
    practitioner_id: P.physio,
    pain_level: pain,
    sleep_quality: sleep,
    energy_level: energy,
    stress_level: 2,
    exercise_adherence: "most",
    notes: null,
    flagged: false,
    source: "whatsapp",
    created_at: day(now, d),
  }));
}

export function labSeed(now: Date): { tables: Tables; users: MemoryUser[] } {
  const joined = day(now, 30, 9);
  const client = (
    id: string,
    name: string,
    phone: string,
    complaint: string,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    full_name: name,
    practitioner_id: P.physio,
    practice_id: LAB_PRACTICE_ID,
    phone,
    phone_e164: phone,
    primary_complaint: complaint,
    yves_ai_consent: true,
    auth_user_id: null,
    notes: null,
    goal: null,
    archived_at: null,
    discharged_at: null,
    created_at: joined,
    ...extra,
  });
  const reminder = (clientId: string, days: number[], frequency: string) => ({
    client_id: clientId,
    enabled: true,
    frequency,
    time_of_day: "18:00",
    days_of_week: days,
    timezone: "Africa/Johannesburg",
    last_sent_on: null,
    created_at: joined,
  });
  const convo = (clientId: string, phone: string) => ({
    phone,
    client_id: clientId,
    state: "idle",
    draft: {},
    updated_at: day(now, 1),
    // Existing patients have already had the one-off app and watch offers.
    wearable_offer_at: day(now, 20),
    app_offer_at: day(now, 20),
  });

  const tables: Tables = {
    practices: [
      {
        id: LAB_PRACTICE_ID,
        practitioner_id: P.owner,
        practice_name: "Test Lab Practice",
        buddy_tone: "warm",
      },
    ],
    practice_members: [
      { user_id: P.owner, practice_id: LAB_PRACTICE_ID, status: "active", role: "owner" },
      { user_id: P.physio, practice_id: LAB_PRACTICE_ID, status: "active", role: "practitioner" },
    ],
    profiles: [
      {
        id: P.owner,
        full_name: "Justin Testowner",
        role: "super_admin",
        email: "owner@testlab.invalid",
      },
      {
        id: P.physio,
        full_name: "Zoe Testphysio",
        role: "practitioner",
        email: "physio@testlab.invalid",
      },
    ],
    clients: [
      client(P.sam, "Sam Fakename", "27600000101", "Knee ACL rehab"),
      client(P.lerato, "Lerato Fakename", "27600000102", "Low back pain"),
      client(P.pieter, "Pieter Fakename", "27600000103", "Shoulder impingement"),
      client(P.nomsa, "Nomsa Fakename", "27600000104", "Ankle sprain"),
      client(P.alex, "Alex Fakename", "27600000105", "Hip pain", { created_at: day(now, 0, 8) }),
    ],
    consent_records: [
      ...consents(P.sam, joined),
      ...consents(P.lerato, joined),
      ...consents(P.pieter, joined),
      ...consents(P.nomsa, joined),
    ],
    checkin_reminders: [
      reminder(P.sam, [0, 1, 2, 3, 4, 5, 6], "daily"),
      reminder(P.lerato, [1], "weekly"),
      reminder(P.pieter, [0, 1, 2, 3, 4, 5, 6], "daily"),
      reminder(P.nomsa, [0, 1, 2, 3, 4, 5, 6], "daily"),
    ],
    whatsapp_conversations: [
      convo(P.sam, "27600000101"),
      convo(P.lerato, "27600000102"),
      convo(P.pieter, "27600000103"),
      convo(P.nomsa, "27600000104"),
    ],
    check_ins: [
      ...checkins(P.sam, now, [
        [14, 6, 2, 2],
        [12, 6, 3, 2],
        [10, 5, 3, 3],
        [8, 4, 3, 3],
        [6, 4, 4, 3],
        [4, 3, 4, 4],
        [2, 3, 4, 4],
        [1, 2, 4, 4],
      ]),
      ...checkins(P.lerato, now, [
        [21, 5, 3, 3],
        [14, 5, 3, 3],
        [7, 5, 3, 3],
      ]),
      ...checkins(P.pieter, now, [
        [8, 3, 4, 4],
        [6, 3, 4, 4],
        [4, 4, 3, 3],
        [2, 5, 3, 2],
        [1, 6, 2, 2],
      ]),
      ...checkins(P.nomsa, now, [
        [20, 4, 3, 3],
        [15, 3, 4, 3],
        [10, 3, 4, 4],
      ]),
    ],
    alerts: [],
    // Sam, Lerato and Pieter wrote to Buddy a few hours ago, so the 24 hour
    // WhatsApp window is open for them. Nomsa's closed 10 days ago.
    whatsapp_inbound: [
      ...(
        [
          ["27600000101", P.sam, 3],
          ["27600000102", P.lerato, 5],
          ["27600000103", P.pieter, 2],
          ["27600000104", P.nomsa, 240],
        ] as const
      ).map(([phone, clientId, hoursAgo], i) => ({
        id: `1ab00000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
        provider: "meta",
        provider_message_id: `wamid.labseed.${i}`,
        from_phone: `+${phone}`,
        client_id: clientId,
        kind: "text",
        body: "thanks",
        status: "done",
        received_at: new Date(now.getTime() - hoursAgo * 3600_000).toISOString(),
        processed_at: new Date(now.getTime() - hoursAgo * 3600_000).toISOString(),
      })),
    ],
    whatsapp_outbound: [],
  };
  const users: MemoryUser[] = [
    { id: P.owner, email: "owner@testlab.invalid", phone: "27600000001" },
    { id: P.physio, email: "physio@testlab.invalid", phone: "27600000002" },
  ];
  return { tables, users };
}
