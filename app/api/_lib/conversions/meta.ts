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

export const meta: ConversionProvider = {
  name: "meta",
  sendPurchase: (s) => send(s, "Purchase"),
  sendRefund: (s) => send(s, "Refund"),
}
