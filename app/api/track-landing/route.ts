import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse } from "../_lib/cors"

export const runtime = "nodejs"

// sendBeacon issues *credentialed* cross-origin requests, so the preflight and
// the responses must carry Access-Control-Allow-Credentials: true alongside the
// echoed (non-wildcard) origin, or the browser rejects the preflight. The
// shared corsOptionsResponse already echoes the allowlisted origin; this adds
// the credentials header on top. Scoped to this route only — cors.ts and
// /api/track are intentionally left unchanged.
function corsCreds(req: Request): Response {
  const base = corsOptionsResponse(req.headers.get("origin"))
  const headers = new Headers(base.headers)
  headers.set("Access-Control-Allow-Credentials", "true")
  return new Response(null, { status: 204, headers })
}

export async function OPTIONS(req: Request) {
  return corsCreds(req)
}

// Replicated from app/api/track/route.ts so the landing logger filters bots
// consistently with the page-view route. Kept local (Next route modules
// aren't meant to be imported across routes).
const BOT_UA_PATTERNS = [
  "bot", "crawler", "spider", "crawl", "scraper", "fetcher",
  "headless", "phantom", "puppeteer", "playwright", "selenium",
  "googlebot", "bingbot", "yandex", "baidu", "duckduckbot",
  "facebookexternalhit", "facebot", "linkedinbot", "twitterbot",
  "slackbot", "telegrambot", "discordbot", "whatsapp",
  "preview", "lighthouse", "pingdom", "uptimerobot", "monitor",
  "ahrefs", "semrush", "mj12bot", "dotbot", "sitebulb",
  "curl", "wget", "python-requests", "okhttp", "java/", "go-http-client",
]

function looksLikeBot(req: Request): boolean {
  const ua = (req.headers.get("user-agent") || "").toLowerCase()
  if (!ua) return true // missing UA = bot
  for (const p of BOT_UA_PATTERNS) {
    if (ua.includes(p)) return true
  }
  return false
}

// Fire-and-forget landing-page hit logger for the /signal marketing page.
// Anonymous, no PII, server-write only via the service role. ALWAYS returns
// 204 fast — a logging failure (or a bot) must never block or error the page.
export async function POST(req: Request) {
  try {
    // Bot filter before any insert — landing pages attract crawlers and
    // link-unfurlers that would inflate the count. 204, no insert.
    if (looksLikeBot(req)) {
      return corsCreds(req)
    }

    // Tolerant parse: handles application/json (fetch fallback) and
    // text/plain (legacy beacon) bodies — req.text() + JSON.parse ignores
    // the Content-Type header.
    const raw = await req.text()
    const body = raw ? JSON.parse(raw) : {}
    const clamp = (v: unknown, n: number) => (v ? String(v).slice(0, n) : null)

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    await supabase.from("landing_page_hits").insert({
      session_id: clamp(body.session_id, 200),
      utm_source: clamp(body.utm_source, 100),
      utm_medium: clamp(body.utm_medium, 100),
      utm_campaign: clamp(body.utm_campaign, 100),
      referrer: clamp(body.referrer, 500),
      path: clamp(body.path, 200),
      user_agent: clamp(req.headers.get("user-agent"), 500),
    })
  } catch {
    // Swallow — logging must never surface an error to the page.
  }
  // 204, null body, CORS headers — fast ack for sendBeacon / keepalive fetch.
  return corsCreds(req)
}
