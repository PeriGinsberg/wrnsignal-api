#!/usr/bin/env tsx
// Ad-hoc inspection script for signal_landing subset of jobfit_page_views.
// Used during Phase 1 cleanup to verify landing-page traffic authenticity and
// detect the ~2026-04-11 Framer tracking regression. Kept as template.
// Safe to delete post-Phase 2.
//
// Focused inspection of jobfit_page_views where page_name = 'signal_landing'.
// Checks for Framer editor noise, un-deduped reloads, spikes, and source mix.

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
const TABLE = "jobfit_page_views"
const PAGE_NAME = "signal_landing"

type Row = {
  id: string
  created_at: string
  session_id: string | null
  page_path: string | null
  referrer: string | null
  utm_source: string | null
}

async function main() {
  // Pull the full signal_landing subset.
  const all: Row[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from(TABLE)
      .select("id,created_at,session_id,page_path,referrer,utm_source")
      .eq("page_name", PAGE_NAME)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as Row[]))
    if (data.length < PAGE) break
  }
  console.log(`\nsignal_landing rows: ${all.length}`)

  // (1) distinct session_id
  const sessions = new Map<string | "(null)", number>()
  for (const r of all) {
    const k = r.session_id ?? "(null)"
    sessions.set(k, (sessions.get(k) ?? 0) + 1)
  }
  console.log(`\n── (1) DISTINCT session_id ──────────────────────────────`)
  console.log(`distinct session_ids (including null bucket): ${sessions.size}`)
  console.log(`rows with null session_id: ${sessions.get("(null)") ?? 0}`)
  console.log(`distinct non-null session_ids: ${sessions.size - (sessions.has("(null)") ? 1 : 0)}`)

  // (2) rows-per-session distribution
  const perSession = [...sessions.entries()]
    .filter(([k]) => k !== "(null)")
    .map(([, v]) => v)
    .sort((a, b) => a - b)
  function pct(p: number): number {
    if (perSession.length === 0) return 0
    const idx = Math.floor((perSession.length - 1) * p)
    return perSession[idx]
  }
  console.log(`\n── (2) ROWS-PER-SESSION DISTRIBUTION ────────────────────`)
  console.log(`sessions: ${perSession.length}`)
  console.log(`min: ${perSession[0] ?? 0}`)
  console.log(`p25: ${pct(0.25)}`)
  console.log(`median: ${pct(0.5)}`)
  console.log(`p75: ${pct(0.75)}`)
  console.log(`p90: ${pct(0.9)}`)
  console.log(`p99: ${pct(0.99)}`)
  console.log(`max: ${perSession[perSession.length - 1] ?? 0}`)
  console.log(`sessions with >10 rows: ${perSession.filter((n) => n > 10).length}`)
  console.log(`sessions with >50 rows: ${perSession.filter((n) => n > 50).length}`)
  console.log(`sessions with >100 rows: ${perSession.filter((n) => n > 100).length}`)

  // Top 10 noisiest sessions
  const noisy = [...sessions.entries()]
    .filter(([k]) => k !== "(null)")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  console.log(`top 10 noisiest sessions:`)
  for (const [sid, cnt] of noisy) {
    console.log(`  ${cnt.toString().padStart(5)}  ${sid}`)
  }

  // (3) hourly counts over last 7 days
  console.log(`\n── (3) HOURLY COUNTS — LAST 7 DAYS ──────────────────────`)
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const hourlyCounts = new Map<string, number>()
  for (const r of all) {
    const t = new Date(r.created_at)
    if (t < sevenDaysAgo) continue
    const key =
      `${t.getUTCFullYear()}-` +
      `${String(t.getUTCMonth() + 1).padStart(2, "0")}-` +
      `${String(t.getUTCDate()).padStart(2, "0")} ` +
      `${String(t.getUTCHours()).padStart(2, "0")}:00Z`
    hourlyCounts.set(key, (hourlyCounts.get(key) ?? 0) + 1)
  }
  const hourlySorted = [...hourlyCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const hourlyVals = hourlySorted.map(([, v]) => v).sort((a, b) => a - b)
  const hMedian = hourlyVals[Math.floor(hourlyVals.length / 2)] ?? 0
  const spikeThreshold = Math.max(20, hMedian * 5)
  console.log(`hours covered: ${hourlySorted.length}`)
  console.log(`median hourly count: ${hMedian}`)
  console.log(`spike threshold (max of 20, 5× median): ${spikeThreshold}`)
  console.log(`hour (UTC)              count  flag`)
  for (const [k, v] of hourlySorted) {
    const flag = v >= spikeThreshold ? " ← SPIKE" : ""
    console.log(`  ${k}  ${v.toString().padStart(5)}${flag}`)
  }

  // (4) top 20 referrer
  console.log(`\n── (4) TOP 20 referrer ──────────────────────────────────`)
  const refs = new Map<string, number>()
  for (const r of all) {
    const k = r.referrer ?? "(null)"
    refs.set(k, (refs.get(k) ?? 0) + 1)
  }
  const refsSorted = [...refs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  for (const [k, v] of refsSorted) {
    console.log(`  ${v.toString().padStart(5)}  ${k}`)
  }
  console.log(`(total distinct referrer values: ${refs.size})`)

  // (5) top 20 page_path for this subset
  console.log(`\n── (5) TOP 20 page_path (signal_landing subset) ─────────`)
  const paths = new Map<string, number>()
  for (const r of all) {
    const k = r.page_path ?? "(null)"
    paths.set(k, (paths.get(k) ?? 0) + 1)
  }
  const pathsSorted = [...paths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  for (const [k, v] of pathsSorted) {
    console.log(`  ${v.toString().padStart(5)}  ${k}`)
  }
  console.log(`(total distinct page_path values in subset: ${paths.size})`)

  // (6) 30 most recent rows
  console.log(`\n── (6) 30 MOST RECENT ROWS ──────────────────────────────`)
  const recent = [...all].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30)
  for (const r of recent) {
    console.log(
      `  ${r.created_at}  session=${r.session_id ?? "(null)"}  path=${r.page_path ?? "(null)"}  ref=${r.referrer ?? "(null)"}  utm=${r.utm_source ?? "(null)"}`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
