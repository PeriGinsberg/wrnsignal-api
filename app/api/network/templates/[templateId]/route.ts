// app/api/network/templates/[templateId]/route.ts
// PATCH  — upsert an override for one template.
// DELETE — remove the override, which IS the revert: with no row, GET falls back
//          to the code default. There is no copy-the-default-back operation.
//
// COACH-WRITABLE. Gates on assertBoardAccess(..., "full"), the same deliberate
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
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { assertBoardAccess } from "@/lib/network-tracker/access"
import { isKnownTemplateId, DEFAULTS_BY_ID } from "@/lib/network-tracker/templates"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()

    if (!isKnownTemplateId(templateId))
      return withCorsJson(req, { ok: false, error: `Unknown template ${templateId}` }, 404)

    const body = await req.json().catch(() => null)
    const target = String(body?.client_profile_id || "") || profileId
    const acc = await assertBoardAccess(supabase, profileId, target, "full")
    if (!acc) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)

    const text = typeof body?.body === "string" ? body.body : null
    if (!text || !text.trim())
      return withCorsJson(req, { ok: false, error: "Template body cannot be empty." }, 400)

    // Saving the default back verbatim is a REVERT, not an override — otherwise
    // a client who edits and undoes is left permanently marked as customised and
    // stops receiving future wording improvements to that template.
    if (text.trim() === DEFAULTS_BY_ID[templateId].body.trim()) {
      await supabase.from("network_templates").delete()
        .eq("client_profile_id", target).eq("template_id", templateId)
      return withCorsJson(req, { ok: true, template_id: templateId, source: "default", reverted: true }, 200)
    }

    const { data: saved, error } = await supabase
      .from("network_templates")
      .upsert({
        client_profile_id: target,
        template_id: templateId,
        body: text,
        edited_by: acc.actingRole,
        edited_by_id: profileId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "client_profile_id,template_id" })
      .select("template_id, body, edited_by, updated_at").single()
    if (error) throw new Error(`Save failed: ${error.message}`)

    return withCorsJson(req, { ok: true, template: { ...saved, source: "override" } }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()

    if (!isKnownTemplateId(templateId))
      return withCorsJson(req, { ok: false, error: `Unknown template ${templateId}` }, 404)

    const target = new URL(req.url).searchParams.get("client_profile_id") || profileId
    const acc = await assertBoardAccess(supabase, profileId, target, "full")
    if (!acc) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)

    const { error } = await supabase.from("network_templates").delete()
      .eq("client_profile_id", target).eq("template_id", templateId)
    if (error) throw new Error(`Revert failed: ${error.message}`)

    // Idempotent: reverting an already-default template is a no-op, not a 404.
    return withCorsJson(req, { ok: true, template_id: templateId, source: "default" }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
