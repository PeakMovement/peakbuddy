import type { ComponentType } from 'react'
import { template as clientWelcomeTemplate } from './client-welcome'
import { template as practitionerContactTemplate } from './practitioner-contact'
import { template as practitionerCheckinTemplate } from './practitioner-checkin'
import { template as practitionerAlertTemplate } from './practitioner-alert'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'client-welcome': clientWelcomeTemplate,
  'practitioner-contact': practitionerContactTemplate,
  'practitioner-checkin': practitionerCheckinTemplate,
  'practitioner-alert': practitionerAlertTemplate,
}
