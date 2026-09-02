// app/api/network/import/preview/route.ts
// POST a CSV/XLSX file (multipart, like /api/resume-upload) → parse it, detect
// the header row, guess the column mapping, and return samples for the preview
// wizard. Stores nothing. OWNER-ONLY (resolveCaller). The commit step re-uploads
// the file with the confirmed mapping — this route holds no state.
//
// Response: { ok, sheets, sheet, headerRow, headers, sampleRows, guessedMapping, totalRows }

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { errorStatus } from "../../../_lib/routeError"
import { resolveOwnerScope } from "@/lib/collab/scope"
import { parseFile, detectHeaderRow, dataRows, MAX_ROWS } from "@/lib/network-tracker/import-parse"
import { guessMapping } from "@/lib/network-tracker/import-fields"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest) {
  try {
    // Auth gate only: the result is deliberately discarded. Preview reads
    // nothing scoped, so it needs a caller, not a subject.
    await resolveOwnerScope(req)

    const form = await req.formData()
    const file = form.get("file") as File | null
    if (!file) return withCorsJson(req, { ok: false, error: "No file uploaded." }, 400)
    const name = file.name || "upload"
    if (!/\.(csv|xlsx)$/i.test(name))
      return withCorsJson(req, { ok: false, error: "Upload a .csv or .xlsx file." }, 400)

    const sheetParam = (form.get("sheet") as string | null) || undefined
    const buffer = Buffer.from(await file.arrayBuffer())

    // Parsing is where an odd file blows up — keep the raw error server-side and
    // return something the user can act on (never a raw JS message).
    let sheets: string[], sheet: string, grid: string[][]
    try {
      ;({ sheets, sheet, grid } = await parseFile(buffer, name, sheetParam))
    } catch (e: any) {
      console.error("[import/preview] parse failed:", e?.stack || e?.message, "file:", name)
      return withCorsJson(req, { ok: false, error: "We couldn't read this file. It may be an unusual spreadsheet format — try re-saving it as CSV or a standard .xlsx and upload again." }, 422)
    }
    if (grid.length === 0) return withCorsJson(req, { ok: false, error: "That file has no rows." }, 400)

    // Detect the header row, unless the user is overriding it (re-preview).
    const hrRaw = form.get("headerRow") as string | null
    const hrNum = hrRaw != null && hrRaw !== "" ? Number(hrRaw) : NaN
    const headerRow = Number.isInteger(hrNum) && hrNum >= 0 && hrNum < grid.length ? hrNum : detectHeaderRow(grid)
    const rows = dataRows(grid, headerRow)
    if (rows.length > MAX_ROWS)
      return withCorsJson(req, { ok: false, error: `That file has ${rows.length} rows — the import handles up to ${MAX_ROWS}. Split it and import in batches.` }, 400)

    const headers = (grid[headerRow] ?? []).map((h) => (h ?? "").toString())
    const sampleRows = rows.slice(0, 10)
    const guessedMapping = guessMapping(headers)

    return withCorsJson(req, {
      ok: true,
      sheets, sheet, headerRow, headers, sampleRows,
      guessedMapping, totalRows: rows.length,
    }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[import/preview]", err?.stack || msg)
    // Status from the shared mapper, prose from here. The import routes are the
    // two that answer in user-facing sentences rather than the raw error, so
    // they keep their own copy; what they no longer keep is their own opinion
    // about which error means which status.
    const status = errorStatus(err)
    if (status === 401) return withCorsJson(req, { ok: false, error: "Please sign in again." }, 401)
    // Unreachable while this route is owner-only, and here so that it stays
    // correct rather than 500-with-import-prose if it ever is not.
    if (status === 403) return withCorsJson(req, { ok: false, error: "You do not have access to that board." }, 403)
    if (status === 404) return withCorsJson(req, { ok: false, error: "We couldn't find your profile." }, 404)
    return withCorsJson(req, { ok: false, error: "Something went wrong reading that file. Please try again." }, 500)
  }
}
