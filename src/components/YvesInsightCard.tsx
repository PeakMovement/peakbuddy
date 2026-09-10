import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, FileText, Upload, Download, Stethoscope, Trash2 } from "lucide-react";
import { generateClientInsight } from "@/lib/data-hub-insight.functions";
import { supabase } from "@/lib/supabase";
import {
  createReportUpload,
  recordReport,
  listReports,
  deleteReport,
  analyzeReports,
  getLatestReportAnalysis,
  REPORTS_BUCKET,
  type ReportListItem,
} from "@/lib/session-reports.functions";

const FOCUSES = ["General overview", "Pain & symptoms", "Sleep & recovery", "Training load", "Risk factors"];

/** Practitioner-facing "Generate Yves insight" panel (own clients, 3/day). */
export function YvesInsightCard({ clientId }: { clientId: string }) {
  const gen = useServerFn(generateClientInsight);
  const [focus, setFocus] = useState(FOCUSES[0]);
  const [text, setText] = useState("");
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // --- Session reports (persistent storage + Yves analysis) ---
  const fileRef = useRef<HTMLInputElement | null>(null);
  const startUpload = useServerFn(createReportUpload);
  const saveReport = useServerFn(recordReport);
  const fetchReports = useServerFn(listReports);
  const removeReport = useServerFn(deleteReport);
  const runReportAnalysis = useServerFn(analyzeReports);
  const fetchLatestAnalysis = useServerFn(getLatestReportAnalysis);

  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reportErr, setReportErr] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState("");
  const [analysing, setAnalysing] = useState(false);

  const refreshReports = async () => {
    try {
      const r = await fetchReports({ data: { clientId } });
      setReports(r.reports ?? []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    void refreshReports();
    fetchLatestAnalysis({ data: { clientId } })
      .then((r) => { if (r.ok && r.text) setAnalysis(r.text); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const addReports = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setReportErr(null);
    try {
      for (const f of Array.from(files)) {
        const up = await startUpload({
          data: { clientId, fileName: f.name, mimeType: f.type || "application/octet-stream", sizeBytes: f.size },
        });
        if (!up.ok) { setReportErr(up.error); continue; }
        const { error: upErr } = await supabase.storage
          .from(REPORTS_BUCKET)
          .uploadToSignedUrl(up.path, up.token, f);
        if (upErr) { setReportErr("Upload failed. Please try again."); continue; }
        const saved = await saveReport({
          data: { clientId, storagePath: up.path, fileName: f.name, mimeType: f.type || "application/octet-stream", sizeBytes: f.size },
        });
        if (!saved.ok) { setReportErr(saved.error || "Couldn't save the report."); continue; }
      }
      await refreshReports();
    } catch {
      setReportErr("Something went wrong uploading. Please try again.");
    }
    setUploading(false);
  };

  const onDeleteReport = async (id: string) => {
    try {
      await removeReport({ data: { reportId: id } });
      await refreshReports();
    } catch {
      /* ignore */
    }
  };

  const runAnalysis = async () => {
    if (analysing) return;
    setAnalysing(true);
    setReportErr(null);
    try {
      const r = await runReportAnalysis({ data: { clientId, focus } });
      if (r.ok && r.text) setAnalysis(r.text);
      else setReportErr(r.error ?? "Could not analyse the reports.");
    } catch {
      setReportErr("Analysis failed. Please try again.");
    }
    setAnalysing(false);
  };

  const run = async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await gen({ data: { clientId, focus } });
      setText(r.text); setAt(r.generatedAt);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not generate insight.");
    } finally { setBusy(false); }
  };

  return (
    <section style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Sparkles size={16} color="var(--cold-blue, #7aa8ff)" />
        <div style={title}>Yves insight</div>
      </div>
      <p style={sub}>An AI read of this client's recent data. Up to 3 per day.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <select value={focus} onChange={(e) => setFocus(e.target.value)} disabled={busy} style={sel}>
          {FOCUSES.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button type="button" onClick={run} disabled={busy} style={btn}>
          {busy ? "Generating…" : "Generate"}
        </button>
      </div>
      {err && <div style={{ color: "var(--red, #f87171)", fontSize: 13, marginTop: 10 }}>{err}</div>}
      {text && (
        <div style={out}>
          {renderMarkdown(text)}
          {at && <div style={{ color: "var(--white-muted)", fontSize: 11, marginTop: 10 }}>Generated {new Date(at).toLocaleString()}</div>}
        </div>
      )}

      {/* Session reports — stored for this client, downloadable any time */}
      <div style={subCard}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileText size={15} color="var(--cold-blue, #7aa8ff)" />
          <div style={subTitle}>Session reports</div>
        </div>
        <p style={sub}>
          Upload reports from sessions (PDF or images). They'll be stored against this client so you
          can download them again later.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => { addReports(e.target.files); e.target.value = ""; }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} style={ghostBtn}>
            <Upload size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
            {uploading ? "Uploading…" : "Upload report"}
          </button>
          <span style={{ color: "var(--white-muted)", fontSize: 11 }}>PDF or images, up to 20 MB each.</span>
        </div>
        {reportErr && (
          <div style={{ color: "var(--red, #f87171)", fontSize: 12, marginTop: 8 }}>{reportErr}</div>
        )}
        {reports.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {reports.map((r) => (
              <div key={r.id} style={reportRow}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "var(--white)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.fileName}
                  </div>
                  <div style={{ color: "var(--white-muted)", fontSize: 11 }}>
                    {(r.sizeBytes / 1024).toFixed(0)} KB · added {new Date(r.createdAt).toLocaleString()}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {r.downloadUrl && (
                    <a href={r.downloadUrl} target="_blank" rel="noopener noreferrer" style={downloadLink} title="Download">
                      <Download size={15} />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => onDeleteReport(r.id)}
                    style={{ ...downloadLink, color: "var(--red, #f87171)" }}
                    title="Delete"
                    aria-label={`Delete ${r.fileName}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Yves analysis across reports + fitness data */}
      <div style={subCard}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Stethoscope size={15} color="var(--cold-blue, #7aa8ff)" />
          <div style={subTitle}>Yves report analysis</div>
        </div>
        <p style={sub}>
          Yves reads the uploaded reports together with this client's check-ins and wearable data to
          spot trends, flag problems, and summarise anything that needs attention.
        </p>
        <button
          type="button"
          onClick={runAnalysis}
          disabled={analysing || reports.length === 0}
          style={{ ...btn, marginTop: 8, opacity: reports.length === 0 ? 0.5 : 1 }}
          title={reports.length === 0 ? "Upload at least one report first" : undefined}
        >
          {analysing ? "Analysing…" : "Analyse reports"}
        </button>
        {reports.length === 0 && (
          <span style={{ color: "var(--white-muted)", fontSize: 11, marginLeft: 8 }}>
            Upload a report above to enable this.
          </span>
        )}
        {analysis && <div style={out}>{renderMarkdown(analysis)}</div>}
      </div>
    </section>
  );
}

// Minimal markdown: headings, bullets, bold, paragraphs.
function renderMarkdown(md: string) {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  lines.forEach((raw, i) => {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "$1"); // strip bold markers
    if (/^#{1,6}\s/.test(line)) {
      out.push(<div key={i} style={{ fontWeight: 700, color: "var(--white)", fontSize: 14, marginTop: 12, marginBottom: 4 }}>{line.replace(/^#{1,6}\s/, "")}</div>);
    } else if (/^\s*[-*]\s/.test(line)) {
      out.push(<div key={i} style={{ color: "var(--white)", fontSize: 13, margin: "2px 0 2px 12px" }}>• {line.replace(/^\s*[-*]\s/, "")}</div>);
    } else if (line.trim() === "") {
      out.push(<div key={i} style={{ height: 6 }} />);
    } else {
      out.push(<div key={i} style={{ color: "var(--white)", fontSize: 13, lineHeight: 1.5 }}>{line}</div>);
    }
  });
  return out;
}

const card: CSSProperties = { marginTop: 20, background: "var(--navy-card)", border: "1px solid var(--navy-border)", borderRadius: 12, padding: 16 };
const title: CSSProperties = { fontFamily: "var(--font-ui)", fontWeight: 700, color: "var(--white)", fontSize: 14, textTransform: "uppercase", letterSpacing: "0.08em" };
const sub: CSSProperties = { color: "var(--white-muted)", fontSize: 12, margin: "2px 0 0" };
const sel: CSSProperties = { background: "var(--navy)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "9px 11px", color: "var(--white)", fontSize: 14 };
const btn: CSSProperties = { background: "var(--blue-accent, #4a8df0)", color: "#04111f", border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 700, fontSize: 14, cursor: "pointer" };
const out: CSSProperties = { marginTop: 12, background: "var(--navy)", border: "1px solid var(--navy-border)", borderRadius: 10, padding: 14 };
const subCard: CSSProperties = { marginTop: 14, background: "var(--navy)", border: "1px solid var(--navy-border)", borderRadius: 10, padding: 12 };
const subTitle: CSSProperties = { fontFamily: "var(--font-ui)", fontWeight: 700, color: "var(--white)", fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em" };
const ghostBtn: CSSProperties = { display: "inline-flex", alignItems: "center", background: "transparent", color: "var(--white)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer" };
const reportRow: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "var(--navy-card)", border: "1px solid var(--navy-border)", borderRadius: 8, padding: "8px 10px" };
const downloadLink: CSSProperties = { color: "var(--blue-accent, #4a8df0)", display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 32, minHeight: 32, borderRadius: 8, border: "1px solid var(--navy-border)", flexShrink: 0 };
