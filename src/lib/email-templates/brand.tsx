import * as React from 'react'
import { Body, Button, Container, Head, Html, Preview, Text } from '@react-email/components'

// Buddy brand palette (mirrors src/styles.css). Email clients need literal hex,
// not CSS variables, so these are duplicated here intentionally.
export const COLORS = {
  bg: '#1a2952', // Void Navy
  card: '#243a6b',
  border: '#3658a3',
  text: '#f0ece4', // Marble
  muted: '#b8c5db',
  accent: '#4a8df0', // Cold Blue
}

const SERIF = "'Cormorant Garamond', Georgia, 'Times New Roman', serif"
const SANS = "'Rajdhani', 'Segoe UI', Arial, sans-serif"
const MONO = "'Space Mono', 'Courier New', monospace"

export const styles: Record<string, React.CSSProperties> = {
  main: { backgroundColor: COLORS.bg, margin: 0, padding: '24px 0', fontFamily: SANS },
  container: {
    backgroundColor: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '16px',
    maxWidth: '480px',
    margin: '0 auto',
    padding: '32px 28px',
  },
  wordmark: { fontFamily: SERIF, fontSize: '30px', fontWeight: 600, color: COLORS.text, margin: 0, letterSpacing: '0.02em' },
  brandRule: { fontFamily: SANS, fontSize: '11px', letterSpacing: '0.22em', textTransform: 'uppercase', color: COLORS.accent, margin: '2px 0 26px' },
  h1: { fontFamily: SERIF, fontSize: '24px', fontWeight: 600, color: COLORS.text, margin: '0 0 14px' },
  text: { fontFamily: SANS, fontSize: '16px', lineHeight: '24px', color: COLORS.text, margin: '0 0 16px' },
  muted: { fontFamily: SANS, fontSize: '13px', lineHeight: '20px', color: COLORS.muted, margin: '0 0 8px' },
  button: { display: 'inline-block', backgroundColor: COLORS.accent, color: '#0b1836', fontFamily: SANS, fontWeight: 700, fontSize: '16px', textDecoration: 'none', padding: '13px 28px', borderRadius: '8px', margin: '6px 0 22px' },
  link: { color: COLORS.accent, wordBreak: 'break-all', fontFamily: SANS, fontSize: '13px', margin: '0 0 8px' },
  code: { fontFamily: MONO, fontSize: '30px', fontWeight: 700, letterSpacing: '0.28em', color: COLORS.accent, backgroundColor: COLORS.bg, borderRadius: '8px', padding: '14px 0', textAlign: 'center', margin: '8px 0 18px' },
  footer: { fontFamily: SANS, fontSize: '11px', lineHeight: '18px', color: COLORS.muted, margin: '26px 0 0', borderTop: `1px solid ${COLORS.border}`, paddingTop: '16px' },
}

export function EmailShell({ preview, children }: { preview: string; children: React.ReactNode }) {
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.main}>
        <Container style={styles.container}>
          <Text style={styles.wordmark}>Buddy</Text>
          <Text style={styles.brandRule}>by Peak Movement</Text>
          {children}
          <Text style={styles.footer}>
            You received this email from Buddy, your clinical companion by Peak Movement. If
            you were not expecting it, you can safely ignore it.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export function CtaButton({ href, label }: { href: string; label: string }) {
  return (
    <Button href={href} style={styles.button}>
      {label}
    </Button>
  )
}
