import * as React from 'react'
import { Text } from '@react-email/components'
import { EmailShell, CtaButton, styles } from './brand'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ confirmationUrl }: MagicLinkEmailProps) => (
  <EmailShell preview="Your one tap sign in link for Buddy.">
    <Text style={styles.h1}>Your sign in link</Text>
    <Text style={styles.text}>
      Tap the button below to sign in to Buddy. For your security this link expires shortly
      and can only be used once.
    </Text>
    <CtaButton href={confirmationUrl} label="Sign in to Buddy" />
    <Text style={styles.muted}>Or paste this link into your browser:</Text>
    <Text style={styles.link}>{confirmationUrl}</Text>
  </EmailShell>
)

export default MagicLinkEmail
