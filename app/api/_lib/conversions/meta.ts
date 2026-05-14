// app/api/_lib/conversions/meta.ts
//
// Meta Conversions API (CAPI) — server-side Purchase / Refund events.
//
// Endpoint: POST https://graph.facebook.com/<version>/<pixel_id>/events
// Auth: access_token query param.
//
// Meta's Web CAPI has no standard Refund event, so this module sends a
// custom event named "Refund". Erin must create this custom event in
// Meta Events Manager before real refunds happen — otherwise events
// land in the API but don't appear in reporting.

import type {
  ConversionProvider,
  ConversionResult,
  FunnelEventSignals,
  PurchaseSignals,
} from "./types"
import { resolveFbc, sha256Lower } from "./hash"
import { fetchWithTimeout, safeJson } from "./http"

const API_VERSION = "v19.0"

function eventSourceUrl(s: PurchaseSignals): string {
  return (
    s.landing_page ||
    s.referrer ||
    "https://wrnsignal.workforcereadynow.com"
  )
}

async function send(
  s: PurchaseSignals,
  eventName: "Purchase" | "Refund"
): Promise<ConversionResult> {
  const pixelId = process.env.META_PIXEL_ID
  const token = process.env.META_CAPI_ACCESS_TOKEN
  if (!pixelId || !token) {
    return {
      status: "skipped",
      reason: "META_PIXEL_ID or META_CAPI_ACCESS_TOKEN not set",
    }
  }

  const eventTimeSec = Math.floor(Date.now() / 1000)

  const body = {
    data: [
      {
        event_name: eventName,
        event_id: s.payment_intent_id,
        event_time: eventTimeSec,
        event_source_url: eventSourceUrl(s),
        action_source: "website",
        user_data: {
          em: [sha256Lower(s.email)],
          fbp: s.fbp || "",
          fbc: resolveFbc(s.fbc, s.fbclid, eventTimeSec * 1000),
          client_ip_address: s.client_ip,
          client_user_agent: s.client_user_agent,
        },
        custom_data: {
          currency: s.currency.toUpperCase(),
          value: s.amount_cents / 100,
          content_ids: ["signal_full_access"],
          content_type: "product",
          utm_source: s.utm_source,
          utm_medium: s.utm_medium,
          utm_campaign: s.utm_campaign,
          utm_content: s.utm_content,
          utm_term: s.utm_term,
        },
      },
    ],
  }

  const url =
    `https://graph.facebook.com/${API_VERSION}/` +
    `${encodeURIComponent(pixelId)}/events` +
    `?access_token=${encodeURIComponent(token)}`

  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const response = await safeJson(res)

    if (res.ok) {
      return { status: "success", http_status: res.status, response }
    }
    return {
      status: "error",
      http_status: res.status,
      error: `Meta CAPI returned ${res.status}`,
      response,
    }
  } catch (err: any) {
    return {
      status: "error",
      error:
        err?.name === "AbortError"
          ? "timeout"
          : err?.message ?? String(err),
    }
  }
}

// Server-side mirror of the browser-fired pixel events (Lead, ViewContent,
// AddToCart, InitiateCheckout). event_id from the client is reused here so
// Meta's dedup window (7 days on event_name+event_id) drops the duplicate
// browser fire when the CAPI version arrives — keeping the higher-quality
// CAPI event (hashed email + IP + UA from the server).
async function sendFunnelEvent(
  s: FunnelEventSignals
): Promise<ConversionResult> {
  const pixelId = process.env.META_PIXEL_ID
  const token = process.env.META_CAPI_ACCESS_TOKEN
  if (!pixelId || !token) {
    return {
      status: "skipped",
      reason: "META_PIXEL_ID or META_CAPI_ACCESS_TOKEN not set",
    }
  }

  // Only hash an email if one was actually provided. Hashing an empty
  // string would land a deterministic fake hash in Meta's user_data and
  // pollute the audience match.
  const emailHashed = s.email ? [sha256Lower(s.email)] : undefined

  const user_data: Record<string, unknown> = {
    fbp: s.fbp || "",
    fbc: resolveFbc(s.fbc, s.fbclid, s.event_time_sec * 1000),
    client_ip_address: s.client_ip,
    client_user_agent: s.client_user_agent,
  }
  if (emailHashed) user_data.em = emailHashed

  // Standard Meta event custom_data only includes value/currency when
  // they're set (AddToCart / InitiateCheckout). Lead and ViewContent
  // omit them so the event doesn't look like a $0 attempted conversion.
  const custom_data: Record<string, unknown> = {
    utm_source: s.utm_source,
    utm_medium: s.utm_medium,
    utm_campaign: s.utm_campaign,
    utm_content: s.utm_content,
    utm_term: s.utm_term,
  }
  if (typeof s.custom_data.value === "number") {
    custom_data.value = s.custom_data.value
  }
  if (s.custom_data.currency) {
    custom_data.currency = s.custom_data.currency.toUpperCase()
  }
  if (s.custom_data.content_name) {
    custom_data.content_name = s.custom_data.content_name
  }
  if (s.custom_data.content_category) {
    custom_data.content_category = s.custom_data.content_category
  }
  if (s.custom_data.verdict) custom_data.verdict = s.custom_data.verdict
  if (typeof s.custom_data.score === "number") {
    custom_data.score = s.custom_data.score
  }
  if (s.custom_data.cta_source) {
    custom_data.cta_source = s.custom_data.cta_source
  }

  // Optional: when META_TEST_EVENT_CODE is set in the environment, the
  // CAPI call is sent to the Events Manager → Test Events tab instead of
  // the live Events table. Match the browser Pixel Helper's test event
  // code for a given test session so both halves land in the same Test
  // Events view with "Deduplicated" status. Unset on prod.
  const testEventCode = process.env.META_TEST_EVENT_CODE
  const body: Record<string, unknown> = {
    data: [
      {
        event_name: s.event_name,
        event_id: s.event_id,
        event_time: s.event_time_sec,
        event_source_url: s.landing_page || s.referrer || "https://wrnsignal.workforcereadynow.com",
        action_source: "website",
        user_data,
        custom_data,
      },
    ],
  }
  if (testEventCode) body.test_event_code = testEventCode

  const url =
    `https://graph.facebook.com/${API_VERSION}/` +
    `${encodeURIComponent(pixelId)}/events` +
    `?access_token=${encodeURIComponent(token)}`

  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const response = await safeJson(res)
    if (res.ok) {
      return { status: "success", http_status: res.status, response }
    }
    return {
      status: "error",
      http_status: res.status,
      error: `Meta CAPI returned ${res.status}`,
      response,
    }
  } catch (err: any) {
    return {
      status: "error",
      error:
        err?.name === "AbortError"
          ? "timeout"
          : err?.message ?? String(err),
    }
  }
}

export const meta: ConversionProvider = {
  name: "meta",
  sendPurchase: (s) => send(s, "Purchase"),
  sendRefund: (s) => send(s, "Refund"),
  sendFunnelEvent,
}
