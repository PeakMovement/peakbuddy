import * as React from 'react'
import { Text } from '@react-email/components'
import { EmailShell, styles } from './brand'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <EmailShell preview="Your Buddy verification code.">
    <Text style={styles.h1}>Verify it is you</Text>
    <Text style={styles.text}>Use the code below to confirm your identity in Buddy:</Text>
    <Text style={styles.code}>{token}</Text>
    <Text style={styles.muted}>
      This code expires shortly. If you did not request it, you can ignore this email.
    </Text>
  </EmailShell>
)

export default ReauthenticationEmail
