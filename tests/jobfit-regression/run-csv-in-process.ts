#!/usr/bin/env tsx
// tests/jobfit-regression/run-csv-in-process.ts
//
// Loads a CSV with columns (Case Number, Profile Name, Profile JSON,
// Job Description), runs each case through runJobFit directly
// (in-process, no HTTP, no auth), and writes a review markdown.
//
// Usage:
//   npx tsx tests/jobfit-regression/run-csv-in-process.ts <csv-path>
//
// Example:
//   npx tsx tests/jobfit-regression/run-csv-in-process.ts issues/040926ProdIssues.csv

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, basename, dirname } from "node:path"
import { runJobFit } from "../../app/api/_lib/jobfitEvaluator"
import { mapClientProfileToOverrides } from "../../app/api/_lib/jobfitProfileAdapter"

// Manual title/company overrides for existing test cases. These mirror
// what a user would enter through the required job-title / company-name
// inputs on the live JobFit form. Once the CSV schema is extended with
// "Job Title" and "Company Name" columns, this map goes away.
const CASE_OVERRIDES: Record<string, { jobTitle: string; companyName: string }> = {
  "40926a": { jobTitle: "Director of Human Resources", companyName: "Titan America" },
  "40926b": { jobTitle: "Scientist I", companyName: "QuidelOrtho" },
  "40926c": { jobTitle: "Chemist I", companyName: "ADMA Biologics" },
  "40926d": { jobTitle: "Analytical Scientist I", companyName: "PL Developments" },
  "40926e": { jobTitle: "QC Analyst I", companyName: "(Unknown)" },
  "40926f": { jobTitle: "Social Media Associate", companyName: "Joe & The Juice" },
  "40926g": { jobTitle: "Social Coordinator", companyName: "Vogue" },
  "40926h": { jobTitle: "Public Relations Assistant", companyName: "Mario Badescu" },
  "40926i": { jobTitle: "Account Coordinator", companyName: "Allison" },
  "40926j": { jobTitle: "Media Strategist", companyName: "Momentum Communications Group" },
  "40926k": { jobTitle: "HR Manager", companyName: "(Unknown - Boca Raton)" },
  "40926l": { jobTitle: "Director of People Services", companyName: "CoralTree / Pier Sixty-Six Resort" },
  "40926m": { jobTitle: "Growth Strategy Director", companyName: "TEAM" },
  "40926n": { jobTitle: "Finance Strategy & Department Lead", companyName: "Affirm" },
  "40926o": { jobTitle: "Strategy and Operations Consultant", companyName: "SEI" },
  "40926p": { jobTitle: "Associate to the Chairman", companyName: "GVW Group" },
  "40926q": { jobTitle: "Software Engineer", companyName: "Intuit" },
  "40926r": { jobTitle: "Software Engineer", companyName: "Maybern" },
  "40926s": { jobTitle: "Early Career Software Engineer", companyName: "Notion" },
  "40926t": { jobTitle: "Cyber Security Associate", companyName: "(Unknown)" },
  "40926u": { jobTitle: "Cyber Intelligence Analyst", companyName: "RightClick (client unnamed)" },
}

// ── Minimal CSV parser (handles quoted fields with embedded newlines/commas/quotes)
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cell += c
      i++
      continue
    }
    if (c === '"') {
      inQuotes = true
      i++
      continue
    }
    if (c === ",") {
      row.push(cell)
      cell = ""
      i++
      continue
    }
    if (c === "\n" || c === "\r") {
      if (cell !== "" || row.length > 0) {
        row.push(cell)
        rows.push(row)
        row = []
        cell = ""
      }
      if (c === "\r" && text[i + 1] === "\n") i += 2
      else i++
      continue
    }
    cell += c
    i++
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

// ── Build the profile text that the scoring engine expects
// The scoring engine reads a single `profileText` string. The CSV's
// Profile JSON is an array with the client_profiles row. We take:
//   profile_text (intake header) + resume_text (the resume body)
// combined, which matches how the live API builds effectiveProfileText.
function buildProfileText(profileRow: any): string {
  const header = String(profileRow?.profile_text ?? "").trim()
  const resume = String(profileRow?.resume_text ?? "").trim()
  if (!header) return resume
  if (!resume) return header
  if (header.includes(resume.slice(0, 80))) return header
  return header + "\n\nResume:\n" + resume
}

