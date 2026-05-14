// app/api/_lib/conversions/types.ts
//
// Shared types for the server-side Conversion API library. Passed
// between providers and the conversion_log writer.

// Purchase / refund flow through the Stripe webhook. Funnel event names
// (lead/view_content/add_to_cart/initiate_checkout) flow through
// /api/conversions/event. Same conversion_log table, different ingress.
export type EventType =
  | "purchase"
  | "refund"
  | "lead"
  | "view_content"
  | "add_to_cart"
  | "initiate_checkout"

export type Platform = "meta" | "tiktok" | "google_ads" | "ga4"

// Meta-standard event names that funnel events map to client-side and
// server-side. These are what we pass to fbq() and to Meta CAPI. Other
// providers map these to their own taxonomies inside sendFunnelEvent.
export type FunnelEventName =
  | "Lead"
  | "ViewContent"
  | "AddToCart"
  | "InitiateCheckout"

// EventType (snake_case, for the DB) ↔ FunnelEventName (PascalCase, for
// Meta) round-trip helpers.
export function funnelNameToEventType(n: FunnelEventName): EventType {
  switch (n) {
    case "Lead":
      return "lead"
    case "ViewContent":
      return "view_content"
    case "AddToCart":
      return "add_to_cart"
    case "InitiateCheckout":
      return "initiate_checkout"
  }
}

// Optional custom data fields attached to funnel events. value/currency
// only meaningful on AddToCart / InitiateCheckout. verdict/score only on
// post-scan events (ViewContent, AddToCart, InitiateCheckout).
export type FunnelCustomData = {
  value?: number
  currency?: string
  verdict?: string
  score?: number | null
  cta_source?: string
  content_name?: string
  content_category?: string
}

// Payload passed to providers' sendFunnelEvent. event_id is generated
// client-side as crypto.randomUUID() and is the dedup key — the SAME id
// rides the browser pixel call and this server-side call.
//
// email may be empty for pre-checkout events (Lead/ViewContent/AddToCart
// before the user reaches the upgrade page) — providers should skip
// hashed-email user_data when email is empty rather than send an empty
// hash. fbp/fbc/ttp/click IDs improve match quality when present.
export type FunnelEventSignals = {
  event_name: FunnelEventName
  event_id: string
  event_time_sec: number

  email: string // "" allowed
  session_id: string // jobfit_session_id from client localStorage

  // Attribution snapshot (UTMs + click IDs + cookies)
  utm_source: string
  utm_medium: string
  utm_campaign: string
  utm_content: string
  utm_term: string
  landing_page: string
  referrer: string
  fbclid: string
  ttclid: string
  gclid: string
  fbp: string
  fbc: string
  ttp: string

  // Request context (extracted server-side from the endpoint request)
  client_ip: string
  client_user_agent: string

  custom_data: FunnelCustomData
}

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
  sendFunnelEvent(signals: FunnelEventSignals): Promise<ConversionResult>
}
