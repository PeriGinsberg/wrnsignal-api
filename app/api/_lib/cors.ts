import { NextResponse } from "next/server"

function parseAllowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

export function getCorsHeaders(origin: string | null) {
  const allowList = parseAllowedOrigins()
  const isAllowed = !!origin && allowList.includes(origin)

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "authorization,content-type,x-jobfit-key,accept",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
    "Access-Control-Max-Age": "86400",
  }

  if (isAllowed && origin) {
    headers["Access-Control-Allow-Origin"] = origin
  }

  return headers
}

export function corsOptionsResponse(origin: string | null) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(origin) })
}

export function withCorsJson(req: Request, data: any, status = 200) {
  const origin = req.headers.get("origin")
  return NextResponse.json(data, { status, headers: getCorsHeaders(origin) })
}
