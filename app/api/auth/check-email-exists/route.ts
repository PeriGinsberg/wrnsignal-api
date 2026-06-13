// app/api/auth/check-email-exists/route.ts
//
// Anonymous duplicate-email check for the mobile buy flow (IAP Unit 6).
// Lets the app detect an existing account BEFORE the user reaches Apple's
// payment sheet — avoiding the worst IAP trap (paying for an account that
// already exists). Mirrors jobfit-run-trial-open's anonymous/rate-limit/CORS
// conventions and the coach create-client duplicate query.

import { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── Soft per-IP rate limit (in-memory, best-effort) — mirrors
//    jobfit-run-trial-open. Per warm instance; not hard enforcement. ──
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_PER_WINDOW = 10
const ipHits = new Map<string, number[]>()

function checkRateLimit(ip: string): { ok: true } | { ok: false; retryAfterSec: number } {
  if (!ip) return { ok: true } // No IP header → can't enforce; allow.
  const now = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const prior = (ipHits.get(ip) ?? []).filter((t) => t > cutoff)
  if (prior.length >= RATE_LIMIT_MAX_PER_WINDOW) {
    const oldest = prior[0]!
    const retryAfterSec = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000))
    return { ok: false, retryAfterSec }
  }
  prior.push(now)
  ipHits.set(ip, prior)
  if (ipHits.size > 1000) {
    for (const [k, v] of ipHits) {
      const fresh = v.filter((t) => t > cutoff)
      if (fresh.length === 0) ipHits.delete(k)
      else ipHits.set(k, fresh)
    }
  }
  return { ok: true }
}

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }
  return req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || ""
}

function getSupabase() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    // ── Rate limit ───────────────────────────────────────────────────
    const ip = getClientIp(req)
    const limit = checkRateLimit(ip)
    if (!limit.ok) {
      return withCorsJson(
        req,
        { ok: false, error: "rate_limited", retry_after_sec: limit.retryAfterSec },
        429
      )
    }

    // ── Parse + validate email ───────────────────────────────────────
    let body: any
    try {
      body = await req.json()
    } catch {
      return withCorsJson(req, { ok: false, error: "invalid_email" }, 400)
    }
    const email = String(body?.email || "").trim().toLowerCase()
    if (!email || !EMAIL_RE.test(email)) {
      return withCorsJson(req, { ok: false, error: "invalid_email" }, 400)
    }

    // ── Duplicate check (mirrors coach create-client:124-133) ────────
    const supabase = getSupabase()
    const { data: existingProfile, error } = await supabase
      .from("client_profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle()

    if (error) {
      console.error("[check-email-exists] failed:", error.message)
      return withCorsJson(req, { ok: false, error: "server_error" }, 500)
    }

    console.log("[check-email-exists] checked")
    return withCorsJson(req, { ok: true, exists: !!existingProfile }, 200)
  } catch (err: any) {
    console.error("[check-email-exists] failed:", err?.message || String(err))
    return withCorsJson(req, { ok: false, error: "server_error" }, 500)
  }
}
