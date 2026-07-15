import * as React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { EmailShell, CtaButton, styles } from './brand'

interface Props {
  clientName?: string
  practitionerName?: string
  symptomDescription?: string
  symptomScore?: number
  urgency?: string
  clientLink?: string
}

const PractitionerContactEmail = ({
  clientName,
  practitionerName,
  symptomDescription,
  symptomScore,
  urgency,
  clientLink,
}: Props) => {
  const url = clientLink || 'https://peakbuddy.lovable.app/practitioner/app'
  const who = clientName || 'One of your clients'
  return (
    <EmailShell preview={`${who} is trying to reach you on Buddy.`}>
      <Text style={styles.h1}>{who} is trying to reach you</Text>
      <Text style={styles.text}>
        {practitionerName ? `Hi ${practitionerName}, ` : ''}
        {who} reached out through Buddy and would like you to get in touch.
      </Text>
      {symptomDescription ? (
        <Text style={styles.text}>
          <strong>What they said:</strong> {symptomDescription}
          {typeof symptomScore === 'number' ? ` (severity ${symptomScore}/10)` : ''}
          {urgency ? ` · ${urgency}` : ''}
        </Text>
      ) : null}
      <CtaButton href={url} label="View patient in Buddy" />
      <Text style={styles.muted}>
        This is an automated notification from Buddy. It is not an emergency channel — if your
        client is in immediate danger they should call emergency services.
      </Text>
    </EmailShell>
  )
}

export const template = {
  component: PractitionerContactEmail,
  subject: (data: Record<string, any>) =>
    `${(data.clientName || 'A client').split(' ')[0]} is trying to reach you`,
  displayName: 'Practitioner — client contact request',
  previewData: {
    clientName: 'Bruce Wayne',
    practitionerName: 'Dr. Smith',
    symptomDescription: 'Sharp lower-back pain since this morning.',
    symptomScore: 7,
    urgency: 'soon',
    clientLink: 'https://peakbuddy.lovable.app/practitioner/app/client-detail/123',
  },
} satisfies TemplateEntry

export default PractitionerContactEmail
