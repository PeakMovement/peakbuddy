/**
 * Practitioner questions over rows the database already returned.
 * The wording cannot add a patient, a number, or a diagnosis.
 */

export interface CaseloadRow {
  name: string;
  complaint: string | null;
  adherence: "all" | "most" | "some" | "none" | null;
  pain: number | null;
  previousPain: number | null;
  sleep: number | null;
  checkedInThisWeek: boolean;
}

export function answerCaseload(question: string, rows: CaseloadRow[]): string | null {
  const q = question.toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return null;
  const adherenceGap = /who hasn.?t done|not done (their )?(exercises|programme|program)|adherence/.test(
    q,
  );
  const acl = /acl/.test(q);
  const improving = /improv/.test(q);
  const quiet = /hasn.?t checked in|no check in|not checked in/.test(q);
  const sleep = /sleep/.test(q) && /who|which|whose/.test(q);
  if (!adherenceGap && !acl && !improving && !quiet && !sleep) return null;

  let list = rows;
  if (acl) {
    list = list.filter((r) => /acl/i.test(r.complaint ?? ""));
  }
  if (adherenceGap) {
    list = list.filter((r) => r.adherence === "some" || r.adherence === "none");
  }
  if (improving) {
    list = list.filter(
      (r) => r.pain != null && r.previousPain != null && r.pain < r.previousPain,
    );
  }
  if (quiet) list = list.filter((r) => !r.checkedInThisWeek);
  if (sleep && !adherenceGap && !improving) {
    list = list.filter((r) => r.sleep != null && r.sleep <= 2);
  }
  if (!list.length) return "Nobody on your list matches that from the stored check ins.";
  const lines = list.slice(0, 12).map((r) => {
    const bits = [
      r.pain != null ? `pain ${r.pain}` : null,
      r.previousPain != null ? `earlier pain ${r.previousPain}` : null,
      r.sleep != null ? `sleep ${r.sleep}` : null,
      r.adherence ? `programme ${r.adherence}` : null,
    ].filter(Boolean);
    return `• ${r.name}${bits.length ? `: ${bits.join(", ")}` : ""}`;
  });
  const more = list.length > 12 ? `\nAnd ${list.length - 12} more on the list.` : "";
  return `From stored check ins:\n${lines.join("\n")}${more}`;
}
