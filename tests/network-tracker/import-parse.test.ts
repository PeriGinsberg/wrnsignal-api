// tests/network-tracker/import-parse.test.ts
// Run: npx tsx --test tests/network-tracker/import-parse.test.ts
//
// Env-free parse regression. Test 1 (inline CSV) always runs. Tests 2-3 read
// real files from the git-ignored network-import-fixtures/ — they parse REAL
// client lists from different writers (this file class is the target, so one
// passing file isn't proof). Reads at runtime and SKIPS when the dir is absent
// (clean checkout / CI), so it never breaks a build.

import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { parseFile, detectHeaderRow, dataRows } from "../../lib/network-tracker/import-parse"
import { guessMapping } from "../../lib/network-tracker/import-fields"

// 1. Inline CSV — committed, always runs.
test("CSV: header detected under title/blank rows; mapping guessed", async () => {
  const csv = [
    "My outreach list,,,",
    ",,,",
    "Name,Company,Title,Email",
    "Jane Smith,Acme,VP,jane@acme.com",
    "Bob Lee,Globex,Analyst,bob@globex.com",
  ].join("\n")
  const { grid } = await parseFile(Buffer.from(csv), "list.csv")
  const hr = detectHeaderRow(grid)
  assert.equal(grid[hr][0], "Name")
  assert.deepEqual(guessMapping(grid[hr]), ["name", "company", "title", "email"])
  assert.equal(dataRows(grid, hr).length, 2)
})

// 2. Every real fixture parses to a usable grid (header + data rows).
const FIX_DIR = "network-import-fixtures"
const fixtures = fs.existsSync(FIX_DIR)
  ? fs.readdirSync(FIX_DIR).filter((f) => /\.(xlsx|csv)$/i.test(f))
  : []

if (fixtures.length === 0) {
  test("import fixtures (skipped — network-import-fixtures/ is empty)", { skip: true }, () => {})
}
for (const f of fixtures) {
  test(`fixture: ${f} parses to a usable grid`, async () => {
    const { grid } = await parseFile(fs.readFileSync(path.join(FIX_DIR, f)), f)
    assert.ok(grid.length > 0, "no rows parsed")
    const hr = detectHeaderRow(grid)
    assert.ok((grid[hr] ?? []).filter(Boolean).length >= 2, "no header row found")
    assert.ok(dataRows(grid, hr).length > 0, "no data rows")
  })
}

// 3. maleri.xlsx — the prefixed-namespace workbook exceljs could not read.
const MALERI = path.join(FIX_DIR, "maleri.xlsx")
if (fs.existsSync(MALERI)) {
  test("maleri.xlsx: namespace-prefixed workbook parses, header on row 4, 48 rows", async () => {
    const { sheets, grid } = await parseFile(fs.readFileSync(MALERI), "maleri.xlsx")
    assert.deepEqual(sheets, ["Soft IP Contacts", "Dashboard", "Outreach Guide"])
    const hr = detectHeaderRow(grid)
    assert.equal(hr, 3, "header should be spreadsheet row 4 (index 3)")
    assert.equal(grid[hr][0], "Outreach Rank")
    assert.equal(grid[hr][2], "Contact")
    assert.equal(grid[hr][11], "Personalization Sentence")
    assert.equal(dataRows(grid, hr).length, 48)
    assert.equal(dataRows(grid, hr)[0][2], "Zoe Lyon")
  })
} else {
  test("maleri.xlsx regression (skipped — fixture not present)", { skip: true }, () => {})
}
