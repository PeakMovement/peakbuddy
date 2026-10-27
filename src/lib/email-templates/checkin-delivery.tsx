import * as React from "react";
import { Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { EmailShell, styles } from "./brand";

const CheckinDeliveryEmail = ({
  date = "",
  undelivered = 0,
}: {
  date?: string;
  undelivered?: number;
}) => (
  <EmailShell preview="Check-ins were due and none were delivered">
    <Text style={styles.h1}>Check-ins were due and none were delivered</Text>
    <Text style={styles.text}>
      On {date}, {undelivered} {undelivered === 1 ? "patient was" : "patients were"} due a check-in
      in one run and none of those sends was delivered. This email has counts only.
    </Text>
    <Text style={styles.muted}>
      Open Admin, Check-ins, or reply to Buddy on WhatsApp with "did check-ins go out". No patient
      names are in this email.
    </Text>
  </EmailShell>
);

export const template: TemplateEntry = {
  component: CheckinDeliveryEmail,
  subject: () => "Buddy: check-ins were due and none were delivered",
  displayName: "Ops — check-in delivery",
  previewData: { date: "2026-10-27", undelivered: 4 },
};
