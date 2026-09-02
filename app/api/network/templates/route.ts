// app/api/network/templates/route.ts
// GET — all 24 templates, each marked default-or-override.
//
// The 24 bodies live in code (lib/network-tracker/template-defaults.ts); this
// table holds a row only when someone edits one. A client with no overrides
// still gets 24 templates back — the merge is what makes that true, not a seed.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { routeError } from "../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveRequestScope } from "@/lib/collab/scope"
import { mergeTemplates, type TemplateOverrideRow } from "@/lib/network-tracker/templates"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    // Actor, subject and authorisation in one call. The `|| profileId` default
    // and the "view" level are unchanged; they moved inside resolveRequestScope.
    const scope = await resolveRequestScope(req, supabase, { require: "read" })

    const { data, error } = await supabase
      .from("network_templates")
      .select("template_id, body, edited_by, updated_at")
      .eq("client_profile_id", scope.subjectId)
    if (error) throw new Error(`Template lookup failed: ${error.message}`)

    const templates = mergeTemplates((data ?? []) as TemplateOverrideRow[])
    return withCorsJson(req, {
      ok: true,
      templates,
      overridden: templates.filter((t) => t.source === "override").length,
    }, 200)
  } catch (err: any) {
    return routeError(req, err)
  }
}
