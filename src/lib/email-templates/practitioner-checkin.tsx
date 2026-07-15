import * as React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { EmailShell, CtaButton, styles } from './brand'

interface Props {
  clientName?: string
  practitionerName?: string
  loginUrl?: string
}

const PractitionerCheckinEmail = ({ clientName, practitionerName, loginUrl }: Props) => {
  const url = loginUrl || 'https://peakbuddy.lovable.app/client/login'
  const from = practitionerName ? practitionerName : 'Your practitioner'
  return (
    <EmailShell preview={`${from} is checking in with you on Buddy.`}>
      <Text style={styles.h1}>{from} is checking in with you</Text>
      <Text style={styles.text}>
        Hi{clientName ? ` ${clientName}` : ''}, {from.toLowerCase() === 'your practitioner' ? 'your practitioner' : from} would
        like to check in with you given your recent symptoms.
      </Text>
      <Text style={styles.text}>
        Please open Buddy and log how you&apos;re feeling today — it only takes a minute and helps
        {practitionerName ? ` ${practitionerName}` : ' your practitioner'} support you between sessions.
      </Text>
      <CtaButton href={url} label="Open Buddy & check in" />
      <Text style={styles.muted}>
        There is no fee to use Buddy. If you were not expecting this, you can safely ignore it.
      </Text>
    </EmailShell>
  )
}

export const template = {
  component: PractitionerCheckinEmail,
  subject: 'Your practitioner is checking in with you',
  displayName: 'Patient — practitioner check-in request',
  previewData: {
    clientName: 'Bruce',
    practitionerName: 'Dr. Smith',
    loginUrl: 'https://peakbuddy.lovable.app/client/login',
  },
} satisfies TemplateEntry

export default PractitionerCheckinEmail
