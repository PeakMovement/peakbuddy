import * as React from "react";
import { Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";
import { EmailShell, CtaButton, styles } from "./brand";

interface Props {
  clientName?: string;
  clientFirstName?: string;
  practitionerName?: string;
  alertMessage?: string;
  urgency?: string;
  timestamp?: string;
  viewUrl?: string;
  checkinUrl?: string;
  reviewedUrl?: string;
  whatsappUrl?: string | null;
}

function urgencyColor(u?: string): string {
  switch ((u || "").toLowerCase()) {
    case "emergency":
      return "#e35b5b";
    case "urgent":
      return "#f0a34a";
    case "soon":
      return "#f0d24a";
    default:
      return "#4a8df0";
  }
}

const badgeBase: React.CSSProperties = {
  display: "inline-block",
  padding: "3px 10px",
  borderRadius: "999px",
  fontSize: "11px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontWeight: 700,
  color: "#0b1836",
  marginBottom: "12px",
};

const secondaryBtn: React.CSSProperties = {
  ...styles.button,
  backgroundColor: "transparent",
  color: "#4a8df0",
  border: "1px solid #4a8df0",
};

const PractitionerAlertEmail = ({
  clientName,
  clientFirstName,
  practitionerName,
  alertMessage,
  urgency,
  timestamp,
  viewUrl,
  checkinUrl,
  reviewedUrl,
  whatsappUrl,
}: Props) => {
  const who = clientName || clientFirstName || "One of your clients";
  const first = clientFirstName || who.split(" ")[0];
  const preview = `${first} may need review: ${(alertMessage || "").slice(0, 90)}`;
  return (
    <EmailShell preview={preview}>
      <Text style={{ ...badgeBase, backgroundColor: urgencyColor(urgency) }}>
        {(urgency || "alert").toString()}
      </Text>
      <Text style={styles.h1}>{who} may need review</Text>
      <Text style={styles.text}>
        {practitionerName ? `Hi ${practitionerName}, ` : ""}
        Buddy flagged a symptom from {first} that fits your risk profile.
      </Text>
      {alertMessage ? (
        <Text style={styles.text}>
          <strong>What Buddy saw:</strong> {alertMessage}
        </Text>
      ) : null}
      {timestamp ? <Text style={styles.muted}>Logged {timestamp}</Text> : null}

      {viewUrl ? <CtaButton href={viewUrl} label="View patient in Buddy" /> : null}
      {checkinUrl ? (
        <Text style={{ margin: 0 }}>
          <a href={checkinUrl} style={secondaryBtn}>
            Request check-in
          </a>
        </Text>
      ) : null}
      {reviewedUrl ? (
        <Text style={{ margin: 0 }}>
          <a href={reviewedUrl} style={secondaryBtn}>
            Mark reviewed
          </a>
        </Text>
      ) : null}
      {whatsappUrl ? (
        <Text style={{ margin: 0 }}>
          <a href={whatsappUrl} style={secondaryBtn}>
            WhatsApp patient
          </a>
        </Text>
      ) : null}

      <Text style={styles.muted}>
        This is an automated alert from Buddy. It is not an emergency channel — if your client
        is in immediate danger they should call emergency services.
      </Text>
    </EmailShell>
  );
};

export const template = {
  component: PractitionerAlertEmail,
  subject: (data: Record<string, unknown>) => {
    const first =
      typeof data.clientFirstName === "string" && data.clientFirstName.trim()
        ? data.clientFirstName
        : typeof data.clientName === "string" && data.clientName.trim()
          ? data.clientName.split(" ")[0]
          : "A client";
    const urgency = typeof data.urgency === "string" ? data.urgency : "alert";
    return `⚠ ${first} — ${urgency} alert`;
  },
  displayName: "Practitioner — risk alert",
  previewData: {
    clientName: "Bruce Wayne",
    clientFirstName: "Bruce",
    practitionerName: "Dr. Smith",
    alertMessage: "Pain level 8/10 reported in check-in.",
    urgency: "urgent",
    timestamp: "Today at 08:14",
    viewUrl: "https://peakbuddy.lovable.app/practitioner/app/client-detail/123",
    checkinUrl: "https://peakbuddy.lovable.app/api/public/alerts/action?token=demo&action=checkin",
    reviewedUrl: "https://peakbuddy.lovable.app/api/public/alerts/action?token=demo&action=reviewed",
    whatsappUrl: "https://wa.me/27831234567?text=Hi%20Bruce",
  },
} satisfies TemplateEntry;

export default PractitionerAlertEmail;
