// Server-side app email sender.
// Sends through Lovable's managed email API via the shared template helper.
// Delivery, retries, suppression and unsubscribe handling are managed by
// Lovable; this wrapper keeps Buddy's own email_send_log audit rows.

import { sendTemplateEmail } from '@/lib/email-templates/send-email'

export async function sendTransactionalEmailServer(opts: {
  templateName: string
  recipientEmail: string
  idempotencyKey?: string
  templateData?: Record<string, unknown>
}): Promise<{ ok: true; queued: boolean } | { ok: false; error: string }> {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server')

  const logSend = async (
    status: 'sent' | 'suppressed' | 'failed',
    errorMessage?: string,
  ) => {
    const { error } = await supabaseAdmin.from('email_send_log').insert({
      message_id: null,
      template_name: opts.templateName,
      recipient_email: opts.recipientEmail,
      status,
      ...(errorMessage ? { error_message: errorMessage.slice(0, 1000) } : {}),
    })
    if (error) {
      console.error('Failed to write email_send_log row', {
        code: error.code,
        message: error.message,
      })
    }
  }

  try {
    const result = await sendTemplateEmail(opts.templateName, opts.recipientEmail, {
      templateData: opts.templateData as Record<string, any> | undefined,
      idempotencyKey: opts.idempotencyKey,
    })

    if (!result.sent) {
      await logSend('suppressed')
      return { ok: true, queued: false }
    }

    await logSend('sent')
    return { ok: true, queued: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await logSend('failed', message)
    return { ok: false, error: message }
  }
}
