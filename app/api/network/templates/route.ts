// app/api/network/templates/route.ts
// GET — all 24 templates, each marked default-or-override.
//
// The 24 bodies live in code (lib/network-tracker/template-defaults.ts); this
// table holds a row only when someone edits one. A client with no overrides
// still gets 24 templates back — the merge is what makes that true, not a seed.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { assertBoardAccess } from "@/lib/network-tracker/access"
import { mergeTemplates, type TemplateOverrideRow } from "@/lib/network-tracker/templates"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()
    const target = new URL(req.url).searchParams.get("client_profile_id") || profileId

    const acc = await assertBoardAccess(supabase, profileId, target, "view")
    if (!acc) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)

    const { data, error } = await supabase
      .from("network_templates")
      .select("template_id, body, edited_by, updated_at")
      .eq("client_profile_id", target)
    if (error) throw new Error(`Template lookup failed: ${error.message}`)

    const templates = mergeTemplates((data ?? []) as TemplateOverrideRow[])
    return withCorsJson(req, {
      ok: true,
      templates,
      overridden: templates.filter((t) => t.source === "override").length,
    }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
