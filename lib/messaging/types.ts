// lib/messaging/types.ts
//
// The send layer's one seam. A provider carries an email that SIGNAL has
// already written, addressed and decided to send; it decides nothing.
//
// Postmark is the only provider today. Outlook (Microsoft Graph) or Gmail per
// coach would each be another MessageProvider, picked by
// coach_messaging_settings.provider (./providers.ts). Everything else in
// sendCoachMessage stays as it is.

export const PROVIDERS = ["postmark"] as const
export type ProviderName = (typeof PROVIDERS)[number]

export type OutboundEmail = {
  from: string
  replyTo: string
  to: string
  cc: string | null
  bcc: string[]
  subject: string
  html: string
  text: string
  /** A short label for the provider's own reporting. */
  tag: string
}

export type ProviderSendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string }

export interface MessageProvider {
  name: ProviderName
  sendEmail(email: OutboundEmail): Promise<ProviderSendResult>
}
