#!/usr/bin/env tsx
// Ad-hoc inspection script for jobfit_page_views (pre-Phase 2 analytics rebuild).
// Kept for reference and as a template for future inspections. Safe to delete post-Phase 2.
//
// One-off inspection of jobfit_page_views before we treat it as frozen.
// Queries: sample rows, page_name cardinality, page_path cardinality,
// utm_source null ratio, rows per month.
//
// Hits whatever SUPABASE_URL points to in .env.local.

import { createClient } from "@supabase/supabase-js"
import { existsSync } from "node:fs"
import { join } from "node:path"

function loadEnvLocal() {
  for (const name of [".env.local", ".env.development.local"]) {
    const path = join(process.cwd(), name)
    if (!existsSync(path)) continue
    try {
      // @ts-ignore - Node 20.6+
      if (typeof process.loadEnvFile === "function") {
        // @ts-ignore
        process.loadEnvFile(path)
        return
      }
    } catch {}
  }
}
loadEnvLocal()

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  process.exit(1)
}
console.log(`connecting to: ${URL}`)

const sb = createClient(URL, KEY, { auth: { persistSession: false } })

// Probe both names — the rename may or may not have been applied.
const CANDIDATES = ["jobfit_page_views_archived_2026_04", "jobfit_page_views"]

async function resolveTable(): Promise<string> {
  for (const name of CANDIDATES) {
    const { error } = await sb.from(name).select("*").limit(1)
    if (!error) {
      console.log(`table present: ${name}`)
      return name
    }
  }
  throw new Error(`neither ${CANDIDATES.join(" nor ")} exists in this project`)
}

async function main() {
  const table = await resolveTable()

  // Total row count
  const { count: totalCount } = await sb.from(table).select("*", { count: "exact", head: true })
  console.log(`\ntotal rows: ${totalCount ?? "?"}`)

  // (a) Sample 20 rows, all columns
  console.log("\n── SAMPLE 20 ROWS ───────────────────────────────────────")
  const { data: sample, error: sampleErr } = await sb
    .from(table)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20)
  if (sampleErr) throw sampleErr
  if (!sample || sample.length === 0) {
    console.log("(empty)")
  } else {
    console.log(`columns: ${Object.keys(sample[0]).join(", ")}`)
    for (const row of sample) {
      console.log(JSON.stringify(row))
    }
  }

  // Pull all rows (full table) to compute distributions locally.
  // With ~10k rows this is cheap; page through in 1000-row chunks.
  const all: Record<string, unknown>[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(table)
      .select("*")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
  }
  console.log(`\nfetched ${all.length} rows for distribution analysis`)

  // (b) distinct page_name
  console.log("\n── (b) DISTINCT page_name ───────────────────────────────")
  const pageNameCounts = new Map<string, number>()
  let pageNameNulls = 0
  for (const r of all) {
    const v = (r as any).page_name
    if (v === null || v === undefined) pageNameNulls++
    else pageNameCounts.set(String(v), (pageNameCounts.get(String(v)) ?? 0) + 1)
  }
  const pageNameSorted = [...pageNameCounts.entries()].sort((a, b) => b[1] - a[1])
  console.log(`distinct non-null page_name values: ${pageNameCounts.size}`)
  console.log(`null page_name rows: ${pageNameNulls}`)
  for (const [k, v] of pageNameSorted) console.log(`  ${v.toString().padStart(6)}  ${k}`)

  // (c) distinct page_path
  console.log("\n── (c) DISTINCT page_path ───────────────────────────────")
  const pathCounts = new Map<string, number>()
  let pathNulls = 0
  for (const r of all) {
    const v = (r as any).page_path
    if (v === null || v === undefined) pathNulls++
    else pathCounts.set(String(v), (pathCounts.get(String(v)) ?? 0) + 1)
  }
  const pathSorted = [...pathCounts.entries()].sort((a, b) => b[1] - a[1])
  console.log(`distinct non-null page_path values: ${pathCounts.size}`)
  console.log(`null page_path rows: ${pathNulls}`)
  const showTop = Math.min(30, pathSorted.length)
  console.log(`top ${showTop} by volume:`)
  for (const [k, v] of pathSorted.slice(0, showTop)) {
    console.log(`  ${v.toString().padStart(6)}  ${k}`)
  }

  // (d) utm_source null vs not null
  console.log("\n── (d) utm_source NULL vs NOT NULL ──────────────────────")
  let utmNull = 0
  let utmPresent = 0
  const utmSourceCounts = new Map<string, number>()
  for (const r of all) {
    const v = (r as any).utm_source
    if (v === null || v === undefined || v === "") utmNull++
    else {
      utmPresent++
      utmSourceCounts.set(String(v), (utmSourceCounts.get(String(v)) ?? 0) + 1)
    }
  }
  console.log(`null/empty: ${utmNull}`)
  console.log(`populated:  ${utmPresent}`)
  const utmSorted = [...utmSourceCounts.entries()].sort((a, b) => b[1] - a[1])
  console.log("populated breakdown:")
  for (const [k, v] of utmSorted) console.log(`  ${v.toString().padStart(6)}  ${k}`)

  // (e) rows by month
  console.log("\n── (e) ROWS BY MONTH (date_trunc month on created_at) ───")
  const monthCounts = new Map<string, number>()
  for (const r of all) {
    const ts = (r as any).created_at
    if (!ts) continue
    const d = new Date(ts as string)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1)
  }
  const monthSorted = [...monthCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [k, v] of monthSorted) console.log(`  ${k}  ${v}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
