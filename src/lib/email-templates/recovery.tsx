import * as React from 'react'
import { Text } from '@react-email/components'
import { EmailShell, CtaButton, styles } from './brand'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ confirmationUrl }: RecoveryEmailProps) => (
  <EmailShell preview="Reset your Buddy password.">
    <Text style={styles.h1}>Reset your password</Text>
    <Text style={styles.text}>
      We received a request to reset the password for your Buddy account. Tap the button
      below to choose a new one. This link expires shortly.
    </Text>
    <CtaButton href={confirmationUrl} label="Reset password" />
    <Text style={styles.muted}>
      If you did not request this, you can safely ignore this email and your password stays
      the same.
    </Text>
    <Text style={styles.link}>{confirmationUrl}</Text>
  </EmailShell>
)

export default RecoveryEmail
