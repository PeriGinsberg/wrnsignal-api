// app/api/coach/workbook-templates/route.ts
// The session templates a coach can start a workbook from. They live in the
// repo (lib/workbook/templates.ts), so this is a read of code, not of data:
// there is one library, the same for every coach, and nothing to scope. The
// only gate is that the caller is a coach.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { workbookError } from "../../_lib/workbookError"
import { ForbiddenError, resolveActor } from "@/lib/collab/scope"
import { listTemplates } from "@/lib/workbook/templates"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest) {
  try {
    const actor = await resolveActor(req)
    if (!actor.isCoach) throw new ForbiddenError("Forbidden")
    return withCorsJson(req, { ok: true, templates: listTemplates() }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
