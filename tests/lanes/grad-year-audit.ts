// tests/lanes/grad-year-audit.ts
//
// Every real client resume on dev, through deriveYearsMax() before and after
// the DEGREE_LINE fix. Read-only: it selects, prints, and writes nothing.
//
// Run (dev credentials only — it refuses the prod ref):
//   $env:SUPABASE_URL = "https://<dev-ref>.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<dev service role key>"
//   $env:NODE_OPTIONS = "--use-system-ca"
//   npx tsx tests/lanes/grad-year-audit.ts
//
// Why before AND after in one run: the question is not "is the new number
// right" in the abstract, it is "which clients does this move, and is each
// move an improvement". A number on its own cannot answer that, and running
// the old code first means checking out the old code.
//
// What to look at: MOVED rows. Each one needs the resume's own education lines
// read back — printed with --lines — because the fix is only correct if the new
// year is the one the resume states.

import { createClient } from "@supabase/supabase-js"
import { deriveYearsMax, HEADROOM_YEARS } from "@/lib/laneProposal"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const PROD_REF = "ejhnokcnahauvrcbcmic"

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const showLines = process.argv.includes("--lines")

if (!url || !key) {
  console.error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be exported in the shell.\n" +
      "This script does not read .env files."
  )
  process.exit(1)
}
if (url.includes(PROD_REF)) {
  console.error("That is the PROD project ref. This audit runs against dev only.")
  process.exit(1)
}
if (!url.includes(DEV_REF)) {
  console.error(`Expected the dev project ref (${DEV_REF}) in SUPABASE_URL, got: ${url}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// BEFORE: a frozen copy of deriveYearsMax as it stood before the fix, kept here
// only so one run can show both sides. It is deliberately not imported and not
// shared — it is a historical record, and it should NOT be updated if
// deriveYearsMax changes again.
// ---------------------------------------------------------------------------
const OLD_DEGREE_LINE =
  /\b(bachelor|b\.?s\.?|b\.?a\.?|master|m\.?s\.?|mba|associate|juris|j\.?d\.?|ll\.?m\.?|ph\.?d\.?|doctorate)\b/i

const OLD_STAGE_YEARS_MAX: Record<string, number | null> = {
  student: 3,
  early_career: 5,
  mid_career: 10,
  executive: null,
}

function oldDeriveYearsMax(resumeText: string, careerStage: string | null) {
  const gradYears = String(resumeText || "")
    .split(/\r?\n/)
    .filter((line) => OLD_DEGREE_LINE.test(line))
    .flatMap((line) => (line.match(/\b(19|20)\d{2}\b/g) || []).map(Number))
    .filter((y) => y >= 1980 && y <= new Date().getFullYear() + 6)

  if (gradYears.length) {
    const grad = Math.max(...gradYears)
    const since = Math.max(0, new Date().getFullYear() - grad)
    return { years_max: since + HEADROOM_YEARS, rule: `graduated ${grad}` }
  }
  if (careerStage && careerStage in OLD_STAGE_YEARS_MAX) {
    return { years_max: OLD_STAGE_YEARS_MAX[careerStage], rule: `career_stage "${careerStage}"` }
  }
  return { years_max: null, rule: "no ceiling" }
}

const gradOf = (rule: string) => /graduated (\d{4})/.exec(rule)?.[1] ?? "—"

// Lines a human should read when a row moved: whatever mentions a degree, a
// graduation, or a year in an education-ish context.
const INTERESTING =
  /\b(bachelor|master|mba|associate|juris|doctorate|ph\.?d|graduat\w*|class of|university|college|expected)\b/i

async function main() {
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data, error } = await supabase
    .from("client_profiles")
    .select("id, name, resume_text")
    .not("resume_text", "is", null)
    .order("created_at", { ascending: true })
  if (error) throw new Error(`client_profiles: ${error.message}`)

  const { data: targeting, error: tErr } = await supabase
    .from("candidate_targeting")
    .select("profile_id, career_stage")
  if (tErr) throw new Error(`candidate_targeting: ${tErr.message}`)
  const stageOf = new Map((targeting || []).map((t: any) => [t.profile_id, t.career_stage ?? null]))

  const rows = (data || []).filter((r: any) => String(r.resume_text || "").trim().length > 40)
  console.log(`${rows.length} client profiles on dev with a resume\n`)

  let moved = 0
  let gainedYear = 0
  let lostYear = 0
  const movedRows: any[] = []

  for (const r of rows as any[]) {
    const stage = stageOf.get(r.id) ?? null
    const before = oldDeriveYearsMax(r.resume_text, stage)
    const after = deriveYearsMax(r.resume_text, stage)
    const changed = before.years_max !== after.years_max || gradOf(before.rule) !== gradOf(after.rule)

    if (changed) {
      moved++
      movedRows.push(r)
      const b = gradOf(before.rule)
      const a = gradOf(after.rule)
      if (b === "—" && a !== "—") gainedYear++
      if (b !== "—" && a === "—") lostYear++
      console.log(
        `MOVED  ${String(r.name || r.id).slice(0, 34).padEnd(34)} ` +
          `grad ${b.padEnd(5)} -> ${a.padEnd(5)}  ` +
          `years_max ${String(before.years_max).padStart(4)} -> ${String(after.years_max).padStart(4)}  ` +
          `[stage: ${stage ?? "null"}]`
      )
      console.log(`         before: ${before.rule}`)
      console.log(`         after:  ${after.rule}`)
      if (showLines) {
        const lines = String(r.resume_text)
          .split(/\r?\n/)
          .map((l: string) => l.trim())
          .filter((l: string) => l && INTERESTING.test(l))
          .slice(0, 8)
        for (const l of lines) console.log(`           | ${l.slice(0, 110)}`)
      }
      console.log()
    }
  }

  console.log(`\n${"=".repeat(60)}`)
  console.log(`unchanged: ${rows.length - moved}`)
  console.log(`moved:     ${moved}`)
  console.log(`  of those, gained a graduation year that was previously missed: ${gainedYear}`)
  console.log(`  of those, lost a graduation year (was a false one, or is now unmatched): ${lostYear}`)
  if (!showLines && moved) console.log(`\nRe-run with --lines to see each moved resume's education lines.`)
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})
