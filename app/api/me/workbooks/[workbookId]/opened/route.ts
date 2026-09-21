// app/api/me/workbooks/[workbookId]/opened/route.ts
// POST — the client opened the workbook. Stamps opened_at on the unopened
// to_client sends, which clears the Coaches Hub item. Kept out of GET so a read
// has no side effect.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { workbookError } from "../../../../_lib/workbookError"
import { clientWorkbookScope, rpcError } from "@/lib/workbook/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest, { params }: { params: Promise<{ workbookId: string }> }) {
  try {
    const { workbookId } = await params
    const { supabase } = await clientWorkbookScope(req)
    const { error } = await supabase.rpc("workbook_mark_opened", { p_workbook: workbookId })
    if (error) throw rpcError("mark workbook opened", error)
    return withCorsJson(req, { ok: true }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
