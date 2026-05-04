#!/usr/bin/env tsx
// One-off test for V5 networking_strategy + cover_letter_strategy nullability.
// Exercises three scenarios:
//   1. Priority Apply (retest-013-ryan) — both fields populated, anchors aligned
//   2. Apply with risks (retest-012-ryan) — both fields populated, risk bullets present
//   3. Pass (retest-013 with decision forced to "Pass") — both fields null
//
// Delete after the corresponding feature ships.

import { existsSync } from "node:fs"
import { join } from "node:path"

// Env
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

import { runJobFit } from "../app/api/_lib/jobfitEvaluator"
import { mapClientProfileToOverrides } from "../app/api/_lib/jobfitProfileAdapter"
import { generateBulletsV5 } from "../app/api/jobfit/bulletGeneratorV5"
import { CASE as ryan013 } from "./jobfit-regression/retest-013-ryan"
import { CASE as ryan012 } from "./jobfit-regression/retest-012-ryan"

type CaseInput = {
  id: string
  label: string
  profileJson: string
  jobText: string
  userJobTitle: string
  userCompanyName: string
  forceDecision?: "Pass" | "Review" | "Apply" | "Priority Apply"
}

async function runOne(c: CaseInput) {
  // Tolerant-parse for concatenated arrays (mirrors regression-check)
  let profileArray: any
  try {
    profileArray = JSON.parse(c.profileJson)
  } catch {
    let depth = 0,
      end = -1
    for (let k = 0; k < c.profileJson.length; k++) {
      const ch = c.profileJson[k]
      if (ch === "[") depth++
      else if (ch === "]") {
        depth--
        if (depth === 0) {
          end = k
          break
        }
      }
    }
    profileArray = JSON.parse(c.profileJson.slice(0, end + 1))
  }

  const p = Array.isArray(profileArray) ? profileArray[0] : profileArray
  const profileText =
    (
      String(p.profile_text || "").trim() +
      "\n\nResume:\n" +
      String(p.resume_text || "").trim()
    ).trim()

  const profileOverrides = mapClientProfileToOverrides({
    profileText,
    profileStructured:
      typeof p.profile_structured === "string"
        ? JSON.parse(p.profile_structured || "null")
        : p.profile_structured,
    targetRoles: p.target_roles || null,
    preferredLocations: p.preferred_locations || p.target_locations || null,
  })

  const result: any = await runJobFit({
    profileText,
    jobText: c.jobText,
    profileOverrides,
    userJobTitle: c.userJobTitle,
    userCompanyName: c.userCompanyName,
  } as any)

  // Force decision override (used for the Pass case)
  if (c.forceDecision) {
    result.decision = c.forceDecision
  }

  const t0 = Date.now()
  const v5 = await generateBulletsV5({
    ...result,
    profile_text: profileText,
    job_text: c.jobText,
  } as any)
  const elapsed = Date.now() - t0

  console.log("\n" + "=".repeat(72))
  console.log("CASE:", c.label)
  console.log("Decision (post-override if any):", result.decision, "/ Score:", result.score)
  console.log("Why codes:", (result.why_codes || []).length, "/ Risk codes:", (result.risk_codes || []).length)
  console.log("V5 latency (ms):", elapsed)
  console.log()

  console.log("--- why_structured ---")
  for (const w of v5.why_structured) {
    console.log(`  [${w.keyword}]`)
    console.log(`    lead:       ${w.lead}`)
    console.log(`    connection: ${w.connection}`)
    console.log(`    action:     ${w.action}`)
  }

  console.log("\n--- risk_structured ---")
  if (v5.risk_structured.length === 0) {
    console.log("  (none)")
  } else {
    for (const r of v5.risk_structured) {
      console.log(`  [${r.keyword}] (${r.severity})`)
      console.log(`    gap:     ${r.gap}`)
      console.log(`    reframe: ${r.reframe}`)
    }
  }

  console.log("\n--- cover_letter_strategy ---")
  console.log(JSON.stringify(v5.cover_letter_strategy, null, 2))

  console.log("\n--- positioning_strategy ---")
  console.log(JSON.stringify(v5.positioning_strategy, null, 2))

  console.log("\n--- networking_strategy ---")
  console.log(JSON.stringify(v5.networking_strategy, null, 2))

  console.log("\n--- alignment check ---")
  if (v5.cover_letter_strategy && v5.positioning_strategy && v5.networking_strategy) {
    const cls = v5.cover_letter_strategy.lead_signal
    const topWhy = (result.why_codes || [])[0]
    const topMatchKey = topWhy?.match_key
    console.log(`  cover_letter_strategy.lead_signal: ${cls}`)
    console.log(`  top why_code.match_key:            ${topMatchKey}`)
    console.log(`  positioning_strategy.lead_section: ${v5.positioning_strategy.lead_section}`)
    console.log(`  positioning_strategy.reframe:      ${v5.positioning_strategy.reframe}`)
    console.log(`  networking outreach_angle:         ${v5.networking_strategy.outreach_angle}`)
  } else {
    console.log("  (one or more strategy fields null — alignment not applicable)")
  }
  console.log("=".repeat(72))
}

async function main() {
  console.log("V5 strategy-field test runner. Three cases.\n")

  // Case 1: Priority Apply
  await runOne(ryan013)

  // Case 2: Apply (with risks expected)
  await runOne(ryan012)

  // Case 3: Pass — same inputs as Priority Apply but force decision to "Pass"
  await runOne({ ...ryan013, label: ryan013.label + " [decision FORCED to Pass]", forceDecision: "Pass" })
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
