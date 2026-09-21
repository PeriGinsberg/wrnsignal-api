// app/api/me/workbooks/[workbookId]/questions/route.ts
// POST a question DRAFT: "Ask your coach" on a section or field, the general
// question box (section_id '_general'), or a reply to a coach item (parent_id,
// stored as a threaded client_question). Released on "Send to your coach".

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { workbookError } from "../../../../_lib/workbookError"
import { must } from "../../../../_lib/must"
import { COMMENT_COLUMNS, clientWorkbookScope, rpcError } from "@/lib/workbook/server"
import { anchorError, type WorkbookContent } from "@/lib/workbook/content"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest, { params }: { params: Promise<{ workbookId: string }> }) {
  try {
    const { workbookId } = await params
    const { supabase, actorId } = await clientWorkbookScope(req)
    const b = await req.json().catch(() => ({}))

    const body = typeof b.body === "string" ? b.body.trim() : ""
    if (!body) return withCorsJson(req, { ok: false, error: "Write your question first" }, 400)

    const { data: wb, error } = await supabase.rpc("workbook_for_client", { p_workbook: workbookId })
    if (error) throw rpcError("read workbook", error)
    if (!wb) return withCorsJson(req, { ok: false, error: "Workbook not found" }, 404)

    let sectionId = b.section_id
    let fieldKey = b.field_key ?? null
    let parentId: string | null = null

    if (b.parent_id) {
      // A reply sits under a coach item the client can see (released), same anchor.
      const parent = must(
        await supabase.from("workbook_comments").select("id, section_id, field_key, author_role, released_at")
          .eq("id", b.parent_id).eq("workbook_id", workbookId).maybeSingle(),
        "read the comment you are replying to",
      ) as any
      if (!parent || parent.author_role !== "coach" || !parent.released_at) {
        return withCorsJson(req, { ok: false, error: "You can only reply to a note from your coach" }, 400)
      }
      parentId = parent.id
      sectionId = parent.section_id
      fieldKey = parent.field_key
    } else {
      const bad = anchorError((wb as { content: WorkbookContent }).content, sectionId, fieldKey)
      if (bad) return withCorsJson(req, { ok: false, error: bad }, 400)
    }

    const row = must(
      await supabase.from("workbook_comments").insert({
        workbook_id: workbookId,
        section_id: sectionId,
        field_key: fieldKey,
        kind: "client_question",
        parent_id: parentId,
        body,
        author_role: "client",
        author_id: actorId,
      }).select(COMMENT_COLUMNS).single(),
      "save question",
    )
    return withCorsJson(req, { ok: true, comment: row }, 201)
  } catch (err) {
    return workbookError(req, err)
  }
}
