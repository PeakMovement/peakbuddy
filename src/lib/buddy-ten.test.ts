import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { appendNote, mergeDayCheckIn, partialFromDraft } from "./checkin-day";
import { patientFlag, BUDDY_FLAGS, converseDailyCap } from "./buddy-flags";
import { attemptOf, canRetry, hitRetryCap, inboundQueueDetail, retryReason } from "./whatsapp/inbound-retry";
import { noteAiCall, resetAiUsage, takeAiUsage } from "./whatsapp/ai-usage";
import { latestStatusByMessage, outboundFailed } from "./whatsapp/transcript-delivery";
import { reminderFollowUp } from "./whatsapp/reminder-claim";
import { acceptClientRow, resolveLinkedClient } from "./whatsapp/client-load";
import { PHONE_CLASH_PATIENT, phoneClashOwnerMessage } from "./whatsapp/phone-clash";
import { DISCHARGE_PATIENT, dischargeConfirm } from "./whatsapp/discharge";
import { appointmentConfirmLine, parseVisitTime, singleNamedVisit } from "./whatsapp/appointment-time";
import { carePhrase } from "./whatsapp/practitioner-agent";
import { bucketOf, type ClientStatus } from "./whatsapp/practitioner-status.server";
import { formatOpenErrands } from "./whatsapp/reception-errands";
import { assembleExport, exportCounts, isDataCopyRequest } from "./data-export-bundle";

describe("1 reminder claim and delivery", () => {
  it("releases a failed send and keeps a deliberate window close", () => {
    expect(reminderFollowUp("failed", false, true)).toBe("release");
    expect(reminderFollowUp("failed", true, true)).toBe("push");
    expect(reminderFollowUp("failed", false, false)).toBe("keep");
    expect(reminderFollowUp("window_closed", false, true)).toBe("keep");
    expect(reminderFollowUp("window_closed", true, true)).toBe("push");
    expect(reminderFollowUp("busy", false, true)).toBe("keep");
    expect(reminderFollowUp("sent", false, true)).toBe("keep");
  });

  it("shows not delivered when Meta later reports failed", () => {
    expect(outboundFailed(true, "failed")).toBe(true);
    expect(outboundFailed(false, null)).toBe(true);
    expect(outboundFailed(true, "delivered")).toBe(false);
    const latest = latestStatusByMessage([
      { provider_message_id: "m1", status: "sent", occurred_at: "2026-10-05T08:00:00Z" },
      { provider_message_id: "m1", status: "failed", occurred_at: "2026-10-05T08:01:00Z" },
    ]);
    expect(latest.get("m1")).toBe("failed");
  });
});

describe("2 next appointment select", () => {
  it("keeps the matched id and refuses a row that is someone else", () => {
    expect(acceptClientRow("a", { id: "a", full_name: "Sam" })?.id).toBe("a");
    expect(acceptClientRow("a", { id: "b" })).toBeNull();
    expect(acceptClientRow("a", null)).toBeNull();
    const failed = resolveLinkedClient(
      "a",
      { data: null, error: { code: "42703" } },
      { data: { id: "a" }, error: null },
    );
    expect(failed.outcome).toBe("ok");
    expect(failed.client?.id).toBe("a");
    expect(
      resolveLinkedClient("a", { data: null, error: { code: "42703" } }, { data: null, error: { code: "42703" } })
        .outcome,
    ).toBe("unreadable");
    expect(resolveLinkedClient("a", { data: null, error: null }, null).outcome).toBe("missing");
  });

  it("parses a reception time and does not invent one from a refusal", () => {
    const now = new Date("2026-10-15T08:00:00Z");
    const visit = parseVisitTime("He can do Thursday at 3pm", now);
    expect(visit?.label).toMatch(/Thursday/);
    expect(visit?.iso).toContain("T15:00:00+02:00");
    expect(parseVisitTime("Friday is full", now)).toBeNull();
    expect(appointmentConfirmLine("Sam Kruger", visit!.label)).toMatch(/Reply YES/);
    const patients = [
      { id: "a", full_name: "Sam Kruger" },
      { id: "b", full_name: "Sam Adams" },
    ];
    expect(
      singleNamedVisit("Book Sam Kruger for Thursday", "Thursday at 3pm", patients, now)?.clientId,
    ).toBe("a");
    expect(singleNamedVisit("Book Sam for Thursday", "Thursday at 3pm", patients, now)).toBeNull();
    expect(singleNamedVisit("Book Sam Kruger for Thursday", "Friday is full", [patients[0]], now)).toBeNull();
  });
});

