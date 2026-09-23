// app/api/network/import/preview/route.ts
// POST a CSV/XLSX file (multipart, like /api/resume-upload) → parse it, detect
// the header row, guess the column mapping, and return samples for the preview
// wizard. Stores nothing. The commit step re-uploads the file with the confirmed
// mapping — this route holds no state.
//
// Post a `mapping` as well and it also DRY RUNS the import: every row is
// resolved against the board and comes back with a disposition, so the coach
// sees what would be created and what would be skipped before anything is
// written.
//
// NO LONGER OWNER-ONLY — this is the reversal described in
// docs/network-tracker/coach-contacts-import.md. It was owner-only precisely so
// that a coach appending ?client_profile_id= could not import onto a client's
// board; that is now the point of the route. The subject is read by
// resolveRequestScope itself and authorised against coach_clients, and
// REQUIRED.write is `full`, so `view` and `annotate` coaches are refused.
//
// Response: { ok, subject, sheets, sheet, headerRow, headers, sampleRows,
//             guessedMapping, totalRows, dryRun? }

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { errorStatus } from "../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveRequestScope } from "@/lib/collab/scope"
import { parseFile, detectHeaderRow, dataRows, MAX_ROWS } from "@/lib/network-tracker/import-parse"
import { guessMapping, type ImportField } from "@/lib/network-tracker/import-fields"
import { buildSourceRows, loadBoardState, loadSubjectName } from "@/lib/network-tracker/import-load"
import { resolveImport } from "@/lib/network-tracker/import-resolve"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 30

// The tab a client networking workbook keeps its people on. Auto-selected when
// present so the coach does not land on "Outreach Messages" and map it by hand.
const PREFERRED_SHEET = "contacts"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    // `write`, not `read`: a preview that a coach cannot act on is a trap, and
    // the dry run reads the board it is about to be allowed to write.
    const scope = await resolveRequestScope(req, supabase, { require: "write" })

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
      // Auto-select "Contacts" on the first look only; an explicit choice wins.
      if (!sheetParam) {
        const preferred = sheets.find((s) => s.trim().toLowerCase() === PREFERRED_SHEET)
        if (preferred && preferred !== sheet) {
          ;({ sheets, sheet, grid } = await parseFile(buffer, name, preferred))
        }
      }
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

    const subject = {
      id: String(scope.subjectId),
      name: await loadSubjectName(supabase, scope.subjectId),
      isCoachView: scope.actorRole === "coach",
    }

    // ── dry run, when a mapping is supplied ──
    let dryRun: unknown = null
    const mappingRaw = form.get("mapping") as string | null
    if (mappingRaw) {
      let mapping: (ImportField | null)[]
      try {
        mapping = JSON.parse(mappingRaw)
      } catch {
        return withCorsJson(req, { ok: false, error: "Bad mapping." }, 400)
      }
      const board = await loadBoardState(supabase, scope.subjectId)
      const resolved = resolveImport({ rows: buildSourceRows(rows, mapping, headerRow), ...board })
      dryRun = {
        summary: resolved.summary,
        // Every row, so the coach can scroll the skips rather than trust a count.
        rows: resolved.rows.map((r) => ({
          rowNum: r.rowNum,
          disposition: r.disposition,
          display: r.display,
          company: r.companyName,
          companyAction: r.companyAction,
          emailDropped: r.emailDropped,
          detail: r.detail,
        })),
        companiesToCreate: resolved.companiesToCreate.map((c) => ({ name: c.name, domain: c.domain })),
        domainBackfills: resolved.domainBackfills.map((b) => ({ name: b.name, domain: b.domain })),
      }
    }

    return withCorsJson(req, {
      ok: true,
      subject,
      sheets, sheet, headerRow, headers, sampleRows,
      guessedMapping, totalRows: rows.length,
      dryRun,
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
    if (status === 403) return withCorsJson(req, { ok: false, error: "You do not have full access to that client's board." }, 403)
    if (status === 404) return withCorsJson(req, { ok: false, error: "We couldn't find your profile." }, 404)
    return withCorsJson(req, { ok: false, error: "Something went wrong reading that file. Please try again." }, 500)
  }
}
