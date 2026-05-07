// app/api/personas/[id]/route.ts
//
// Client-self-service persona update + delete are DISABLED for the
// Cohort 1 pilot (decision 2026-05-07). Coaches manage their clients'
// personas via /api/coach/clients/[clientId]/personas/[personaId].
// Re-enable post-Cohort 1 if product decides to give clients direct
// persona control again. The default-persona resume_text mirror logic
// previously here lives in the coach PATCH route's
// syncDefaultPersonaToProfile helper.
import { type NextRequest } from "next/server"
import { corsOptionsResponse } from "../../_lib/cors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function PUT() {
  return new Response(JSON.stringify({
    ok: false,
    error: "Persona self-service is disabled during pilot — your coach manages your personas.",
  }), { status: 410, headers: { "Content-Type": "application/json" } })
}

export async function DELETE() {
  return new Response(JSON.stringify({
    ok: false,
    error: "Persona self-service is disabled during pilot — your coach manages your personas.",
  }), { status: 410, headers: { "Content-Type": "application/json" } })
}
