// app/api/me/workbooks/[workbookId]/answers/[fieldKey]/route.ts
// PUT { value, expected_updated_at } — autosave for one field.
//
// Clash check, no realtime (spec): the page sends the updated_at it last saw
// (null if it never saw a saved value). The write only lands if the row still
// carries that updated_at; otherwise 409 with the current value, so a second
// tab or device never silently overwrites the first. updated_at is set by
// trigger, so the comparison is against the database's clock.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../../_lib/cors"
import { workbookError } from "../../../../../_lib/workbookError"
import { must } from "../../../../../_lib/must"
import { ConflictError, clientWorkbookScope, rpcError } from "@/lib/workbook/server"
import { isWritableKey, validateAnswerValue, type WorkbookContent } from "@/lib/workbook/content"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type P = { params: Promise<{ workbookId: string; fieldKey: string }> }

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function PUT(req: NextRequest, { params }: P) {
  try {
    const { workbookId, fieldKey: rawKey } = await params
    const fieldKey = decodeURIComponent(rawKey)
    const { supabase, actorId } = await clientWorkbookScope(req)
    const b = await req.json().catch(() => ({}))

    const { data: wb, error } = await supabase.rpc("workbook_for_client", { p_workbook: workbookId })
    if (error) throw rpcError("read workbook", error)
    if (!wb) return withCorsJson(req, { ok: false, error: "Workbook not found" }, 404)
    const content = (wb as { content: WorkbookContent }).content

    if (!isWritableKey(content, fieldKey)) return withCorsJson(req, { ok: false, error: "Unknown field" }, 400)
    const bad = validateAnswerValue(content, fieldKey, b.value)
    if (bad) return withCorsJson(req, { ok: false, error: bad }, 400)

    const expected: string | null = typeof b.expected_updated_at === "string" ? b.expected_updated_at : null
    const cols = "field_key, value, updated_at"

    const current = async () =>
      must(
        await supabase.from("workbook_answers").select(cols)
          .eq("workbook_id", workbookId).eq("field_key", fieldKey).maybeSingle(),
        "read answer",
      )

    if (expected === null) {
      const ins = await supabase.from("workbook_answers").insert({
        workbook_id: workbookId,
        field_key: fieldKey,
        value: b.value,
        updated_by_role: "client",
        updated_by_id: actorId,
      }).select(cols).single()
      if (ins.error?.code === "23505") throw new ConflictError("This answer was changed somewhere else", await current())
      return withCorsJson(req, { ok: true, answer: must(ins, "save answer") }, 200)
    }

    const rows = must(
      await supabase.from("workbook_answers")
        .update({ value: b.value, updated_by_role: "client", updated_by_id: actorId })
        .eq("workbook_id", workbookId).eq("field_key", fieldKey).eq("updated_at", expected)
        .select(cols),
      "save answer",
    ) ?? []
    if (!rows.length) throw new ConflictError("This answer was changed somewhere else", await current())
    return withCorsJson(req, { ok: true, answer: rows[0] }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
