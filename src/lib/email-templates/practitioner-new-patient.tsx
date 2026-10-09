import * as React from "react";
import { Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { EmailShell, CtaButton, styles } from "./brand";

interface Props {
  practitionerName?: string;
  patientName?: string;
  profileUrl?: string;
}

const PractitionerNewPatientEmail = ({ practitionerName, patientName, profileUrl }: Props) => {
  const who = patientName || "A new patient";
  const url = profileUrl || "https://peakbuddy.lovable.app/practitioner/app";
  return (
    <EmailShell preview={`${who} has joined Buddy and picked you as their practitioner.`}>
      <Text style={styles.h1}>New patient: {who}</Text>
      <Text style={styles.text}>
        {practitionerName ? `Hi ${practitionerName}, ` : ""}
        {who} has joined Buddy and picked you as their practitioner.
      </Text>
      <Text style={styles.text}>
        Want to help Buddy check in with them well? Open their profile and add a note: what
        you're treating, any surgery and the date, their goals, what to watch for, and any
        limits for now. Buddy uses your notes privately and never shares them with the patient.
      </Text>
      <CtaButton href={url} label="Open their profile" />
      <Text style={styles.muted}>
        Tip: add your mobile number on your Buddy profile and these arrive on WhatsApp instead,
        where you can reply with a voice note.
      </Text>
    </EmailShell>
  );
};

export const template = {
  component: PractitionerNewPatientEmail,
  subject: (data: Record<string, any>) => `New patient on Buddy: ${data.patientName || "a new patient"}`,
  displayName: "Practitioner — new patient picked them",
  previewData: {
    practitionerName: "Tristan",
    patientName: "Sam K.",
    profileUrl: "https://peakbuddy.lovable.app/practitioner/app/client-detail/123",
  },
} satisfies TemplateEntry;

export default PractitionerNewPatientEmail;
