type CorsConfig = {
  allowOrigins?: string[]
  allowMethods?: string[]
  allowHeaders?: string[]
  maxAgeSeconds?: number
}

const DEFAULT_ALLOW_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
const DEFAULT_ALLOW_HEADERS = ["authorization", "content-type"]
const DEFAULT_MAX_AGE = 86400

function normalizeOrigin(origin: string) {
  return origin.trim().toLowerCase()
}

function isAllowedOrigin(origin: string, allowOrigins?: string[]) {
  if (!origin) return false
  if (!allowOrigins || allowOrigins.length === 0) {
    return origin.startsWith("https://") || origin.startsWith("http://localhost")
  }
  const o = normalizeOrigin(origin)
  return allowOrigins.map(normalizeOrigin).includes(o)
}

function buildCorsHeaders(origin: string | null, cfg?: CorsConfig) {
  const allowMethods = (cfg?.allowMethods?.length ? cfg.allowMethods : DEFAULT_ALLOW_METHODS).join(", ")
  const allowHeaders = (cfg?.allowHeaders?.length ? cfg.allowHeaders : DEFAULT_ALLOW_HEADERS).join(", ")
  const maxAge = String(cfg?.maxAgeSeconds ?? DEFAULT_MAX_AGE)

  const headers = new Headers()

  // Bearer token auth (no cookies), so do NOT set Allow-Credentials.
  if (origin && isAllowedOrigin(origin, cfg?.allowOrigins)) {
    headers.set("Access-Control-Allow-Origin", origin)
    headers.set("Vary", "Origin")
  }

  headers.set("Access-Control-Allow-Methods", allowMethods)
  headers.set("Access-Control-Allow-Headers", allowHeaders)
  headers.set("Access-Control-Max-Age", maxAge)
  headers.set("Access-Control-Expose-Headers", "content-type")

  return headers
}

export function corsOptionsResponse(origin: string | null, cfg?: CorsConfig) {
  const headers = buildCorsHeaders(origin, cfg)
  return new Response(null, { status: 204, headers })
}

export function withCorsJson(req: Request, data: any, status = 200, cfg?: CorsConfig) {
  const origin = req.headers.get("origin")
  const headers = buildCorsHeaders(origin, cfg)
  headers.set("Content-Type", "application/json; charset=utf-8")
  return new Response(JSON.stringify(data), { status, headers })
}

