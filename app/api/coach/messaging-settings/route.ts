// app/api/coach/messaging-settings/route.ts
//
// The signed-in coach's messaging settings (My Settings > Messaging).
//
//   GET  { sending_email, signature }
//   PUT  { signature } saves the signature. The sending address is not
//        accepted here: Peri sets it in SQL (lib/messaging/settings.ts).
//
// Always the signed-in coach's own row, never a principal's: a delegate's
// messages carry the delegate's address and signature.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { errStatus, getSupabaseAdmin, resolveCoach } from "../../_lib/coachAuth"
import { getMessagingSettings, saveSignature } from "@/lib/messaging/settings"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

async function current(coachProfileId: string) {
  const s = await getMessagingSettings(getSupabaseAdmin(), coachProfileId)
  return { sending_email: s.sending_email, signature: s.signature }
}

export async function GET(req: NextRequest) {
  try {
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error
    return withCorsJson(req, { ok: true, settings: await current(coachProfileId) })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error
    const r = await saveSignature(getSupabaseAdmin(), coachProfileId, await req.json().catch(() => ({})))
    if (!r.ok) return withCorsJson(req, { ok: false, error: r.error }, r.status)
    return withCorsJson(req, { ok: true, settings: await current(coachProfileId) })
  } catch (e) {
    return withCorsJson(req, { ok: false, error: e instanceof Error ? e.message : String(e) }, errStatus(e))
  }
}
