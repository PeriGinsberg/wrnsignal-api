// app/api/network/import/commit/route.ts
// POST the file again (multipart) + the confirmed { sheet, headerRow, mapping }.
// Re-parses, builds contacts per the mapping, dedups against existing + within
// the batch, inserts, attaches non-email "contact method" text as a system note,
// and returns a result summary. OWNER-ONLY. Never overwrites (IMPORT.md §10-§11).

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { parseFile, dataRows, MAX_ROWS } from "@/lib/network-tracker/import-parse"
import { resolveImportedName, displayName } from "@/lib/network-tracker/parse-name"
import { matchOrCreateCompany } from "@/lib/network-tracker/company"
import type { ImportField } from "@/lib/network-tracker/import-fields"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const RELATIONSHIPS = new Set(["personal", "affinity", "referred", "cold", "recruiter"])
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
const lc = (s: string) => (s ?? "").trim().toLowerCase()

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function POST(req: NextRequest) {
  try {
    const { profileId: owner } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()

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

    // Column index for each field we care about (-1 if not mapped).
    const col = (f: ImportField) => mapping.indexOf(f)
    const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").toString().trim() : "")

    // ── dedup pre-fetch: existing (lower first, lower last, company_id) keys ──
    const { data: existing } = await supabase
      .from("network_contacts").select("first_name, last_name, company_id").eq("client_profile_id", owner)
    const seen = new Set<string>((existing ?? []).map((c) => `${lc(c.first_name)}|${lc(c.last_name)}|${c.company_id ?? ""}`))

    // ── company cache (existing names -> id), for reuse + counting new ones ──
    const { data: existingCos } = await supabase
      .from("network_companies").select("id, name").eq("client_profile_id", owner)
    const companyCache = new Map<string, string>((existingCos ?? []).map((c) => [lc(c.name), c.id]))
    const preExisting = new Set(companyCache.keys())
    let newCompanies = 0

    async function resolveCompany(nameRaw: string): Promise<string | null> {
      const nm = nameRaw.trim()
      if (!nm) return null
      const key = lc(nm)
      const cached = companyCache.get(key)
      if (cached) return cached
      const id = await matchOrCreateCompany(supabase, owner, nm)
      companyCache.set(key, id)
      if (!preExisting.has(key)) newCompanies++
      return id
    }

    const toInsert: any[] = []
    const contactMethodByKey = new Map<string, string>()
    const skippedNoName: number[] = []
    const skippedDup: string[] = []
    let flaggedNonPerson = 0
    let flaggedBadEmail = 0

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]
      const rowNum = headerRow + 2 + r // 1-based spreadsheet row (header + 1)

      // name: explicit first/last wins over a combined name column.
      let first = ""
      let last = ""
      if (col("first_name") >= 0 || col("last_name") >= 0) {
        first = cell(row, col("first_name"))
        last = cell(row, col("last_name"))
      } else if (col("name") >= 0) {
        const resolved = resolveImportedName(cell(row, col("name")))
        first = resolved.first_name; last = resolved.last_name
        if (resolved.nonPerson) flaggedNonPerson++
      }
      if (!displayName(first, last)) { skippedNoName.push(rowNum); continue }

      const companyId = await resolveCompany(cell(row, col("company")))
      const key = `${lc(first)}|${lc(last)}|${companyId ?? ""}`
      if (seen.has(key)) { skippedDup.push(displayName(first, last)); continue }
      seen.add(key)

      // email: keep only real addresses; stash the rest as a system note (§6/§8).
      const emailRaw = cell(row, col("email"))
      let email: string | null = null
      if (emailRaw) {
        if (isEmail(emailRaw)) email = emailRaw
        else { contactMethodByKey.set(key, emailRaw); flaggedBadEmail++ }
      }

      // priority only if literally A/B/C (§7); relationship only if a valid enum.
      const priRaw = cell(row, col("priority")).toUpperCase()
      const priority = ["A", "B", "C"].includes(priRaw) ? priRaw : null
      const relRaw = lc(cell(row, col("relationship")))
      const relationship = RELATIONSHIPS.has(relRaw) ? relRaw : null

      toInsert.push({
        _key: key,
        client_profile_id: owner,
        company_id: companyId,
        first_name: first,
        last_name: last,
        title: cell(row, col("title")) || null,
        email,
        linkedin_url: cell(row, col("linkedin_url")) || null,
        company_domain: cell(row, col("company_domain")) || null,
        segment: cell(row, col("segment")) || null,
        priority,
        relationship,
        additional_info: cell(row, col("additional_info")) || null,
        source: "import",
      })
    }

    // ── insert (strip the correlation key) ──
    let inserted: { id: string; first_name: string; last_name: string; company_id: string | null }[] = []
    if (toInsert.length) {
      const rowsForInsert = toInsert.map(({ _key, ...rest }) => rest)
      const { data, error } = await supabase
        .from("network_contacts").insert(rowsForInsert)
        .select("id, first_name, last_name, company_id")
      if (error) throw new Error(`Import insert failed: ${error.message}`)
      inserted = data ?? []
    }

    // ── attach contact-method text as a dated system note (§6/§8) ──
    const keyToId = new Map(inserted.map((c) => [`${lc(c.first_name)}|${lc(c.last_name)}|${c.company_id ?? ""}`, c.id]))
    const notes = [...contactMethodByKey.entries()]
      .map(([key, text]) => ({ id: keyToId.get(key), text }))
      .filter((n) => n.id)
      .map((n) => ({
        contact_id: n.id, type: "note_logged", action_date: new Date().toISOString(),
        note: `Imported contact method: ${n.text}`, author_role: "system", author_id: null,
      }))
    if (notes.length) {
      const { error } = await supabase.from("network_actions").insert(notes)
      if (error) console.warn("[import] contact-method notes failed:", error.message)
    }

    const companiesTouched = new Set(inserted.map((c) => c.company_id).filter(Boolean)).size
    return withCorsJson(req, {
      ok: true,
      imported: inserted.length,
      companies: companiesTouched,
      newCompanies,
      skippedDuplicates: skippedDup,
      skippedNoName,
      flagged: { nonPersonNames: flaggedNonPerson, unparseableEmails: flaggedBadEmail },
      leftBlankByDesign: ["relationship (unless a valid value mapped)", "priority (unless A/B/C mapped)", "segment (unless mapped)"],
    }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[import/commit]", err?.stack || msg)
    if (/unauthorized/i.test(msg)) return withCorsJson(req, { ok: false, error: "Please sign in again." }, 401)
    if (/profile not found/i.test(msg)) return withCorsJson(req, { ok: false, error: "We couldn't find your profile." }, 404)
    return withCorsJson(req, { ok: false, error: "The import didn't finish. Nothing was changed — please try again." }, 500)
  }
}
