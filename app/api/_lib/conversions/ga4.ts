// app/api/_lib/conversions/ga4.ts
//
// GA4 Measurement Protocol — server-side purchase / refund events.
//
// Endpoint: POST https://www.google-analytics.com/mp/collect
// Auth: api_secret query param.
//
// Per Decision 2C: client_id is a random UUID per event. Events land in
// GA4 for reporting but session attribution is broken (no linkage to the
// user's web session). Acceptable because the primary ad-optimization
// signal is Meta + TikTok + Google Ads — GA4 here is reporting only.

import type {
  ConversionProvider,
  ConversionResult,
  PurchaseSignals,
} from "./types"
import { sha256Lower } from "./hash"
import { fetchWithTimeout, safeJson } from "./http"
import { randomUUID } from "node:crypto"

async function send(
  s: PurchaseSignals,
  eventName: "purchase" | "refund"
): Promise<ConversionResult> {
  const measurementId = process.env.GA4_MEASUREMENT_ID
  const apiSecret = process.env.GA4_API_SECRET
  if (!measurementId || !apiSecret) {
    return {
      status: "skipped",
      reason: "GA4_MEASUREMENT_ID or GA4_API_SECRET not set",
    }
  }

  const valueFloat = s.amount_cents / 100

  const body = {
    client_id: randomUUID(),
    user_data: { sha256_email_address: [sha256Lower(s.email)] },
    events: [
      {
        name: eventName,
        params: {
          transaction_id: s.payment_intent_id,
          value: valueFloat,
          currency: s.currency.toUpperCase(),
          items: [
            {
              item_id: "signal_full_access",
              item_name: "SIGNAL Full Access",
              price: valueFloat,
              quantity: 1,
            },
          ],
          source: s.utm_source || undefined,
          medium: s.utm_medium || undefined,
          campaign: s.utm_campaign || undefined,
        },
      },
    ],
  }

  const url =
    `https://www.google-analytics.com/mp/collect` +
    `?measurement_id=${encodeURIComponent(measurementId)}` +
    `&api_secret=${encodeURIComponent(apiSecret)}`

  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    // GA4 MP returns 204 No Content on success.
    const response = await safeJson(res)
    if (res.ok) {
      return { status: "success", http_status: res.status, response }
    }
    return {
      status: "error",
      http_status: res.status,
      error: `GA4 MP returned ${res.status}`,
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

export const ga4: ConversionProvider = {
  name: "ga4",
  sendPurchase: (s) => send(s, "purchase"),
  sendRefund: (s) => send(s, "refund"),
}
