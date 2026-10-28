import { describe, expect, it, vi } from "vitest";
import { keepWhatsAppMedia } from "./media-keep.server";

vi.mock("@/lib/push.functions", () => ({ sendPushCore: vi.fn(async () => ({ ok: true })) }));

function fakeAdmin() {
  const uploads: Array<{ path: string; type: string }> = [];
  const rows: Record<string, unknown>[] = [];
  return {
    uploads,
    rows,
    admin: {
      storage: {
        from: () => ({
          upload: async (path: string, _b: Uint8Array, o: { contentType: string }) => {
            uploads.push({ path, type: o.contentType });
            return { data: { path }, error: null };
          },
        }),
      },
      from: () => ({
        insert: async (r: Record<string, unknown>) => {
          rows.push(r);
          return { error: null };
        },
      }),
    },
  };
}

const client = { id: "c-1", practitioner_id: "p-1", practice_id: "pr-1", full_name: "Sam Test" };

describe("keeping WhatsApp photos", () => {
  it("downloads the photo and files it as a session report", async () => {
    const db = fakeAdmin();
    const ok = await keepWhatsAppMedia(
      db.admin as never,
      {
        provider: {
          fetchMedia: async () => ({ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" }),
        } as never,
        secrets: {} as never,
      },
      {
        client,
        mediaId: "m1",
        kind: "image",
        caption: "swelling tonight",
        now: new Date("2026-10-28T16:00:00Z"),
      },
    );
    expect(ok).toBe(true);
    expect(db.uploads[0].path).toMatch(/^c-1\/whatsapp-2026-10-28-[a-f0-9]{8}\.jpg$/);
    expect(db.rows[0]).toMatchObject({
      client_id: "c-1",
      practice_id: "pr-1",
      mime_type: "image/jpeg",
      size_bytes: 3,
    });
    expect(String(db.rows[0].file_name)).toContain("WhatsApp photo 28 Oct 2026: swelling tonight");
  });

  it("does nothing when the provider can't download", async () => {
    const db = fakeAdmin();
    const ok = await keepWhatsAppMedia(
      db.admin as never,
      { provider: {} as never, secrets: {} as never },
      { client, mediaId: "m1", kind: "image", caption: null, now: new Date() },
    );
    expect(ok).toBe(false);
    expect(db.rows).toHaveLength(0);
  });
});
