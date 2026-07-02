import * as React from 'react'
import { Text } from '@react-email/components'
import { EmailShell, CtaButton, styles } from './brand'

interface EmailChangeEmailProps {
  siteName: string
  email?: string
  oldEmail?: string
  newEmail?: string
  confirmationUrl: string
}

export const EmailChangeEmail = ({ oldEmail, newEmail, confirmationUrl }: EmailChangeEmailProps) => (
  <EmailShell preview="Confirm your new email address for Buddy.">
    <Text style={styles.h1}>Confirm your email change</Text>
    <Text style={styles.text}>
      You requested to change the email on your Buddy account
      {oldEmail ? ' from ' : ''}
      {oldEmail ? <strong>{oldEmail}</strong> : null}
      {newEmail ? ' to ' : ''}
      {newEmail ? <strong>{newEmail}</strong> : null}. Confirm the change to keep your account
      secure.
    </Text>
    <CtaButton href={confirmationUrl} label="Confirm new email" />
    <Text style={styles.muted}>
      If you did not request this change, ignore this email and contact your practitioner.
    </Text>
    <Text style={styles.link}>{confirmationUrl}</Text>
  </EmailShell>
)

export default EmailChangeEmail
