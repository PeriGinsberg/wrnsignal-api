// lib/network-tracker/import-load.ts
// The two things the preview and the commit both need and must agree on: how a
// mapped grid becomes SourceRows, and what the board currently holds. Shared so
// that "what the preview promised" and "what the commit did" cannot drift.

import { type SupabaseClient } from "@supabase/supabase-js"
import { resolveImportedName } from "./parse-name"
import type { ImportField } from "./import-fields"
import type { ExistingCompany, ExistingContact, SourceRow } from "./import-resolve"

/** Build one SourceRow per data row, using the confirmed column mapping. */
export function buildSourceRows(
  rows: string[][],
  mapping: (ImportField | null)[],
  headerRow: number,
): SourceRow[] {
  const col = (f: ImportField) => mapping.indexOf(f)
  const cell = (row: string[], i: number) => (i >= 0 ? (row[i] ?? "").toString().trim() : "")

  return rows.map((row, r) => {
    // Explicit first/last wins over a single combined name column, matching the
    // client-run importer.
    let first = ""
    let last = ""
    if (col("first_name") >= 0 || col("last_name") >= 0) {
      first = cell(row, col("first_name"))
      last = cell(row, col("last_name"))
    } else if (col("name") >= 0) {
      const resolved = resolveImportedName(cell(row, col("name")))
      first = resolved.first_name
      last = resolved.last_name
    }

    return {
      rowNum: headerRow + 2 + r, // 1-based spreadsheet row
      company: cell(row, col("company")),
      first,
      last,
      title: cell(row, col("title")),
      email: cell(row, col("email")),
      linkedin: cell(row, col("linkedin_url")),
      domain: cell(row, col("company_domain")),
    }
  })
}

/** Everything on the board that a dedupe decision depends on. */
export async function loadBoardState(
  supabase: SupabaseClient,
  subjectId: string,
): Promise<{ companies: ExistingCompany[]; contacts: ExistingContact[] }> {
  const [{ data: companies, error: coErr }, { data: contacts, error: cErr }] = await Promise.all([
    supabase.from("network_companies").select("id, name, domain").eq("client_profile_id", subjectId),
    supabase.from("network_contacts").select("first_name, last_name, company_id, email").eq("client_profile_id", subjectId),
  ])
  // A failed read must not read as an empty board: that would turn every
  // existing contact into a fresh create.
  if (coErr) throw new Error(`Could not read companies: ${coErr.message}`)
  if (cErr) throw new Error(`Could not read contacts: ${cErr.message}`)
  return { companies: companies ?? [], contacts: contacts ?? [] }
}

/**
 * The name of the board being written to, read from the AUTHORIZED subject id
 * rather than from anything the page sent. The confirm step is only worth
 * having if the name it shows comes from the same place the write goes.
 */
export async function loadSubjectName(supabase: SupabaseClient, subjectId: string): Promise<string | null> {
  const { data } = await supabase.from("client_profiles").select("name, email").eq("id", subjectId).maybeSingle()
  return data?.name || data?.email || null
}