describe("3 inbound retry and health", () => {
  it("retries a small number of times and then stops", () => {
    expect(attemptOf(null)).toBe(0);
    expect(canRetry(retryReason(null, "check-in insert failed: 40P01"))).toBe(true);
    expect(hitRetryCap("retry:3|check-in insert failed")).toBe(true);
    expect(canRetry("retry:3|check-in insert failed")).toBe(false);
    const detail = inboundQueueDetail(2, 1, 0);
    expect(detail).toMatch(/2 inbound messages still failed/);
    expect(detail).toMatch(/partial check-in/);
    expect(detail).not.toMatch(/knee|pain/);
  });

  it("saves only the fields already on a stale draft", () => {
    expect(partialFromDraft({ pain: 6, notes: ["stiff"] })).toMatchObject({ pain: 6, sleep: null });
    expect(partialFromDraft({ sleep: 3 })).toBeNull();
  });
});

describe("4 one check-in per day", () => {
  it("keeps later pain, fills blanks, appends the note, and stays flagged", () => {
    const merged = mergeDayCheckIn(
      {
        pain_level: 4,
        sleep_quality: 3,
        stress_level: null,
        energy_level: 2,
        mood: null,
        notes: "morning flare",
        medication_taken: null,
        flagged: true,
        exercise_adherence: null,
      },
      {
        pain: 7,
        sleep: 5,
        stress: 2,
        energy: 4,
        mood: "low",
        notes: "evening, red flag calf",
        medicationTaken: true,
        flagged: false,
        exerciseAdherence: "some",
      },
    );
    expect(merged.pain_level).toBe(7);
    expect(merged.sleep_quality).toBe(3);
    expect(merged.stress_level).toBe(2);
    expect(merged.notes).toBe("morning flare\nevening, red flag calf");
    expect(merged.flagged).toBe(true);
    expect(appendNote("morning flare", "morning flare")).toBe("morning flare");
  });
});

describe("5 AI cost log", () => {
  beforeEach(() => resetAiUsage());
  afterEach(() => {
    delete process.env.BUDDY_CHEAP_AI;
    delete process.env.BUDDY_CONVERSE_DAILY_CAP;
  });

  it("records model, calls and tokens, and the cheap switch is flagged", () => {
    noteAiCall({ model: "google/gemini-2.5-flash", status: 200, inputTokens: 12, outputTokens: 4 });
    noteAiCall({ model: "google/gemini-2.5-flash", status: 401, inputTokens: 0, outputTokens: 0 });
    const line = takeAiUsage();
    expect(line).toMatch(/google\/gemini-2.5-flash calls=2 failed=1 in=12 out=4/);
    expect(line).not.toMatch(/patient|knee/);
    expect(patientFlag(BUDDY_FLAGS.cheapAi)).toBe(false);
    process.env.BUDDY_CHEAP_AI = "1";
    expect(patientFlag(BUDDY_FLAGS.cheapAi)).toBe(true);
    process.env.BUDDY_CONVERSE_DAILY_CAP = "3";
    expect(converseDailyCap()).toBe(3);
  });
});

describe("6 ambiguous phone", () => {
  it("names both profiles and does not pick one", () => {
    expect(phoneClashOwnerMessage(["Sam Kruger", "Sam K"])).toMatch(/2 profiles/);
    expect(phoneClashOwnerMessage(["Sam Kruger", "Sam K"])).toMatch(/Sam Kruger and Sam K/);
    expect(PHONE_CLASH_PATIENT).toMatch(/more than one profile/);
    expect(PHONE_CLASH_PATIENT).not.toMatch(/pain|advice/);
  });
});

