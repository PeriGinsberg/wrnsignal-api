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
import { detectHeaderRow } from "@/lib/network-tracker/import-parse"
import { resolveDelegation } from "@/lib/collab/delegation"
import { sourceHash } from "@/lib/networking-plan/job"
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
      // relationship / priority / segment / additional_info come from the mapped
      // columns when the file has them and fall back to the locked defaults when
      // it does not — resolveImport decides which. `stage` is deliberately
      // absent so the column default ('identified') applies.
      ...r.insert!,
      source: "import",
    }))

    let imported = 0
    const insertFailures: { display: string; reason: string }[] = []
    // key -> id, so the contact-method notes below can find the row they belong
    // to. Same key shape the resolver dedupes on.
    const insertedIds = new Map<string, string>()
    const keyOf = (r: { first_name: string; last_name: string; company_id: string | null }) =>
      `${r.first_name.trim().toLowerCase()}|${r.last_name.trim().toLowerCase()}|${r.company_id ?? ""}`
    const remember = (rows: any[] | null) => {
      for (const row of rows ?? []) insertedIds.set(keyOf(row), row.id)
    }

    const RETURNING = "id, first_name, last_name, company_id"
    for (let i = 0; i < payload.length; i += CHUNK) {
      const slice = payload.slice(i, i + CHUNK)
      const { data, error } = await supabase.from("network_contacts").insert(slice).select(RETURNING)
      if (!error) {
        imported += data?.length ?? 0
        remember(data)
        continue
      }
      // A chunk can fail on one bad row (a unique-index race, say). Retry the
      // slice one row at a time so a single collision cannot discard 199 good
      // contacts, and report what actually failed.
      for (const one of slice) {
        const { data: oneRow, error: rowErr } = await supabase
          .from("network_contacts").insert(one).select(RETURNING).maybeSingle()
        if (rowErr) {
          insertFailures.push({
            display: `${one.first_name} ${one.last_name}`.trim(),
            reason: rowErr.code === "23505" ? "Already on the board." : rowErr.message,
          })
        } else {
          imported++
          remember(oneRow ? [oneRow] : [])
        }
      }
    }

    // ── 4. a non-email "contact method" is kept, not thrown away ──
    // "call her", a phone number, an assistant's name: the cell is not an
    // address so it cannot be the email, and deleting what someone typed is
    // worse than filing it. Logged as a system note against the contact, which
    // is where the client-run importer has always put it.
    const notes = creates
      .filter((r) => r.contactMethod)
      .map((r) => ({
        id: insertedIds.get(
          `${r.insert!.first_name.trim().toLowerCase()}|${r.insert!.last_name.trim().toLowerCase()}|${
            r.companyRef ? (refToId.get(r.companyRef) ?? r.companyRef) : ""
          }`,
        ),
        text: r.contactMethod as string,
      }))
      .filter((n) => n.id)
      .map((n) => ({
        contact_id: n.id,
        type: "note_logged",
        action_date: new Date().toISOString(),
        note: `Imported contact method: ${n.text}`,
        author_role: "system",
        author_id: null,
      }))
    let notesLogged = 0
    if (notes.length) {
      const { data, error } = await supabase.from("network_actions").insert(notes).select("id")
      if (error) console.warn("[import/commit] contact-method notes failed:", error.message)
      else notesLogged = data?.length ?? 0
    }

    // ── The Networking Plan's source rows ───────────────────────────────
    //
    // SAVED HERE, AT IMPORT, not when the plan is built.
    //
    // They were saved in /api/network/plan/run, which only fires when a coach
    // clicks Build Networking Plan WITH the workbook still attached. That is
    // the exact button the status bar exists to make reachable later, so a
    // coach who imported a list and walked away had no source, the status
    // endpoint answered "no_source", and the bar rendered nothing. The fix
    // for "you cannot get back to Build" cannot itself depend on having
    // already pressed Build.
    //
    // This is the same workbook: the commit re-posts the file, so the
    // "Outreach Messages" tab is in hand right here.
    //
    // Best effort. The contacts are already imported by this point and a
    // missing plan source must not fail that, but it IS logged: a silent
    // no-op here is what made the first attempt look like it worked.
    await savePlanSource(supabase, scope, buffer, filename).catch((e) => {
      console.error("[import/commit] plan source not saved:", e?.message ?? e)
    })

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
      notesLogged,
      defaultsApplied: [
        "relationship = cold when the file does not map one",
        "stage = identified",
        "priority / segment / additional info blank unless mapped",
      ],
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

/**
 * Store the "Outreach Messages" rows so Build Networking Plan can run later
 * without the file.
 *
 * A workbook with no such tab is NORMAL: plenty of imports are a plain
 * contact list. That is a no-op, not an error, which is why this returns
 * quietly rather than throwing.
 */
async function savePlanSource(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  scope: { actorId: string; subjectId: string | number; actorRole: string },
  buffer: Buffer,
  filename: string,
): Promise<void> {
  // A plan belongs to a coach-client relationship. An owner importing onto
  // their own board has none, and no plan.
  const { data: rel } = await supabase
    .from("coach_clients").select("id")
    .in("coach_profile_id", (await resolveDelegation(supabase, scope.actorId)).actingIds)
    .eq("client_profile_id", scope.subjectId)
    .eq("status", "active").maybeSingle()
  if (!rel) return

  const probe = await parseFile(buffer, filename)
  const tab = probe.sheets.find((x: string) => x.trim().toLowerCase() === "outreach messages")
  if (!tab) return

  const { grid } = await parseFile(buffer, filename, tab)
  const rows = dataRows(grid, detectHeaderRow(grid))
  if (!rows.length) return

  const { error } = await supabase.from("networking_plan_sources").upsert({
    coach_client_id: rel.id,
    client_profile_id: String(scope.subjectId),
    rows,
    source_hash: sourceHash(rows),
    file_name: filename,
    uploaded_by_id: scope.actorId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "coach_client_id" })

  // CHECKED, not assumed. The first version of this did not look at the
  // error, which is how a save that never happened looked like one that had.
  if (error) throw new Error(`networking_plan_sources upsert failed: ${error.message}`)
}
