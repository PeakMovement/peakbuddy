import * as React from 'react'
import { Text } from '@react-email/components'
import { EmailShell, CtaButton, styles } from './brand'

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
}

export const SignupEmail = ({ confirmationUrl }: SignupEmailProps) => (
  <EmailShell preview="Confirm your email to activate your Buddy account.">
    <Text style={styles.h1}>Confirm your email</Text>
    <Text style={styles.text}>
      Welcome to Buddy. Confirm your email address to activate your account and start
      tracking with your practitioner.
    </Text>
    <CtaButton href={confirmationUrl} label="Confirm email" />
    <Text style={styles.muted}>Or paste this link into your browser:</Text>
    <Text style={styles.link}>{confirmationUrl}</Text>
  </EmailShell>
)

export default SignupEmail
