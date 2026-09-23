// app/api/network/import/commit/route.ts
// POST the file again (multipart) + the confirmed { sheet, headerRow, mapping }.
// Re-parses, RE-RESOLVES from scratch against the board, creates companies,
// backfills a matched company's missing domain, inserts contacts, and returns a
// result in the same shape as the dry run. Never overwrites a contact.
//
// NO LONGER OWNER-ONLY — the reversal is described in
// docs/network-tracker/coach-contacts-import.md. This route was owner-only so
// that a coach appending ?client_profile_id= could not import onto a client's
// board, and importing onto a client's board is now what it is for. The subject
// is read and authorised by resolveRequestScope against coach_clients, and
// REQUIRED.write is `full`, so `view` and `annotate` coaches are refused.
// Delete, reminders and link-application stay owner-only.
//
// The dry run is advisory. Resolution runs again here because the board can
// change between the two calls, and the database at commit time is the truth.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { errorStatus } from "../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { createdBy, resolveRequestScope } from "@/lib/collab/scope"
import { parseFile, dataRows, MAX_ROWS } from "@/lib/network-tracker/import-parse"
import { matchOrCreateCompany } from "@/lib/network-tracker/company"
import { buildSourceRows, loadBoardState, loadSubjectName } from "@/lib/network-tracker/import-load"
import { resolveImport } from "@/lib/network-tracker/import-resolve"
import type { ImportField } from "@/lib/network-tracker/import-fields"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const CHUNK = 200

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin()
    const scope = await resolveRequestScope(req, supabase, { require: "write" })

    const form = await req.formData()
    const file = form.get("file") as File | null
    if (!file) return withCorsJson(req, { ok: false, error: "No file uploaded." }, 400)
    const filename = file.name || "upload"
    const sheet = (form.get("sheet") as string | null) || undefined
    const headerRow = Number(form.get("headerRow") ?? 0)
    let mapping: (ImportField | null)[]
    try {
      mapping = JSON.parse((form.get("mapping") as string) || "[]")
    } catch {
      return withCorsJson(req, { ok: false, error: "Bad mapping." }, 400)
    }

    // The coach confirms the client's NAME, and the name they confirmed is
    // checked against the board this request is actually authorised for. A
    // confirmation the server does not verify is decoration.
    const confirmedName = (form.get("confirmName") as string | null) ?? null
    const subjectName = await loadSubjectName(supabase, scope.subjectId)
    if (scope.actorRole === "coach") {
      if (!confirmedName) {
        return withCorsJson(req, { ok: false, error: "Confirm the client's name before importing." }, 400)
      }
      if (confirmedName.trim().toLowerCase() !== (subjectName ?? "").trim().toLowerCase()) {
        return withCorsJson(req, { ok: false, error: "That name does not match the board you are importing into. Nothing was changed." }, 409)
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    let grid: string[][]
    try {
      ;({ grid } = await parseFile(buffer, filename, sheet))
    } catch (e: any) {
      console.error("[import/commit] parse failed:", e?.stack || e?.message, "file:", filename)
      return withCorsJson(req, { ok: false, error: "We couldn't read this file. Try re-saving it as CSV or a standard .xlsx." }, 422)
    }
    const rows = dataRows(grid, Number.isFinite(headerRow) ? headerRow : 0)
    if (rows.length > MAX_ROWS)
      return withCorsJson(req, { ok: false, error: `That file has ${rows.length} rows — the import handles up to ${MAX_ROWS}.` }, 400)

    const board = await loadBoardState(supabase, scope.subjectId)
    const resolved = resolveImport({
      rows: buildSourceRows(rows, mapping, Number.isFinite(headerRow) ? headerRow : 0),
      ...board,
    })

    // ── 1. companies this file introduces ──
    const attribution = createdBy(scope)
    const refToId = new Map<string, string>()
    for (const plan of resolved.companiesToCreate) {
      const id = await matchOrCreateCompany(supabase, scope.subjectId, plan.name, attribution, plan.domain)
      refToId.set(plan.key, id)
    }

    // ── 2. domain onto a company matched by name that had none ──
    let domainsBackfilled = 0
    for (const b of resolved.domainBackfills) {
      const { error } = await supabase
        .from("network_companies")
        .update({ domain: b.domain, edited_by_role: attribution.created_by_role, edited_by_id: attribution.created_by_id, edited_at: new Date().toISOString() })
        .eq("id", b.id)
        .eq("client_profile_id", scope.subjectId)
        .is("domain", null) // never overwrite a domain someone already set
      if (error) console.warn("[import/commit] domain backfill failed:", b.name, error.message)
      else domainsBackfilled++
    }

    // ── 3. contacts ──
    const creates = resolved.rows.filter((r) => r.disposition === "create" && r.insert)
    const payload = creates.map((r) => ({
      client_profile_id: scope.subjectId,
      ...attribution,
      company_id: r.companyRef ? (refToId.get(r.companyRef) ?? r.companyRef) : null,
      ...r.insert!,
      // Locked defaults for this importer. `stage` is deliberately absent so the
      // column default ('identified') applies.
      relationship: "cold",
      priority: null,
      segment: null,
      source: "import",
    }))

    let imported = 0
    const insertFailures: { display: string; reason: string }[] = []
    for (let i = 0; i < payload.length; i += CHUNK) {
      const slice = payload.slice(i, i + CHUNK)
      const { data, error } = await supabase.from("network_contacts").insert(slice).select("id")
      if (!error) {
        imported += data?.length ?? 0
        continue
      }
      // A chunk can fail on one bad row (a unique-index race, say). Retry the
      // slice one row at a time so a single collision cannot discard 199 good
      // contacts, and report what actually failed.
      for (const one of slice) {
        const { error: rowErr } = await supabase.from("network_contacts").insert(one)
        if (rowErr) {
          insertFailures.push({
            display: `${one.first_name} ${one.last_name}`.trim(),
            reason: rowErr.code === "23505" ? "Already on the board." : rowErr.message,
          })
        } else imported++
      }
    }

    return withCorsJson(req, {
      ok: true,
      subject: { id: String(scope.subjectId), name: subjectName, isCoachView: scope.actorRole === "coach" },
      imported,
      summary: { ...resolved.summary, domainsBackfilled },
      companiesCreated: resolved.companiesToCreate.map((c) => ({ name: c.name, domain: c.domain })),
      domainBackfills: resolved.domainBackfills.map((b) => ({ name: b.name, domain: b.domain })),
      skipped: resolved.rows
        .filter((r) => r.disposition !== "create")
        .map((r) => ({ rowNum: r.rowNum, display: r.display, disposition: r.disposition, detail: r.detail })),
      insertFailures,
      defaultsApplied: ["relationship = cold", "stage = identified", "priority blank", "segment blank"],
    }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[import/commit]", err?.stack || msg)
    const status = errorStatus(err)
    if (status === 401) return withCorsJson(req, { ok: false, error: "Please sign in again." }, 401)
    if (status === 403) return withCorsJson(req, { ok: false, error: "You do not have full access to that client's board." }, 403)
    if (status === 404) return withCorsJson(req, { ok: false, error: "We couldn't find your profile." }, 404)
    return withCorsJson(req, { ok: false, error: "The import didn't finish. Some rows may have been created — re-run the same file to finish; existing contacts are never duplicated." }, 500)
  }
}
