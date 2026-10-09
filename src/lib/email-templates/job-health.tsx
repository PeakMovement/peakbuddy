import * as React from "react";
import { Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { EmailShell, styles } from "./brand";

interface Problem {
  job: string;
  label: string;
  problem: string;
}

const JobHealthEmail = ({ problems = [] }: { problems?: Problem[] }) => (
  <EmailShell preview={`${problems.length} Buddy background job(s) need a look`}>
    <Text style={styles.h1}>Buddy background jobs need a look</Text>
    <Text style={styles.text}>
      The daily health check found {problems.length === 1 ? "a job" : "jobs"} that did not run
      as expected:
    </Text>
    {problems.map((p) => (
      <Text key={p.job} style={styles.text}>
        <strong>{p.label}</strong>: {p.problem}
      </Text>
    ))}
    <Text style={styles.muted}>
      Times are South African time. Paste this email into Lovable or your Buddy agent to
      investigate. No patient information is included.
    </Text>
  </EmailShell>
);

export const template = {
  component: JobHealthEmail,
  subject: (data: Record<string, any>) =>
    `Buddy: ${(data.problems ?? []).length} background job(s) need a look`,
  displayName: "Ops — background job health",
  previewData: {
    problems: [
      {
        job: "wearables-sync-daily",
        label: "Wearables sync (daily)",
        problem: "No successful run since 2026-10-07 02:00",
      },
    ],
  },
} satisfies TemplateEntry;

export default JobHealthEmail;
