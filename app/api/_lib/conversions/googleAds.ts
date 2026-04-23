// app/api/_lib/conversions/googleAds.ts
//
// Google Ads API — server-side conversion uploads.
//
// Flow:
//   1. Exchange OAuth refresh_token for access_token (every call — no cache;
//      stateless Lambda cannot share tokens across invocations without KV,
//      and the ~200ms overhead per purchase is acceptable).
//   2. Purchase → uploadClickConversions: tags the conversion by gclid and
//      hashed email, keyed on order_id (== Stripe payment_intent.id).
//   3. Refund  → uploadConversionAdjustments: adjustment_type=RETRACT,
//      keyed on the same order_id so Google matches it to the prior click.
//
// Operational setup is materially heavier than Meta/TikTok/GA4:
//   - GOOGLE_ADS_DEVELOPER_TOKEN requires an application through the
//     Google Ads API Center (24–48h approval, basic access is enough).
//   - GOOGLE_ADS_CLIENT_ID / CLIENT_SECRET come from a Google Cloud
//     Console OAuth client (Web application type).
//   - GOOGLE_ADS_REFRESH_TOKEN is generated via the OAuth Playground or a
//     manual one-time OAuth flow and then stored.
//   - GOOGLE_ADS_CUSTOMER_ID is the ad account's customer ID (no dashes).
//   - GOOGLE_ADS_CONVERSION_ACTION_ID is the numeric ID of the specific
//     conversion action configured in the Google Ads UI.
//   - GOOGLE_ADS_LOGIN_CUSTOMER_ID is optional — set only when the ad
//     account is under a Google Ads manager (MCC) account.

import type {
  ConversionProvider,
  ConversionResult,
  PurchaseSignals,
} from "./types"
import { sha256Lower } from "./hash"
import { fetchWithTimeout, safeJson } from "./http"

const API_VERSION = "v18"

type GoogleAdsEnv = {
  developerToken: string
  clientId: string
  clientSecret: string
  refreshToken: string
  customerId: string
  conversionActionId: string
  loginCustomerId: string // optional; "" when not set
}

function readEnv(): GoogleAdsEnv | { missing: string[] } {
  const env: GoogleAdsEnv = {
    developerToken:     process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
    clientId:           process.env.GOOGLE_ADS_CLIENT_ID ?? "",
    clientSecret:       process.env.GOOGLE_ADS_CLIENT_SECRET ?? "",
    refreshToken:       process.env.GOOGLE_ADS_REFRESH_TOKEN ?? "",
    customerId:         process.env.GOOGLE_ADS_CUSTOMER_ID ?? "",
    conversionActionId: process.env.GOOGLE_ADS_CONVERSION_ACTION_ID ?? "",
    loginCustomerId:    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? "",
  }
  const missing: string[] = []
  if (!env.developerToken)     missing.push("GOOGLE_ADS_DEVELOPER_TOKEN")
  if (!env.clientId)           missing.push("GOOGLE_ADS_CLIENT_ID")
  if (!env.clientSecret)       missing.push("GOOGLE_ADS_CLIENT_SECRET")
  if (!env.refreshToken)       missing.push("GOOGLE_ADS_REFRESH_TOKEN")
  if (!env.customerId)         missing.push("GOOGLE_ADS_CUSTOMER_ID")
  if (!env.conversionActionId) missing.push("GOOGLE_ADS_CONVERSION_ACTION_ID")
  if (missing.length > 0) return { missing }
  return env
}

async function getAccessToken(env: GoogleAdsEnv): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env.refreshToken,
    client_id: env.clientId,
    client_secret: env.clientSecret,
  })
  const res = await fetchWithTimeout(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }
  )
  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    throw new Error(`OAuth token exchange failed (${res.status}): ${txt}`)
  }
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error("OAuth response missing access_token")
  return json.access_token
}

// Google Ads expects "yyyy-MM-dd HH:mm:ss+00:00" (space separator, colon
// in the UTC offset). Java-flavored formatting — no direct Date.toISOString
// equivalent, so build it by hand.
function formatGoogleAdsTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
    `+00:00`
  )
}

function googleAdsHeaders(
  env: GoogleAdsEnv,
  accessToken: string
): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": env.developerToken,
    "Content-Type": "application/json",
  }
  if (env.loginCustomerId) h["login-customer-id"] = env.loginCustomerId
  return h
}

async function sendPurchase(s: PurchaseSignals): Promise<ConversionResult> {
  const env = readEnv()
  if ("missing" in env) {
    return {
      status: "skipped",
      reason: `Google Ads env missing: ${env.missing.join(", ")}`,
    }
  }
  try {
    const accessToken = await getAccessToken(env)
    const body = {
      conversions: [
        {
          conversion_action:
            `customers/${env.customerId}/conversionActions/` +
            env.conversionActionId,
          conversion_date_time: formatGoogleAdsTime(new Date()),
          conversion_value: s.amount_cents / 100,
          currency_code: s.currency.toUpperCase(),
          order_id: s.payment_intent_id,
          ...(s.gclid ? { gclid: s.gclid } : {}),
          user_identifiers: [{ hashed_email: sha256Lower(s.email) }],
        },
      ],
      partial_failure: true,
    }
    const url =
      `https://googleads.googleapis.com/${API_VERSION}/customers/` +
      `${env.customerId}:uploadClickConversions`
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: googleAdsHeaders(env, accessToken),
      body: JSON.stringify(body),
    })
    const response = await safeJson(res)
    if (res.ok) {
      return { status: "success", http_status: res.status, response }
    }
    return {
      status: "error",
      http_status: res.status,
      error: `Google Ads uploadClickConversions returned ${res.status}`,
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

async function sendRefund(s: PurchaseSignals): Promise<ConversionResult> {
  const env = readEnv()
  if ("missing" in env) {
    return {
      status: "skipped",
      reason: `Google Ads env missing: ${env.missing.join(", ")}`,
    }
  }
  try {
    const accessToken = await getAccessToken(env)
    const body = {
      conversion_adjustments: [
        {
          conversion_action:
            `customers/${env.customerId}/conversionActions/` +
            env.conversionActionId,
          adjustment_type: "RETRACT",
          adjustment_date_time: formatGoogleAdsTime(new Date()),
          order_id: s.payment_intent_id,
        },
      ],
      partial_failure: true,
    }
    const url =
      `https://googleads.googleapis.com/${API_VERSION}/customers/` +
      `${env.customerId}:uploadConversionAdjustments`
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: googleAdsHeaders(env, accessToken),
      body: JSON.stringify(body),
    })
    const response = await safeJson(res)
    if (res.ok) {
      return { status: "success", http_status: res.status, response }
    }
    return {
      status: "error",
      http_status: res.status,
      error: `Google Ads uploadConversionAdjustments returned ${res.status}`,
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

export const googleAds: ConversionProvider = {
  name: "google_ads",
  sendPurchase,
  sendRefund,
}
