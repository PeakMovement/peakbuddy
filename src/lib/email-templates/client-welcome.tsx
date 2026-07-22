import * as React from 'react'
import { Text } from '@react-email/components'
import type { TemplateEntry } from './registry'
import { EmailShell, CtaButton, styles } from './brand'

interface Props {
  clientName?: string
  practitionerName?: string
  loginUrl?: string
  setPasswordUrl?: string
  email?: string
}

const ClientWelcomeEmail = ({ clientName, practitionerName, loginUrl, setPasswordUrl, email }: Props) => {
  const url = loginUrl || 'https://peakbuddy.lovable.app/client/login'
  return (
    <EmailShell preview="Your Buddy account is ready. Set your password to get started.">
      <Text style={styles.h1}>Welcome to Buddy{clientName ? `, ${clientName}` : ''}</Text>
      <Text style={styles.text}>
        {practitionerName ? `${practitionerName} has` : 'Your practitioner has'} set up a Buddy
        account for you. Buddy helps you check in on how you feel, track your progress, and stay
        connected with your practitioner between sessions.
      </Text>
      {setPasswordUrl ? (
        <>
          <Text style={styles.text}>
            Tap the button below to choose your own password{email ? <> for <strong>{email}</strong></> : null} and finish setting up your account.
          </Text>
          <CtaButton href={setPasswordUrl} label="Set your password" />
          <Text style={styles.muted}>
            Already have a password from your practitioner? You can{' '}
            <a href={url} style={{ color: '#4a8df0' }}>sign in to Buddy</a>{' '}
            directly, or request a one tap sign in link from the sign in screen.
          </Text>
        </>
      ) : (
        <>
          {email ? (
            <Text style={styles.text}>
              Sign in with your email <strong>{email}</strong> and the password your practitioner
              shared with you. You can also request a one tap sign in link from the sign in screen.
            </Text>
          ) : (
            <Text style={styles.text}>
              Sign in with the email and password your practitioner shared with you, or request a
              one tap sign in link from the sign in screen.
            </Text>
          )}
          <CtaButton href={url} label="Sign in to Buddy" />
        </>
      )}
      <Text style={styles.muted}>
        There is no fee to use Buddy and no in app purchases. If you were not expecting this email,
        you can safely ignore it.
      </Text>
    </EmailShell>
  )
}

export const template = {
  component: ClientWelcomeEmail,
  subject: 'Welcome to Buddy, your account is ready',
  displayName: 'Client welcome',
  previewData: {
    clientName: 'Alex',
    practitionerName: 'Dr. Smith',
    email: 'alex@example.com',
    loginUrl: 'https://peakbuddy.lovable.app/client/login',
    setPasswordUrl: 'https://peakbuddy.lovable.app/reset-password#access_token=example',
  },
} satisfies TemplateEntry

export default ClientWelcomeEmail
