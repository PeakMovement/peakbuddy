import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const REPORTS_BUCKET = "session-reports";
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MIME = /^(application\/pdf|image\/(png|jpe?g|webp|heic|heif))$/i;

function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(-80) || "report";
}

/** Access-check helper shared by every report fn (own client OR practice admin OR super_admin). */
async function assertAccess(userId: string, clientId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { canAccessClient } = await import("@/lib/practice-members.functions");
  const access = await canAccessClient(supabaseAdmin, userId, clientId);
  return access.allowed ? supabaseAdmin : null;
}

/** Mint a one-time signed upload URL for a report file (validates type + size). */
export const createReportUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        fileName: z.string().min(1).max(200),
        mimeType: z.string().min(1).max(120),
        sizeBytes: z.number().int().min(1).max(MAX_BYTES),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!ALLOWED_MIME.test(data.mimeType)) {
      return { ok: false as const, error: "Only PDF or image files are allowed." };
    }
    const admin = await assertAccess(context.userId, data.clientId);
    if (!admin) return { ok: false as const, error: "Not authorized for this client." };

    const path = `${data.clientId}/${crypto.randomUUID()}_${safeName(data.fileName)}`;
    const { data: signed, error } = await admin.storage.from(REPORTS_BUCKET).createSignedUploadUrl(path);
    if (error || !signed) return { ok: false as const, error: "Could not start the upload. Try again." };
    return { ok: true as const, path: signed.path, token: signed.token };
  });

/** Record a report's metadata after the file has been uploaded to its signed URL. */
export const recordReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        clientId: z.string().uuid(),
        storagePath: z.string().min(1).max(400),
        fileName: z.string().min(1).max(200),
        mimeType: z.string().min(1).max(120),
        sizeBytes: z.number().int().min(0).max(MAX_BYTES),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertAccess(context.userId, data.clientId);
    if (!admin) return { ok: false as const, error: "Not authorized for this client." };
    // Bind the report to the client's practice for group visibility.
    const { data: client } = await admin
      .from("clients")
      .select("practice_id")
      .eq("id", data.clientId)
      .maybeSingle();
    const { data: row, error } = await admin
      .from("session_reports")
      .insert({
        client_id: data.clientId,
        practice_id: (client as { practice_id?: string | null } | null)?.practice_id ?? null,
        uploaded_by: context.userId,
        file_name: data.fileName,
        mime_type: data.mimeType,
        size_bytes: data.sizeBytes,
        storage_path: data.storagePath,
      })
      .select("id, file_name, mime_type, size_bytes, created_at")
      .single();
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, report: row };
  });

export type ReportListItem = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  downloadUrl: string | null;
};

/** List a client's reports with short-lived signed download URLs. */
export const listReports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; reports: ReportListItem[] }> => {
    const admin = await assertAccess(context.userId, data.clientId);
    if (!admin) return { ok: false, reports: [] };
    const { data: rows } = await admin
      .from("session_reports")
      .select("id, file_name, mime_type, size_bytes, storage_path, created_at")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false });

    const reports: ReportListItem[] = [];
    for (const r of rows ?? []) {
      const { data: signed } = await admin.storage
        .from(REPORTS_BUCKET)
        .createSignedUrl(r.storage_path as string, 3600);
      reports.push({
        id: r.id as string,
        fileName: r.file_name as string,
        mimeType: r.mime_type as string,
        sizeBytes: r.size_bytes as number,
        createdAt: r.created_at as string,
        downloadUrl: signed?.signedUrl ?? null,
      });
    }
    return { ok: true, reports };
  });

/** Delete a report (file + metadata). */
export const deleteReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ reportId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rep } = await supabaseAdmin
      .from("session_reports")
      .select("client_id, storage_path")
      .eq("id", data.reportId)
      .maybeSingle();
    if (!rep) return { ok: false as const, error: "Report not found." };
    const admin = await assertAccess(context.userId, rep.client_id as string);
    if (!admin) return { ok: false as const, error: "Not authorized." };
    await admin.storage.from(REPORTS_BUCKET).remove([rep.storage_path as string]);
    await admin.from("session_reports").delete().eq("id", data.reportId);
    return { ok: true as const };
  });

// --- Yves analysis of reports + symptom/wearable data --------------------------

const ANALYSIS_SYSTEM_PROMPT = `You are a clinical decision-support assistant helping the treating practitioner review a patient.

You are given: (1) one or more of the patient's uploaded REPORTS (PDFs or images — e.g. lab results, referral letters, imaging, clinical notes), and (2) a JSON summary of the patient's recent SYMPTOM check-ins and WEARABLE data.

Read the reports TOGETHER with the symptom and wearable data and produce a practitioner-facing analysis:
- Lead with a short synthesis of what matters most.
- Notable findings from the reports (quote specific values/statements; never invent results).
- How the reports relate to the symptom trends and wearable signals (corroborating or conflicting).
- Clear medical viewpoints and suggestions the practitioner should CONSIDER (investigations, monitoring, management options) — framed as considerations, not directives.
- Flag anything that looks urgent or needs prompt attention.

Rules: base everything strictly on the supplied reports + data; if a report is unreadable or a value is absent, say so; cite the time window for symptom/wearable claims. This is decision support for a qualified clinician, NOT a diagnosis and NOT a substitute for their judgement. Keep it focused (~300–500 words), markdown, no preamble.`;

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...(bytes.subarray(i, i + chunk) as unknown as number[]));
  }
  return btoa(bin);
}

