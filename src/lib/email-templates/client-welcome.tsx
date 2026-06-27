import React from 'react'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { TemplateEntry } from './registry'

interface Props {
  clientName?: string
  practitionerName?: string
  loginUrl?: string
  email?: string
}

const ClientWelcomeEmail = ({
  clientName,
  practitionerName,
  loginUrl,
  email,
}: Props) => {
  const url = loginUrl || 'https://peakbuddy.lovable.app/client/login'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your Buddy account is ready — sign in to get started.</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>Welcome to Buddy{clientName ? `, ${clientName}` : ''}</Heading>
          <Text style={text}>
            {practitionerName ? `${practitionerName} has` : 'Your practitioner has'} set up
            a Buddy account for you. Buddy helps you check in on how you're feeling, track
            your progress, and stay connected with your practitioner between sessions.
          </Text>
          {email ? (
            <Text style={text}>
              Sign in with your email <strong>{email}</strong> and the password your
              practitioner shared with you. You can also request a one-tap magic link from
              the sign-in screen.
            </Text>
          ) : (
            <Text style={text}>
              Sign in with the email and password your practitioner shared with you.
            </Text>
          )}
          <Section style={{ textAlign: 'center', margin: '32px 0' }}>
            <Button href={url} style={button}>
              Sign in to Buddy
            </Button>
          </Section>
          <Text style={muted}>
            There is no fee to use Buddy and no in-app purchases. If you weren't expecting
            this email, you can safely ignore it.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: ClientWelcomeEmail,
  subject: 'Welcome to Buddy — your account is ready',
  displayName: 'Client welcome',
  previewData: {
    clientName: 'Alex',
    practitionerName: 'Dr. Smith',
    email: 'alex@example.com',
    loginUrl: 'https://peakbuddy.lovable.app/client/login',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif' }
const container = { padding: '32px 28px', maxWidth: '560px' }
const h1 = { fontSize: '24px', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '15px', lineHeight: '1.6', color: '#1f2937', margin: '0 0 14px' }
const muted = { fontSize: '13px', lineHeight: '1.5', color: '#6b7280', marginTop: '24px' }
const button = {
  backgroundColor: '#0f172a',
  color: '#ffffff',
  padding: '12px 22px',
  borderRadius: '8px',
  fontSize: '15px',
  fontWeight: 600,
  textDecoration: 'none',
}
