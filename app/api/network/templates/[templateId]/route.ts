// app/api/network/templates/[templateId]/route.ts
// PATCH  — upsert an override for one template.
// DELETE — remove the override, which IS the revert: with no row, GET falls back
//          to the code default. There is no copy-the-default-back operation.
//
// COACH-WRITABLE. Gates on resolveScope(..., require: "write"), the same deliberate
// exception as the client profile: "coaches cannot mutate" protects the PIPELINE
// (stage, actions, reminders) — the client's own record of what they did — while
// templates are outbound copy a coach is expected to help write. edited_by
// records which of them saved last.
//
// THE BODY IS STORED EXACTLY AS SENT. No trimming of brackets, no normalising,
// no validation of variable names. Fill-at-send prompts like
// [ARTICLE / NEWS ABOUT THEIR FIRM] and [OPTION 1] contain spaces and slashes,
// so any UPPER_SNAKE rule would reject the templates clients use most. The only
// check is that template_id names a real default.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { routeError } from "../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveActor, resolveRequestScope, resolveScope } from "@/lib/collab/scope"
import { isKnownTemplateId, DEFAULTS_BY_ID } from "@/lib/network-tracker/templates"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params
    const actor = await resolveActor(req)
    const supabase = getSupabaseAdmin()

    if (!isKnownTemplateId(templateId))
      return withCorsJson(req, { ok: false, error: `Unknown template ${templateId}` }, 404)

    const body = await req.json().catch(() => null)
    // Body-carried subject, so the route hands it in rather than the helper
    // reading it. Unchanged level: "full", the deliberate coach-writable case.
    const scope = await resolveScope(supabase, actor, {
      subject: String(body?.client_profile_id || ""), require: "write",
    })

    const text = typeof body?.body === "string" ? body.body : null
    if (!text || !text.trim())
      return withCorsJson(req, { ok: false, error: "Template body cannot be empty." }, 400)

    // Saving the default back verbatim is a REVERT, not an override — otherwise
    // a client who edits and undoes is left permanently marked as customised and
    // stops receiving future wording improvements to that template.
    if (text.trim() === DEFAULTS_BY_ID[templateId].body.trim()) {
      await supabase.from("network_templates").delete()
        .eq("client_profile_id", scope.subjectId).eq("template_id", templateId)
      return withCorsJson(req, { ok: true, template_id: templateId, source: "default", reverted: true }, 200)
    }

    const { data: saved, error } = await supabase
      .from("network_templates")
      .upsert({
        client_profile_id: scope.subjectId,
        template_id: templateId,
        body: text,
        // NOT scope.actorRole directly. That is "self" | "coach"; this column is
        // CHECK-constrained to ('client','coach'), which the old actingRole
        // happened to match. Mapping rather than renaming the scope vocabulary,
        // because "self" is the right word for an actor and "client" is the right
        // word for a row that a coach may also have written.
        edited_by: scope.actorRole === "coach" ? "coach" : "client",
        edited_by_id: scope.actorId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "client_profile_id,template_id" })
      .select("template_id, body, edited_by, updated_at").single()
    if (error) throw new Error(`Save failed: ${error.message}`)

    return withCorsJson(req, { ok: true, template: { ...saved, source: "override" } }, 200)
  } catch (err: any) {
    return routeError(req, err)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params
    const supabase = getSupabaseAdmin()

    if (!isKnownTemplateId(templateId))
      return withCorsJson(req, { ok: false, error: `Unknown template ${templateId}` }, 404)

    const scope = await resolveRequestScope(req, supabase, { require: "write" })

    const { error } = await supabase.from("network_templates").delete()
      .eq("client_profile_id", scope.subjectId).eq("template_id", templateId)
    if (error) throw new Error(`Revert failed: ${error.message}`)

    // Idempotent: reverting an already-default template is a no-op, not a 404.
    return withCorsJson(req, { ok: true, template_id: templateId, source: "default" }, 200)
  } catch (err: any) {
    return routeError(req, err)
  }
}
