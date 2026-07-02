import * as React from 'react'
import { Text } from '@react-email/components'
import { EmailShell, CtaButton, styles } from './brand'

interface InviteEmailProps {
  siteName: string
  siteUrl: string
  confirmationUrl: string
}

export const InviteEmail = ({ confirmationUrl }: InviteEmailProps) => (
  <EmailShell preview="You have been invited to join Buddy.">
    <Text style={styles.h1}>You have been invited</Text>
    <Text style={styles.text}>
      Your practitioner has invited you to Buddy, your clinical companion for tracking how
      you feel and staying connected between sessions. Accept your invitation to set up your
      account.
    </Text>
    <CtaButton href={confirmationUrl} label="Accept invitation" />
    <Text style={styles.muted}>Or paste this link into your browser:</Text>
    <Text style={styles.link}>{confirmationUrl}</Text>
  </EmailShell>
)

export default InviteEmail
