// app/api/coach/workbook-templates/[templateId]/route.ts
// One template, with its content, for the preview in the "Add workbook" modal.
// The placeholders are still in it: the browser fills them for the preview and
// the CREATE route fills them again from this same copy, so what the coach
// previews is never what gets stored.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { workbookError } from "../../../_lib/workbookError"
import { ForbiddenError, resolveActor } from "@/lib/collab/scope"
import { getTemplate } from "@/lib/workbook/templates"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const actor = await resolveActor(req)
    if (!actor.isCoach) throw new ForbiddenError("Forbidden")

    const { templateId } = await params
    const template = getTemplate(templateId)
    if (!template) return withCorsJson(req, { ok: false, error: "No such template" }, 404)

    return withCorsJson(req, { ok: true, template }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
