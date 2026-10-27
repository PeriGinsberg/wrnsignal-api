// Run: npx tsx tests/supporters/no-coach-tables.test.ts
//
// SUPPORTERS NEVER SEE COACHING NOTES, ASSERTED AGAINST THE SOURCE.
//
// Every supporter route uses the service role, which bypasses RLS, so the only
// thing keeping coach notes and annotations away from a supporter is that the
// routes never read them. This fails if any file under app/api/supporter:
//   - names a coach-only table
//   - selects "*" (a new column would arrive unasked)
//   - embeds a related table in a select (how a coach table arrives by join)
// and if the shared column lists in lib/supporters.ts carry the client's notes.

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

let failures = 0
function ok(label: string, cond: boolean, detail?: string) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`) }
  else console.log(`  ok    ${label}`)
}

const ROOT = process.cwd()
const COACH_ONLY = [
  "coaching_notes",
  "coach_annotations",
  "coach_client_notes",
  "coach_job_recommendations",
  "coach_recommendation_responses",
  "coach_clients",
]

function files(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) files(full, out)
    else if (full.endsWith(".ts")) out.push(full)
  }
  return out
}

const routes = files(join(ROOT, "app/api/supporter"))
ok("found the supporter routes", routes.length >= 6, `found ${routes.length}`)

for (const f of routes) {
  const rel = relative(ROOT, f).replace(/\\/g, "/")
  const src = readFileSync(f, "utf8")
  // Comments may name what is excluded; code may not.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
  for (const t of COACH_ONLY) {
    ok(`${rel} does not read ${t}`, !new RegExp(`["'\`]${t}["'\`]`).test(code))
  }
  ok(`${rel} never selects *`, !/\.select\(\s*["'`][^"'`]*\*/.test(code))
  ok(`${rel} never embeds a related table`, !/\.select\(\s*["'`][^"'`]*\(/.test(code))
}

const lib = readFileSync(join(ROOT, "lib/supporters.ts"), "utf8")
for (const name of ["SUPPORTER_APPLICATION_COLUMNS", "SUPPORTER_INTERVIEW_COLUMNS", "SUPPORTER_PROFILE_COLUMNS"]) {
  const m = lib.match(new RegExp(`export const ${name} =([\\s\\S]*?)\\n\\n`))
  const cols = (m?.[1] ?? "").replace(/["+\s]/g, "").split(",").filter(Boolean)
  ok(`${name} is defined`, cols.length > 0)
  ok(`${name} carries no notes`, !cols.some((c) => /notes?$/.test(c)), cols.join(", "))
  ok(`${name} carries no email`, !cols.includes("email"))
}

console.log(`\n${failures === 0 ? "all passed" : `${failures} failed`}`)
if (failures) process.exit(1)
