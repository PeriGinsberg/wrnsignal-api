// app/api/_lib/conversions/index.ts
//
// Orchestrator: fires Meta, TikTok, Google Ads, and GA4 conversion events
// in parallel for a single purchase or refund and writes one conversion_log
// row per (purchase, platform, event_type) attempt.
//
// Never throws. Provider failures are isolated — a broken Meta endpoint
// cannot block TikTok / Google / GA4 from firing. conversion_log write
// failures are console.error'd but do not cascade (the CAPI side effect
// has already happened; a missing log row is annoying but non-blocking).

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type {
  ConversionResult,
  EventType,
  Platform,
  PurchaseSignals,
} from "./types"
import { meta } from "./meta"
import { tiktok } from "./tiktok"
import { googleAds } from "./googleAds"
import { ga4 } from "./ga4"

const PROVIDERS = [meta, tiktok, googleAds, ga4] as const

export async function fireConversions(
  signals: PurchaseSignals,
  event_type: EventType
): Promise<void> {
  await Promise.allSettled(
    PROVIDERS.map(async (p) => {
      let result: ConversionResult
      try {
        result =
          event_type === "purchase"
            ? await p.sendPurchase(signals)
            : await p.sendRefund(signals)
      } catch (err: any) {
        result = {
          status: "error",
          error: err?.message ?? String(err),
        }
      }
      await logConversion({
        signals,
        event_type,
        platform: p.name,
        result,
      })
    })
  )
}

export async function logConversion(args: {
  signals: PurchaseSignals
  event_type: EventType
  platform: Platform
  result: ConversionResult
}): Promise<void> {
  const { signals, event_type, platform, result } = args
  try {
    const supabase = getSupabaseAdmin()
    const row = {
      purchase_id: signals.purchase_id,
      event_id: signals.payment_intent_id,
      event_type,
      platform,
      status: result.status,
      http_status:
        "http_status" in result && typeof result.http_status === "number"
          ? result.http_status
          : null,
      response_payload:
        "response" in result && result.response !== undefined
          ? (result.response as object)
          : null,
      error_message:
        result.status === "error"
          ? result.error
          : result.status === "skipped"
          ? result.reason
          : null,
    }
    const { error } = await supabase.from("conversion_log").insert(row)
    if (error) {
      console.error("[conversion_log] insert failed:", error.message)
    }
  } catch (err: any) {
    console.error(
      "[conversion_log] unexpected failure:",
      err?.message ?? String(err)
    )
  }
}

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
