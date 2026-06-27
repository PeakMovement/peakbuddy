import { createFileRoute, useSearch } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/unsubscribe')({
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === 'string' ? s.token : '',
  }),
  component: UnsubscribePage,
})

function UnsubscribePage() {
  const { token } = useSearch({ from: '/unsubscribe' })
  const [state, setState] = useState<
    'loading' | 'ready' | 'done' | 'already' | 'invalid' | 'error'
  >('loading')
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setState('invalid')
      return
    }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const data = (await r.json().catch(() => ({}))) as {
          valid?: boolean
          used?: boolean
          email?: string
        }
        if (data.used) setState('already')
        else if (data.valid) {
          setEmail(data.email ?? null)
          setState('ready')
        } else setState('invalid')
      })
      .catch(() => setState('error'))
  }, [token])

  async function confirm() {
    setState('loading')
    try {
      const r = await fetch('/email/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      setState(r.ok ? 'done' : 'error')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full bg-card border border-border rounded-2xl p-8 shadow-sm">
        <h1 className="text-2xl font-semibold mb-3">Unsubscribe from Buddy emails</h1>
        {state === 'loading' && <p className="text-muted-foreground">Loading…</p>}
        {state === 'ready' && (
          <>
            <p className="text-muted-foreground mb-6">
              You're about to unsubscribe{email ? ` ${email}` : ''} from Buddy emails.
            </p>
            <button
              onClick={confirm}
              className="w-full bg-primary text-primary-foreground rounded-lg py-3 font-medium"
            >
              Confirm unsubscribe
            </button>
          </>
        )}
        {state === 'done' && (
          <p className="text-muted-foreground">
            You're unsubscribed. You won't receive any further Buddy emails.
          </p>
        )}
        {state === 'already' && (
          <p className="text-muted-foreground">
            This address is already unsubscribed.
          </p>
        )}
        {state === 'invalid' && (
          <p className="text-muted-foreground">
            This unsubscribe link is invalid or has expired.
          </p>
        )}
        {state === 'error' && (
          <p className="text-destructive">
            Something went wrong. Please try the link again later.
          </p>
        )}
      </div>
    </div>
  )
}
