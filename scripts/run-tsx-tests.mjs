// Runs the repo's ORIGINAL test convention: standalone tsx scripts that assert
// at import time (`app/api/jobfit/*.test.ts` and friends). They predate vitest,
// they work, and they are deliberately not being migrated — this just gives
// them a single entry point so `npm run test:engine` covers them all instead of
// each having to be remembered and run by hand.
//
// Node (not a shell loop) because npm scripts run under cmd.exe on Windows,
// where `for f in ...; do` is a syntax error.
//
// Convention: *.test.ts here, *.test.tsx under vitest. See vitest.config.ts.

import { readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { spawnSync } from "node:child_process"

const ROOTS = ["app", "lib", "tests"]
// `tests/` IS scanned: tests/network-tracker/*.test.ts live there. Only files
// matching *.test.ts are collected, so the jobfit-regression harness scripts
// (retest-*.ts, inspect-*.ts) in the same tree are not picked up.
const SKIP = new Set(["node_modules", ".next", ".git", "signal-mobile"])

function findTests(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) findTests(full, out)
    else if (entry.endsWith(".test.ts")) out.push(full) // .tsx belongs to vitest
  }
  return out
}

const files = ROOTS.flatMap((r) => {
  try { return findTests(r) } catch { return [] }
}).sort()

if (files.length === 0) {
  console.log("No tsx-script tests found.")
  process.exit(0)
}

console.log(`Running ${files.length} tsx-script test file(s)…\n`)
const failed = []
for (const f of files) {
  const rel = relative(process.cwd(), f)
  // Single command STRING, not (cmd, args[]) — passing an args array together
  // with shell:true trips Node's DEP0190 warning.
  const res = spawnSync(`npx tsx "${f}"`, { stdio: "inherit", shell: true })
  if (res.status !== 0) failed.push(rel)
}

console.log("")
if (failed.length) {
  console.error(`✗ ${failed.length} of ${files.length} failed:`)
  for (const f of failed) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ all ${files.length} tsx-script test file(s) passed`)