function buildProfileOverrides(profileRow: any) {
  let profileStructured: any = null
  try {
    const raw = profileRow?.profile_structured
    if (typeof raw === "string" && raw.trim().length > 0) {
      profileStructured = JSON.parse(raw)
    } else if (raw && typeof raw === "object") {
      profileStructured = raw
    }
  } catch {
    profileStructured = null
  }

  return mapClientProfileToOverrides({
    profileText: buildProfileText(profileRow),
    profileStructured,
    targetRoles: String(profileRow?.target_roles ?? "") || null,
    preferredLocations: String(profileRow?.preferred_locations ?? "") || null,
  })
}

// ── Formatting helpers for the review markdown
function fmt(n: any): string {
  if (n === null || n === undefined) return "—"
  return String(n)
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length)
}

// ── Main
async function main() {
  const csvPath = process.argv[2]
  if (!csvPath) {
    console.error("Usage: npx tsx tests/jobfit-regression/run-csv-in-process.ts <csv-path>")
    process.exit(2)
  }

  console.log(`Reading ${csvPath}...`)
  const content = readFileSync(csvPath, "utf8")
  const rows = parseCSV(content)
  if (rows.length < 2) {
    console.error("CSV has no data rows")
    process.exit(2)
  }

  const header = rows[0].map((h) => h.trim())
  const idxCaseNo = header.indexOf("Case Number")
  const idxName = header.indexOf("Profile Name")
  const idxJson = header.indexOf("Profile JSON")
  const idxJob = header.indexOf("Job Description")
  if (idxCaseNo < 0 || idxJson < 0 || idxJob < 0) {
    console.error(`CSV missing required columns. Got: ${header.join(", ")}`)
    process.exit(2)
  }

  const dataRows = rows.slice(1).filter((r) => r.some((c) => c.trim().length > 0))
  console.log(`Found ${dataRows.length} data row(s)\n`)

  const outDir = join(process.cwd(), "tests", "jobfit-regression", "results")
  mkdirSync(outDir, { recursive: true })

  const reviewLines: string[] = []
  reviewLines.push(`# JobFit Regression Review`)
  reviewLines.push(``)
  reviewLines.push(`Source: \`${csvPath}\``)
  reviewLines.push(`Generated: ${new Date().toISOString()}`)
  reviewLines.push(`Cases: ${dataRows.length}`)
  reviewLines.push(``)
  reviewLines.push(`---`)
  reviewLines.push(``)

  for (const row of dataRows) {
    const caseNo = row[idxCaseNo]?.trim() || "unnamed"
    const profileName = (idxName >= 0 ? row[idxName] : "").trim()
    const profileJsonRaw = row[idxJson]?.trim() || ""
    const jobText = row[idxJob]?.trim() || ""

    console.log(`▶ Case ${caseNo} (${profileName})`)

    let profileArray: any = null
    try {
      profileArray = JSON.parse(profileJsonRaw)
    } catch (e: any) {
      // Tolerant fallback: some CSV cells contain two concatenated arrays
      // like `[{...}][{...}]` when the same profile gets pasted twice.
      // Walk the first balanced top-level `[...]` and parse only that.
      let depth = 0
      let end = -1
      for (let k = 0; k < profileJsonRaw.length; k++) {
        const ch = profileJsonRaw[k]
        if (ch === "[") depth++
        else if (ch === "]") {
          depth--
          if (depth === 0) { end = k; break }
        }
      }
      if (end > 0) {
        try {
          profileArray = JSON.parse(profileJsonRaw.slice(0, end + 1))
          console.warn(`  ⚠ Profile JSON had trailing content — parsed first ${end + 1} of ${profileJsonRaw.length} chars`)
        } catch (e2: any) {
          console.error(`  ✗ Profile JSON parse failed: ${e.message} (fallback: ${e2.message})`)
          continue
        }
      } else {
        console.error(`  ✗ Profile JSON parse failed: ${e.message}`)
        continue
      }
    }

    const profileRow = Array.isArray(profileArray) ? profileArray[0] : profileArray
    if (!profileRow) {
      console.error(`  ✗ Profile JSON empty`)
      continue
    }

    const profileText = buildProfileText(profileRow)
    const profileOverrides = buildProfileOverrides(profileRow)

    // User-provided title/company (required in production; hardcoded for
    // this test batch via CASE_OVERRIDES until the CSV schema is extended)
    const override = CASE_OVERRIDES[caseNo] || { jobTitle: "", companyName: "" }

    let result: any
    try {
      result = await runJobFit({
        profileText,
        jobText,
        profileOverrides,
        userJobTitle: override.jobTitle || undefined,
        userCompanyName: override.companyName || undefined,
      } as any)
    } catch (e: any) {
      console.error(`  ✗ runJobFit threw: ${e.message}`)
      continue
    }

    // Save the full result as a fixture-ish JSON
    const outFile = join(outDir, `${caseNo}.json`)
    writeFileSync(
      outFile,
      JSON.stringify(
        {
          caseNo,
          profileName,
          profile: {
            id: profileRow.id,
            email: profileRow.email,
            name: profileRow.name,
            target_roles: profileRow.target_roles,
          },
          result,
        },
        null,
        2
      )
    )

    // Append a markdown block to the review
    const whyCount = (result?.why_codes ?? []).length
    const riskCount = (result?.risk_codes ?? []).length
    const gate = result?.gate_triggered?.type ?? "none"
    const gateCode = result?.gate_triggered?.gateCode ?? ""
    const js = result?.job_signals ?? {}
    const ps = result?.profile_signals ?? {}

    reviewLines.push(`## ${caseNo} — ${profileName || profileRow.name || profileRow.email}`)
    reviewLines.push(``)
    reviewLines.push(`**Profile email**: ${profileRow.email || "—"}`)
    reviewLines.push(`**Target roles**: ${profileRow.target_roles || "—"}`)
    reviewLines.push(``)
    reviewLines.push(`### Scoring result`)
    reviewLines.push(``)
    reviewLines.push(`| | |`)
    reviewLines.push(`|---|---|`)
    reviewLines.push(`| Decision | **${fmt(result?.decision)}** |`)
    reviewLines.push(`| Score | **${fmt(result?.score)}** |`)
    reviewLines.push(`| Gate | ${gate}${gateCode ? ` (${gateCode})` : ""} |`)
    reviewLines.push(`| Job family | ${fmt(js.jobFamily)}${js.financeSubFamily ? ` / ${js.financeSubFamily}` : ""} |`)
    reviewLines.push(`| Job title | ${fmt(js.jobTitle)} |`)
    reviewLines.push(`| Company | ${fmt(js.companyName)} |`)
    reviewLines.push(`| Years required | ${fmt(js.yearsRequired)} |`)
    reviewLines.push(`| Is senior role | ${fmt(js.isSeniorRole)} |`)
    reviewLines.push(`| Profile years approx | ${fmt(ps.yearsExperienceApprox)} |`)
    reviewLines.push(`| Profile grad year | ${fmt(ps.gradYear)} |`)
    reviewLines.push(`| Profile target families | ${Array.isArray(ps.targetFamilies) ? ps.targetFamilies.join(", ") : "—"} |`)
    reviewLines.push(`| WHY codes | ${whyCount} |`)
    reviewLines.push(`| RISK codes | ${riskCount} |`)
    reviewLines.push(``)

    if (whyCount > 0) {
      reviewLines.push(`### WHY codes`)
      reviewLines.push(``)
      for (const w of result.why_codes.slice(0, 8)) {
        reviewLines.push(
          `- **[${w.code}]** \`${w.match_key}\` (${w.match_strength}, weight ${w.weight})`
        )
        reviewLines.push(`  - **Job fact**: ${String(w.job_fact ?? "").slice(0, 200)}`)
        reviewLines.push(`  - **Profile fact**: ${String(w.profile_fact ?? "").slice(0, 200)}`)
      }
      reviewLines.push(``)
    }

    if (riskCount > 0) {
      reviewLines.push(`### RISK codes`)
      reviewLines.push(``)
      for (const r of result.risk_codes.slice(0, 8)) {
        reviewLines.push(
          `- **[${r.code}]** severity=${r.severity}, weight ${r.weight}`
        )
        reviewLines.push(`  - ${String(r.risk ?? "").slice(0, 300)}`)
      }
      reviewLines.push(``)
    }

    // First 300 chars of the job description for context
    reviewLines.push(`### Job description (first 300 chars)`)
    reviewLines.push(``)
    reviewLines.push(`> ${jobText.slice(0, 300).replace(/\n/g, " ")}${jobText.length > 300 ? "..." : ""}`)
    reviewLines.push(``)
    reviewLines.push(`---`)
    reviewLines.push(``)

    console.log(
      `  ${result?.decision ?? "?"} / ${result?.score ?? "?"}` +
        `  why=${whyCount} risk=${riskCount} gate=${gate}`
    )
  }

  const reviewPath = join(outDir, "review.md")
  writeFileSync(reviewPath, reviewLines.join("\n"))
  console.log(`\n✓ Wrote review to ${reviewPath}`)
  console.log(`✓ Per-case JSON results in ${outDir}`)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(2)
})
