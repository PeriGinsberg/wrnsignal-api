// app/api/public/consult-booking/route.ts
//
// POST — the public consult booking form (app/consult). No login.
//
// What it does, in order:
//   1. Spam checks (below). A bot that fills the hidden field is answered as
//      if it succeeded, so it learns nothing, and nothing is saved.
//   2. Files the submission under the student in the intake coach's practice
//      (submitBookingForm, lib/prospects/bookingForm.ts).
//   3. Sends a Meta "Lead" server-side through the existing conversions
//      fan-out, with an event_id the page also passes to the browser pixel,
//      so Meta counts the two as one lead.
//   4. Answers with the Calendly link (name and email prefilled) and the
//      event_id.
//
// SPAM PROTECTION, chosen over Turnstile because it needs no third-party keys:
//   - honeypot: a field real people never see or fill;
//   - too fast: a form submitted under 2.5s after it rendered is a script;
//   - rate limits: 5 per 10 minutes per IP, 3 per hour per email. In-memory,
//     so best-effort across instances, like the trial endpoint's limit.

import { type NextRequest } from "next/server"
import { randomUUID } from "node:crypto"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin } from "../../_lib/coachAuth"
import { fireFunnelEvent } from "../../_lib/conversions"
import { calendlyRedirect, consultCalendlyUrl, parseBookingForm, submitBookingForm } from "@/lib/prospects/bookingForm"
import { isHoneypotHit, isTooFast, underLimit } from "@/lib/prospects/bookingSpam"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 20

const ipHits = new Map<string, number[]>()
const emailHits = new Map<string, number[]>()

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for")
  return (xff ? xff.split(",")[0]?.trim() : "") || req.headers.get("x-real-ip") || ""
}

const str = (v: unknown, max = 500) => String(v ?? "").slice(0, max).trim()

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return withCorsJson(req, { ok: false, error: "Something went wrong. Please try again." }, 400)
    }

    // 1. Spam. The honeypot gets a convincing success and nothing is kept.
    if (isHoneypotHit(body)) {
      return withCorsJson(req, { ok: true, redirect: consultCalendlyUrl(), event_id: null })
    }
    if (isTooFast(body)) {
      return withCorsJson(req, { ok: false, error: "That was very quick. Please check your answers and submit again." }, 400)
    }
    const ip = clientIp(req)
    if (!underLimit(ipHits, ip, 5, 10 * 60_000)) {
      return withCorsJson(req, { ok: false, error: "Too many submissions. Please wait a few minutes and try again." }, 429)
    }

    const parsed = parseBookingForm(body)
    if (!parsed.ok) return withCorsJson(req, { ok: false, error: parsed.error }, 400)
    if (!underLimit(emailHits, parsed.value.email, 3, 60 * 60_000)) {
      return withCorsJson(req, { ok: false, error: "We already have your request. Please use the calendar link to book." }, 429)
    }

    // 2. File it.
    const r = await submitBookingForm(getSupabaseAdmin(), parsed.value)
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)

    // 3. The server half of the Meta Lead. Never throws; a provider outage
    //    must not cost the person their booking.
    //    Production only: a test on localhost or staging must never reach the
    //    ads account (the page applies the same rule to the browser pixel).
    const eventId = `consult-${randomUUID()}`
    const a = (body.attribution && typeof body.attribution === "object" ? body.attribution : {}) as Record<string, unknown>
    if (process.env.VERCEL_ENV === "production") await fireFunnelEvent({
      event_name: "Lead",
      event_id: eventId,
      event_time_sec: Math.floor(Date.now() / 1000),
      email: parsed.value.email,
      session_id: "",
      utm_source: str(a.utm_source, 100),
      utm_medium: str(a.utm_medium, 100),
      utm_campaign: str(a.utm_campaign, 200),
      utm_content: str(a.utm_content, 200),
      utm_term: str(a.utm_term, 200),
      landing_page: str(a.landing_page, 500),
      referrer: str(a.referrer, 500),
      fbclid: str(a.fbclid, 200),
      ttclid: str(a.ttclid, 200),
      gclid: str(a.gclid, 200),
      fbp: str(a.fbp, 200),
      fbc: str(a.fbc, 200),
      ttp: str(a.ttp, 200),
      client_ip: ip,
      client_user_agent: str(req.headers.get("user-agent"), 500),
      custom_data: { content_name: "Initial consult booking form" },
    }).catch((e: unknown) => console.error("[consult-booking] Lead fan-out failed:", e instanceof Error ? e.message : e))

    // 4. On to the calendar.
    return withCorsJson(req, { ok: true, redirect: calendlyRedirect(parsed.value), event_id: eventId })
  } catch (e) {
    console.error("[consult-booking]", e instanceof Error ? e.stack : e)
    return withCorsJson(req, { ok: false, error: "Something went wrong. Please try again." }, 500)
  }
}
