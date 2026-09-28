#!/usr/bin/env tsx
//
// BMO, before and after, on the coach's exact LinkedIn paste.
//
// Scores the SAME profile against three inputs and prints all three:
//   FULL PAGE, isolation OFF  — what production did
//   FULL PAGE, isolation ON   — what production does now
//   CLEAN PASTE               — the posting on its own
//
// The claim under test is that the second and third are identical. The
// profile is a fixed synthetic one so the run is reproducible; the absolute
// numbers depend on it, the DIFFERENCE between the three does not.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { runJobFit } from "../../app/api/_lib/jobfitEvaluator"
import { isolatePosting } from "../../lib/jobs/isolatePosting"

const PAGE = readFileSync(
  join(__dirname, "..", "..", "lib", "jobs", "__fixtures__", "bmo-real-paste.txt"),
  "utf8",
)

// The posting exactly as a coach gets it by selecting only the description:
// from the "About the job" heading to the "Set alert for similar jobs" rail.
const CLEAN = PAGE.slice(
  PAGE.indexOf("About the job") + "About the job".length,
  PAGE.indexOf("Set alert for similar jobs"),
).trim()

const PROFILE = `
Name: Test Candidate
Cornell University, Bachelor of Science in Applied Economics and Management, May 2026.
Summer Analyst, Global Markets — supported credit analysis on hedge fund counterparties,
prepared written credit applications, monitored limits and exposures, and tracked covenant
compliance. Built financial models in Excel and used Bloomberg for counterparty research.
Credit Analyst Intern — performed due diligence on asset managers, assessed leverage and
liquidity, and drafted credit memoranda for review.
Skills: Excel, Bloomberg, credit analysis, financial modeling, Python, VBA.
Target roles: corporate banking analyst, credit analyst, capital markets analyst.
`.trim()

async function score(label: string, jobText: string, isolate: boolean) {
  const iso = isolate
    ? isolatePosting(jobText)
    : {
        text: jobText, confidence: "high" as const, looksLikePage: false,
        removedChars: 0, reason: "isolation off", source: "none" as const,
      }
  const r: any = await runJobFit({
    profileText: PROFILE,
    jobText,
    preIsolated: iso,
    userJobTitle: "Analyst, Global Markets Corporate Banking",
    userCompanyName: "BMO Capital Markets",
  })
  const js = r.job_signals ?? {}
  console.log("─".repeat(72))
  console.log(label)
  console.log(`  scored chars    ${iso.text.length}  (input ${jobText.length}, removed ${iso.removedChars})`)
  console.log(`  DECISION        ${r.decision}`)
  console.log(`  SCORE           ${r.score}`)
  console.log(`  jobFamily       ${js.jobFamily}`)
  console.log(`  yearsRequired   ${js.yearsRequired}`)
  console.log(`  location.city   ${js.location?.city ?? null}`)
  console.log(`  function_tags   ${JSON.stringify(js.function_tags)}`)
  console.log(`  risks           ${JSON.stringify((r.risk_flags ?? []).slice(0, 4))}`)
  return { decision: r.decision, score: r.score, family: js.jobFamily, years: js.yearsRequired }
}

async function main() {
  const off = await score("FULL PAGE  ·  isolation OFF   (what production did)", PAGE, false)
  const on = await score("FULL PAGE  ·  isolation ON    (what production does now)", PAGE, true)
  const clean = await score("CLEAN PASTE  ·  posting only", CLEAN, false)

  console.log("─".repeat(72))
  const same = on.decision === clean.decision && on.score === clean.score
  console.log(`isolated page vs clean paste: ${same ? "IDENTICAL" : "DIFFERENT"}`)
  console.log(`  isolated  ${on.decision} / ${on.score}`)
  console.log(`  clean     ${clean.decision} / ${clean.score}`)
  console.log(`  off       ${off.decision} / ${off.score}`)
  if (!same) process.exitCode = 1
}

main().catch((e) => { console.error(e); process.exit(1) })