describe("7 discharge", () => {
  it("uses a fixed pause sentence and asks before stopping messages", () => {
    expect(DISCHARGE_PATIENT).toMatch(/paused/);
    expect(DISCHARGE_PATIENT).not.toMatch(/heal|better|advice/);
    expect(dischargeConfirm("Sam Kruger")).toMatch(/chart/);
    expect(patientFlag(BUDDY_FLAGS.discharge)).toBe(false);
    expect(carePhrase("discharge Sam Kruger")?.tool).toBe("discharge_client");
    expect(carePhrase("open the episode again for Sam Kruger")?.tool).toBe("reopen_episode");
    expect(carePhrase("prepare a copy for Sam Kruger")?.name).toBe("Sam Kruger");
    const now = new Date("2026-10-15T08:00:00Z");
    const recent = status({
      checkins: [{ at: "2026-10-14T08:00:00Z", pain: 3, sleep: null, energy: null, notes: null }],
    });
    expect(bucketOf({ ...recent, discharged: true }, now)).toBe("inactive");
    expect(
      bucketOf(
        {
          ...recent,
          discharged: true,
          openAlerts: [{ type: "red_flag", urgency: "urgent", at: "2026-10-14T08:00:00Z" }],
        },
        now,
      ),
    ).toBe("attention");
  });
});

describe("8 data export", () => {
  it("includes the promised tables and leaves Heidi out", () => {
    const bundle = assembleExport({
      generatedAt: "2026-10-15T00:00:00Z",
      clients: [{ id: "c1", full_name: "Sam", goal: "stairs", login_code: "secret" }],
      checkIns: [{ id: "i1" }],
      consents: [{ id: "k1" }],
      whatsappInbound: [{ id: "in" }],
      whatsappOutbound: [{ id: "out" }],
      wearableDays: [{ id: "w" }],
      exerciseMedia: [{ id: "m" }],
      reception: [{ id: "r" }],
    });
    expect(bundle.omitted).toEqual(["heidi_session_notes"]);
    expect(bundle.goals[0].goal).toBe("stairs");
    expect(JSON.stringify(bundle.clients)).not.toMatch(/secret/);
    expect(exportCounts(bundle)).toMatch(/1 check-ins/);
    expect(isDataCopyRequest("Can I have a copy of what you hold?")).toBe(true);
    expect(isDataCopyRequest("my pain is 4")).toBe(false);
  });
});

describe("9 offline sign-out", () => {
  it("keys the queue by the signed-in user", async () => {
    const { bindOfflineUser, clearOfflineStore, queueCheckIn, getQueue } = await import("./offline-queue");
    const mem = new Map<string, string>();
    viStore(mem);
    bindOfflineUser("user-a");
    queueCheckIn(sample("a"));
    bindOfflineUser("user-b");
    expect(getQueue()).toEqual([]);
    bindOfflineUser("user-a");
    expect(getQueue()).toHaveLength(1);
    clearOfflineStore();
    expect(getQueue()).toEqual([]);
    expect(mem.get("buddy.client_cache")).toBeUndefined();
  });
});

describe("10 reception errands on the morning note", () => {
  it("groups errands reception has, and ones still saved", () => {
    const now = new Date("2026-10-15T07:00:00Z");
    const line = formatOpenErrands(
      [
        {
          request_text: "Book Sam Kruger for Thursday",
          created_at: "2026-10-15T06:00:00Z",
          sent_at: "2026-10-15T06:05:00Z",
        },
        {
          request_text: "Move Lee Adams",
          created_at: "2026-10-14T09:00:00Z",
          sent_at: null,
        },
      ],
      now,
    );
    expect(line).toMatch(/with reception since this morning/);
    expect(line).toMatch(/reception has not had it yet/);
    expect(line).toMatch(/Book Sam Kruger/);
    expect(formatOpenErrands([], now)).toBeNull();
  });
});

function sample(id: string) {
  return {
    queued_at: "2026-10-15T00:00:00Z",
    client_id: id,
    practitioner_id: "p",
    client_name: "Sam",
    pain_level: 2,
    sleep_quality: null,
    stress_level: null,
    energy_level: null,
    mood: null,
    notes: "",
    medication_taken: false,
    flagged: false,
  };
}

function status(over: Partial<ClientStatus>): ClientStatus {
  return {
    id: "c",
    name: "Sam",
    joinedAt: "2026-10-01T00:00:00Z",
    checkins: [],
    openAlerts: [],
    channel: "whatsapp",
    ...over,
  };
}

function viStore(mem: Map<string, string>) {
  const localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => mem.set(k, v),
    removeItem: (k: string) => mem.delete(k),
  };
  vi.stubGlobal("window", { localStorage });
}
