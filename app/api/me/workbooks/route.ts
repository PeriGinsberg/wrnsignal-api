// app/api/me/workbooks/route.ts
// GET the caller's own workbooks (drafts excluded) for the Coaches Hub: the
// entry card and the "your coach sent it back" Required Actions provider.
// Through workbook_client_list(): the client has no policy on `workbooks`.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { workbookError } from "../../_lib/workbookError"
import { clientWorkbookScope, rpcError } from "@/lib/workbook/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest) {
  try {
    const { supabase } = await clientWorkbookScope(req)
    const { data, error } = await supabase.rpc("workbook_client_list")
    if (error) throw rpcError("list workbooks", error)
    return withCorsJson(req, { ok: true, workbooks: data ?? [] }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}