const num = (v: unknown): number | null => (typeof v === "number" && !Number.isNaN(v) ? v : null);
function mean(xs: (number | null)[]): number | null {
  const v = xs.filter((n): n is number => n !== null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}

/** Analyse a client's uploaded reports against their symptom + wearable data. */
export const analyzeReports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ clientId: z.string().uuid(), focus: z.string().max(80).optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean; text?: string; error?: string }> => {
    const admin = await assertAccess(context.userId, data.clientId);
    if (!admin) return { ok: false, error: "Not authorized for this client." };

    // AI-consent gate (same switch as the rest of Yves).
    const { hasAiConsent } = await import("@/lib/ai-consent");
    const { data: cRow } = await admin
      .from("clients")
      .select("yves_ai_consent, primary_complaint, full_name")
      .eq("id", data.clientId)
      .maybeSingle();
    if (!hasAiConsent(cRow as { yves_ai_consent?: boolean })) {
      return { ok: false, error: "This client hasn't consented to AI processing yet." };
    }

    // Gather reports (cap for request-size safety).
    const { data: repRows } = await admin
      .from("session_reports")
      .select("id, file_name, mime_type, size_bytes, storage_path, created_at")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(6);
    if (!repRows || repRows.length === 0) {
      return { ok: false, error: "Upload at least one report first." };
    }

    const inlineParts: { inlineData: { mimeType: string; data: string } }[] = [];
    let totalBytes = 0;
    for (const r of repRows) {
      if (totalBytes + (r.size_bytes as number) > 16 * 1024 * 1024) break; // keep under provider limits
      const { data: blob } = await admin.storage.from(REPORTS_BUCKET).download(r.storage_path as string);
      if (!blob) continue;
      const buf = await blob.arrayBuffer();
      totalBytes += buf.byteLength;
      inlineParts.push({ inlineData: { mimeType: r.mime_type as string, data: bufToBase64(buf) } });
    }
    if (inlineParts.length === 0) {
      return { ok: false, error: "Couldn't read the uploaded reports. Try re-uploading." };
    }

    // Compact symptom + wearable summary.
    const [{ data: checks }, { data: sess }] = await Promise.all([
      admin
        .from("check_ins")
        .select("created_at, pain_level, sleep_quality, stress_level, energy_level, mood, notes")
        .eq("client_id", data.clientId)
        .order("created_at", { ascending: false })
        .limit(30),
      admin
        .from("wearable_sessions")
        .select("date, source, sleep_score, resting_hr, hrv_avg, total_steps")
        .eq("client_id", data.clientId)
        .order("date", { ascending: false })
        .limit(30),
    ]);
    const ci = (checks ?? []) as Record<string, unknown>[];
    const ws = (sess ?? []) as Record<string, unknown>[];
    const summary = {
      client: { complaint: (cRow as { primary_complaint?: string } | null)?.primary_complaint ?? null },
      focus: data.focus ?? "general",
      check_ins: {
        count: ci.length,
        pain_avg: mean(ci.map((r) => num(r.pain_level))),
        sleep_avg: mean(ci.map((r) => num(r.sleep_quality))),
        stress_avg: mean(ci.map((r) => num(r.stress_level))),
        energy_avg: mean(ci.map((r) => num(r.energy_level))),
        recent_notes: ci.slice(0, 6).map((r) => (r.notes ? String(r.notes).slice(0, 200) : null)).filter(Boolean),
      },
      wearable: {
        days: ws.length,
        provider: ws[0]?.source ?? null,
        hrv_avg: mean(ws.map((r) => num(r.hrv_avg))),
        resting_hr_avg: mean(ws.map((r) => num(r.resting_hr))),
        sleep_score_avg: mean(ws.map((r) => num(r.sleep_score))),
        steps_avg: mean(ws.map((r) => num(r.total_steps))),
      },
    };

    const userParts: unknown[] = [
      { text: `PATIENT SYMPTOM + WEARABLE SUMMARY (JSON):\n${JSON.stringify(summary)}\n\nThe ${inlineParts.length} attached file(s) are this patient's uploaded reports. Analyse them together with the data above.` },
      ...inlineParts,
    ];

    const gk = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || "gemini-2.5-pro";
    let text = "";
    let usedModel = "";
    if (gk) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${gk}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: ANALYSIS_SYSTEM_PROMPT }] },
              contents: [{ role: "user", parts: userParts }],
            }),
          },
        );
        if (res.ok) {
          const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
          text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
          usedModel = `google/${model}`;
        } else {
          return { ok: false, error: `Analysis failed (${res.status}). Please try again.` };
        }
      } catch {
        return { ok: false, error: "Analysis service is unavailable. Please try again." };
      }
    } else {
      return {
        ok: false,
        error: "Report analysis needs the Gemini API key configured (it reads the report files directly).",
      };
    }
    if (!text) return { ok: false, error: "The analysis came back empty. Please try again." };

    // Persist (best-effort).
    try {
      await admin.from("session_report_analyses").insert({
        client_id: data.clientId,
        generated_by: context.userId,
        focus: data.focus ?? null,
        report_count: inlineParts.length,
        analysis_text: text,
        model: usedModel,
      });
    } catch {
      /* ignore */
    }
    return { ok: true, text };
  });

/** The most recent stored analysis for a client (shown on load). */
export const getLatestReportAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clientId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: boolean; text: string | null; createdAt: string | null }> => {
    const admin = await assertAccess(context.userId, data.clientId);
    if (!admin) return { ok: false, text: null, createdAt: null };
    const { data: row } = await admin
      .from("session_report_analyses")
      .select("analysis_text, created_at")
      .eq("client_id", data.clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      ok: true,
      text: (row as { analysis_text?: string } | null)?.analysis_text ?? null,
      createdAt: (row as { created_at?: string } | null)?.created_at ?? null,
    };
  });
