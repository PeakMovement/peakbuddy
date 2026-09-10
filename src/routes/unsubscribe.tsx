import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/unsubscribe')({
  head: () => ({
    meta: [
      { title: 'Email preferences | Buddy' },
      {
        name: 'description',
        content:
          'How to stop receiving Buddy emails — use the unsubscribe link at the bottom of any Buddy email.',
      },
      { property: 'og:title', content: 'Email preferences | Buddy' },
      {
        property: 'og:description',
        content: 'How to stop receiving Buddy emails.',
      },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
    ],
  }),
  component: UnsubscribePage,
})

function UnsubscribePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full bg-card border border-border rounded-2xl p-8 shadow-sm">
        <h1 className="text-2xl font-semibold mb-3">Buddy email preferences</h1>
        <p className="text-muted-foreground">
          To stop receiving Buddy emails, use the unsubscribe link at the bottom of
          any Buddy email. It opens a confirmation page and takes effect right away.
        </p>
        <p className="text-muted-foreground mt-4">
          Sign-in and password-reset emails always keep working so you can still
          access your account.
        </p>
      </div>
    </div>
  )
}
