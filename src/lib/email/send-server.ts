// Server-side transactional email sender.
// Use from server functions (createServerFn handlers) where there's no
// client JWT to call /lovable/email/transactional/send with. Renders the
// React Email template, checks suppression, ensures an unsubscribe token,
// and enqueues onto the transactional_emails pgmq queue. The shared
// /lovable/email/queue/process cron picks it up.

import * as React from 'react'
import { render } from 'react-email'
import { TEMPLATES } from '@/lib/email-templates/registry'

const SITE_NAME = 'peakbuddy'
const SENDER_DOMAIN = 'notify.buddy-health.co.za'
const FROM_DOMAIN = 'buddy-health.co.za'

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function sendTransactionalEmailServer(opts: {
  templateName: string
  recipientEmail: string
  idempotencyKey?: string
  templateData?: Record<string, unknown>
}): Promise<{ ok: true; queued: boolean } | { ok: false; error: string }> {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
  const template = TEMPLATES[opts.templateName]
  if (!template) return { ok: false, error: `Unknown template: ${opts.templateName}` }

  const effectiveRecipient = (template.to ?? opts.recipientEmail).trim()
  if (!effectiveRecipient) return { ok: false, error: 'Missing recipient' }
  const normalizedEmail = effectiveRecipient.toLowerCase()
  const messageId = crypto.randomUUID()
  const idempotencyKey = opts.idempotencyKey ?? messageId

  // Suppression check
  const { data: suppressed } = await supabaseAdmin
    .from('suppressed_emails')
    .select('email')
    .eq('email', normalizedEmail)
    .maybeSingle()
  if (suppressed) {
    await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: opts.templateName,
      recipient_email: effectiveRecipient,
      status: 'suppressed',
    })
    return { ok: true, queued: false }
  }

  // Ensure unsubscribe token
  let unsubscribeToken: string | null = null
  const { data: existingToken } = await supabaseAdmin
    .from('email_unsubscribe_tokens')
    .select('token, used_at')
    .eq('email', normalizedEmail)
    .maybeSingle()
  if (existingToken && !existingToken.used_at) {
    unsubscribeToken = existingToken.token
  } else if (!existingToken) {
    const newToken = generateToken()
    await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .upsert({ email: normalizedEmail, token: newToken }, { onConflict: 'email' })
    const { data: stored } = await supabaseAdmin
      .from('email_unsubscribe_tokens')
      .select('token')
      .eq('email', normalizedEmail)
      .maybeSingle()
    unsubscribeToken = stored?.token ?? newToken
  } else {
    return { ok: true, queued: false }
  }

  const element = React.createElement(template.component, opts.templateData ?? {})
  const html = await render(element)
  const text = await render(element, { plainText: true })
  const subject =
    typeof template.subject === 'function'
      ? template.subject((opts.templateData ?? {}) as Record<string, unknown>)
      : template.subject

  await supabaseAdmin.from('email_send_log').insert({
    message_id: messageId,
    template_name: opts.templateName,
    recipient_email: effectiveRecipient,
    status: 'pending',
  })

  const { error: enqueueError } = await supabaseAdmin.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      to: effectiveRecipient,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text,
      purpose: 'transactional',
      label: opts.templateName,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    },
  })

  if (enqueueError) {
    await supabaseAdmin.from('email_send_log').insert({
      message_id: messageId,
      template_name: opts.templateName,
      recipient_email: effectiveRecipient,
      status: 'failed',
      error_message: enqueueError.message,
    })
    return { ok: false, error: enqueueError.message }
  }

  return { ok: true, queued: true }
}
