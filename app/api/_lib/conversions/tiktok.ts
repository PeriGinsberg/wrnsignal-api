// app/api/_lib/conversions/tiktok.ts
//
// TikTok Events API — server-side CompletePayment / Refund events.
//
// Endpoint: POST https://business-api.tiktok.com/open_api/v1.3/event/track/
// Auth: Access-Token header (NOT a Bearer token).
//
// TikTok supports "Refund" as a standard event; no custom-event setup
// required in the TikTok Events Manager.

import type {
  ConversionProvider,
  ConversionResult,
  PurchaseSignals,
} from "./types"
import { sha256Lower } from "./hash"
import { fetchWithTimeout, safeJson } from "./http"

async function send(
  s: PurchaseSignals,
  event: "CompletePayment" | "Refund"
): Promise<ConversionResult> {
  const pixelCode = process.env.TIKTOK_PIXEL_ID
  const token = process.env.TIKTOK_EVENTS_API_TOKEN
  if (!pixelCode || !token) {
    return {
      status: "skipped",
      reason: "TIKTOK_PIXEL_ID or TIKTOK_EVENTS_API_TOKEN not set",
    }
  }

  const eventTimeSec = Math.floor(Date.now() / 1000)
  const valueFloat = s.amount_cents / 100

  const body = {
    event_source: "web",
    event_source_id: pixelCode,
    data: [
      {
        event,
        event_time: eventTimeSec,
        event_id: s.payment_intent_id,
        user: {
          email: sha256Lower(s.email),
          ttp: s.ttp || "",
          ttclid: s.ttclid || "",
          ip: s.client_ip,
          user_agent: s.client_user_agent,
        },
        properties: {
          currency: s.currency.toUpperCase(),
          value: valueFloat,
          contents: [
            {
              content_id: "signal_full_access",
              content_name: "SIGNAL Full Access",
              quantity: 1,
              price: valueFloat,
            },
          ],
        },
        page: {
          url: s.landing_page || s.referrer || "",
          referrer: s.referrer || "",
        },
      },
    ],
  }

  try {
    const res = await fetchWithTimeout(
      "https://business-api.tiktok.com/open_api/v1.3/event/track/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Access-Token": token,
        },
        body: JSON.stringify(body),
      }
    )
    const response = await safeJson(res)

    if (res.ok) {
      return { status: "success", http_status: res.status, response }
    }
    return {
      status: "error",
      http_status: res.status,
      error: `TikTok Events API returned ${res.status}`,
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

export const tiktok: ConversionProvider = {
  name: "tiktok",
  sendPurchase: (s) => send(s, "CompletePayment"),
  sendRefund: (s) => send(s, "Refund"),
}
