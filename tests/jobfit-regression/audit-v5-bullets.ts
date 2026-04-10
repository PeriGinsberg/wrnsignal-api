#!/usr/bin/env tsx
// tests/jobfit-regression/audit-v5-bullets.ts
//
// Pulls random production jobfit_runs and prints the ACTUAL V5 bullet
// text users saw — not the V4 template fallback, not the scoring internals,
// but the real advice that appeared on their screen.
//
// PURPOSE
//   Answer: "Are the bullets we're shipping good enough to build trust?"
//   Read each case and grade it yourself: would a student find this useful?
//
// USAGE
//   npx tsx tests/jobfit-regression/audit-v5-bullets.ts
//   npx tsx tests/jobfit-regression/audit-v5-bullets.ts --sample 20
//   npx tsx tests/jobfit-regression/audit-v5-bullets.ts --decision Apply
//   npx tsx tests/jobfit-regression/audit-v5-bullets.ts --user <client_profile_id>
//   npx tsx tests/jobfit-regression/audit-v5-bullets.ts --id <jobfit_run_id>
//
// SAFETY
//   Read-only. Only SELECT queries.

import { createClient } from "@supabase/supabase-js"
import { existsSync } from "node:fs"
import { join } from "node:path"

// ── Env loading ─────────────────────────────────────────────────────────────
function loadEnvLocal() {
  const candidates = [".env.local", ".env.development.local"]
  for (const name of candidates) {
    const path = join(process.cwd(), name)
    if (!existsSync(path)) continue
    try {
      // @ts-ignore — Node 20.6+
      if (typeof process.loadEnvFile === "function") {
        // @ts-ignore
        process.loadEnvFile(path)
        return
      }
    } catch {}
  }
}
loadEnvLocal()

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
function argValue(name: string): string | null {
  const i = args.indexOf(name)
  if (i < 0 || i + 1 >= args.length) return null
  return args[i + 1]
}
const SAMPLE_SIZE = Number(argValue("--sample") || "10")
const FILTER_DECISION = argValue("--decision") // e.g. "Apply", "Pass"
const FILTER_USER = argValue("--user") // client_profile_id
const FILTER_ID = argValue("--id") // specific jobfit_run id

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== V5 Bullet Audit ===\n")

  let q = supabase
    .from("jobfit_runs")
    .select("id, client_profile_id, verdict, result_json, created_at")

  if (FILTER_ID) {
    q = q.eq("id", FILTER_ID)
  } else if (FILTER_USER) {
    q = q.eq("client_profile_id", FILTER_USER).order("created_at", { ascending: false }).limit(SAMPLE_SIZE)
  } else if (FILTER_DECISION) {
    q = q.eq("verdict", FILTER_DECISION).order("created_at", { ascending: false }).limit(SAMPLE_SIZE)
  } else {
    // Random sample: pull more than needed and shuffle
    q = q.order("created_at", { ascending: false }).limit(SAMPLE_SIZE * 5)
  }

  const { data: rows, error } = await q
  if (error) {
    console.error("FAILED:", error.message)
    process.exit(1)
  }
  if (!rows || rows.length === 0) {
    console.log("No rows found.")
    return
  }

  // Shuffle and take sample (unless filtering by specific id/user)
  let selected = rows
  if (!FILTER_ID && !FILTER_USER) {
    for (let i = selected.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[selected[i], selected[j]] = [selected[j], selected[i]]
    }
    selected = selected.slice(0, SAMPLE_SIZE)
  }

  console.log(`Showing ${selected.length} case(s)\n`)

  for (let idx = 0; idx < selected.length; idx++) {
    const row = selected[idx]
    const r = row.result_json || {}
    const js = r.job_signals || {}
    const ps = r.profile_signals || {}

    const title = js.jobTitle || "(no title)"
    const company = js.companyName || "(no company)"
    const family = js.jobFamily || "?"
    const profileTargets = (ps.targetFamilies || []).join(", ") || "?"

    console.log("─".repeat(70))
    console.log(
      `${idx + 1}. ${r.decision || row.verdict} / ${r.score}  │  ${title} @ ${company}`
    )
    console.log(
      `   Family: ${family}  │  Profile targets: ${profileTargets}  │  ${row.created_at?.slice(0, 10)}`
    )
    console.log(`   ID: ${row.id}`)
    console.log()

    // V5 bullets are in `why` (array of strings) and `risk` (array of strings).
    // V4 fallback puts them in `bullets` and `risk_flags`.
    // `why_structured` and `risk_structured` are the V5 structured objects.
    const whyBullets: string[] = r.why || r.bullets || []
    const riskBullets: string[] = r.risk || r.risk_flags || r.risk_bullets || []
    const isV5 = !!(r.why_structured || r.debug?.renderer_stamp?.includes("V5"))

    console.log(`   Renderer: ${isV5 ? "V5 (LLM)" : "V4 (template)"}`)
    console.log()

    if (whyBullets.length === 0) {
      console.log("   WHY BULLETS: (none)")
    } else {
      console.log(`   WHY BULLETS (${whyBullets.length}):`)
      for (const b of whyBullets) {
        // Wrap long bullets for readability
        const text = String(b).trim()
        if (!text) {
          console.log("   ⚠ [EMPTY BULLET]")
          continue
        }
        const lines = wrapText(text, 65)
        console.log(`   ✦ ${lines[0]}`)
        for (let l = 1; l < lines.length; l++) {
          console.log(`     ${lines[l]}`)
        }
      }
    }
    console.log()

    if (riskBullets.length === 0) {
      console.log("   RISK BULLETS: (none)")
    } else {
      console.log(`   RISK BULLETS (${riskBullets.length}):`)
      for (const b of riskBullets) {
        const text = String(b).trim()
        if (!text) {
          console.log("   ⚠ [EMPTY BULLET]")
          continue
        }
        const lines = wrapText(text, 65)
        console.log(`   ▲ ${lines[0]}`)
        for (let l = 1; l < lines.length; l++) {
          console.log(`     ${lines[l]}`)
        }
      }
    }
    console.log()

    // Quick structural flags
    const flags: string[] = []
    if (whyBullets.some((b) => !String(b).trim())) flags.push("EMPTY_WHY_BULLET")
    if (riskBullets.some((b) => !String(b).trim())) flags.push("EMPTY_RISK_BULLET")
    if (whyBullets.some((b) => (b.match(/\|/g) || []).length >= 2)) flags.push("PIPE_SEPARATED_SKILLS_IN_WHY")
    if ([...whyBullets, ...riskBullets].some((b) => /\bIt_Software\b|\bPreMed\b|\bIT_Software\b/.test(b))) flags.push("RAW_ENUM_IN_BULLET")
    if (whyBullets.length === 0 && (r.decision === "Apply" || r.decision === "Priority Apply")) flags.push("APPLY_WITH_NO_WHY_BULLETS")
    if (whyBullets.some((b) => String(b).length < 20)) flags.push("VERY_SHORT_WHY_BULLET")
    if (whyBullets.some((b) => String(b).length > 500)) flags.push("VERY_LONG_WHY_BULLET")
    const dupes = findDuplicates([...whyBullets, ...riskBullets])
    if (dupes.length > 0) flags.push(`DUPLICATE_BULLETS(${dupes.length})`)

    if (flags.length > 0) {
      console.log(`   ⚠ FLAGS: ${flags.join(", ")}`)
      console.log()
    }
  }

  console.log("─".repeat(70))
  console.log(`\n${selected.length} case(s) shown. Review each one:`)
  console.log("  - Would a student find this advice useful and specific?")
  console.log("  - Do the WHY bullets cite real evidence from their resume?")
  console.log("  - Do the RISK bullets give actionable next steps?")
  console.log("  - Any hallucinated facts, generic fluff, or raw data leaking through?")
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ""
  for (const w of words) {
    if (current.length + w.length + 1 > width && current.length > 0) {
      lines.push(current)
      current = w
    } else {
      current = current ? current + " " + w : w
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : [""]
}

function findDuplicates(bullets: string[]): string[] {
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const b of bullets) {
    const key = String(b).trim().toLowerCase().slice(0, 80)
    if (seen.has(key)) dupes.push(key.slice(0, 40) + "...")
    seen.add(key)
  }
  return dupes
}

main().catch((err) => {
  console.error("FATAL:", err)
  process.exit(1)
})
