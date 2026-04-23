// app/api/_lib/conversions/types.ts
//
// Shared types for the server-side Conversion API library. Passed
// between providers and the conversion_log writer.

export type EventType = "purchase" | "refund"

export type Platform = "meta" | "tiktok" | "google_ads" | "ga4"

// Attribution + match-quality snapshot built from the purchases row.
// All string fields default to "" when missing so providers can assume
// presence and validate downstream.
export type PurchaseSignals = {
  purchase_id: string              // purchases.id (UUID) — conversion_log FK
  email: string                    // raw; providers SHA-256-lower as needed
  payment_intent_id: string        // dedup event_id across every platform
  amount_cents: number
  currency: string                 // "usd"

  // Attribution
  utm_source: string
  utm_medium: string
  utm_campaign: string
  utm_content: string
  utm_term: string
  landing_page: string
  referrer: string

  // Click IDs (URL params from ad click-through)
  fbclid: string
  ttclid: string
  gclid: string

  // First-party pixel cookies (empty until Meta/TikTok pixels installed
  // on Framer; meta.ts synthesizes fbc from fbclid when fbc is empty)
  fbp: string
  fbc: string
  ttp: string

  // Request context captured at checkout-session-create time
  client_ip: string
  client_user_agent: string
}

export type ConversionResult =
  | { status: "success"; http_status: number; response: unknown }
  | { status: "skipped"; reason: string }
  | { status: "error"; http_status?: number; error: string; response?: unknown }

export type ConversionProvider = {
  readonly name: Platform
  sendPurchase(signals: PurchaseSignals): Promise<ConversionResult>
  sendRefund(signals: PurchaseSignals): Promise<ConversionResult>
}
