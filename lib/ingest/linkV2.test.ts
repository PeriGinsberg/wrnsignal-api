// Run: npx tsx lib/ingest/linkV2.test.ts
//
// Linker v2 grouping (lib/ingest/linkV2.ts), offline. Cases are prod postings
// from the 2026-11-02 duplicate measurement, plus the false groups the first
// rules made (non-US cities, store numbers).

import { groupCopies, type CopyRow } from "./linkV2"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

let n = 0
const row = (title: string, company: string, location: string | null, extra: Partial<CopyRow> = {}): CopyRow =>
  ({ id: `p${++n}`, source: "searchapi", title, company, location, ...extra })
const together = (rows: CopyRow[]) => groupCopies(rows).length === 1
const apart = (rows: CopyRow[]) => groupCopies(rows).length === rows.length

ok("U.S. vs US-style punctuation, suffix cleaned, same city", together([
  row("U.S. Private Bank – Program Analyst", "JPMorgan Chase & Co.", "Miami, FL", { cleaned_title: "U.S. Private Bank – Program Analyst" }),
  row("U.S. Private Bank - Program Analyst at JPMorgan Chase & Co. Miami, FL", "JPMorgan Chase & Co.", "Miami, FL", { cleaned_title: "U.S. Private Bank - Program Analyst" }),
]))
ok("JPMorganChase vs JPMorgan Chase & Co.", together([
  row("Lead Credit Officer - Asset Wealth Management - Senior Associate", "JPMorganChase", "Columbus, OH"),
  row("Lead Credit Officer - Asset Wealth Management - Senior Associate", "JPMorgan Chase & Co.", "Columbus, OH"),
]))
ok("legal ending: Tanium Inc vs Tanium", together([
  row("Partner Marketing Manager", "Tanium Inc", "Reston, VA"),
  row("Partner Marketing Manager", "Tanium", "Reston, VA"),
]))
ok("Anywhere joins the job's one city", together([
  row("Digital Project Manager (remote)", "IntuitSolutions", "Philadelphia, PA"),
  row("Digital Project Manager (remote)", "IntuitSolutions", "Anywhere"),
]))
ok("a state joins its own city", together([
  row("Human Resources Analyst", "TriNetX", "Massachusetts"),
  row("Human Resources Analyst", "TriNetX, LLC", "Cambridge, MA"),
]))
ok("a different state does not join a city", apart([
  row("Financial Analyst", "Acme", "Texas"),
  row("Financial Analyst", "Acme", "Miami, FL"),
]))
ok("two states with no city stay apart", apart([
  row("Financial Analyst", "Acme", "Florida"),
  row("Financial Analyst", "Acme", "Texas"),
]))
ok("two cities stay apart, and a vague row joins neither", apart([
  row("Analyst", "Acme", "Miami, FL"),
  row("Analyst", "Acme", "Fort Lauderdale, FL"),
  row("Analyst", "Acme", "United States"),
]))
ok("non-US cities are places: Croydon and Glasgow stay apart", apart([
  row("Graduate Engineer", "AECOM", "Croydon, England, United Kingdom"),
  row("Graduate Engineer", "AECOM", "Glasgow, Scotland, United Kingdom"),
]))
ok("store numbers in the raw title keep stores apart", apart([
  row("Delivery Driver 03177", "Domino's", "Miami, FL", { cleaned_title: "Delivery Driver" }),
  row("Delivery Driver 05179", "Domino's", "Miami, FL", { cleaned_title: "Delivery Driver" }),
]))
ok("a year in the title is not a store number", together([
  row("2027 Financial Advisor Intern", "Plantemoran", "Denver, CO"),
  row("2027 Financial Advisor Intern", "Plante Moran", "Denver, CO (+1 other)"),
]))
ok("different titles stay apart", apart([
  row("Financial Analyst", "Acme", "Miami, FL"),
  row("Senior Financial Analyst", "Acme", "Miami, FL"),
]))

const g = groupCopies([
  row("Business Development Analyst", "Arcadia Capital", "Miami, FL", { apply_link_kind: "republisher", first_seen_at: "2026-10-01T00:00:00Z" }),
  row("Business Development Analyst", "Arcadia Capital", "Miami, FL", { apply_link_kind: "employer", first_seen_at: "2026-10-05T00:00:00Z" }),
  row("Business Development Analyst", "Arcadia Capital", "Florida", { apply_link_kind: "board", first_seen_at: "2026-09-01T00:00:00Z" }),
])[0]
ok("primary is the employer link, over earlier-seen board and republisher", g.primary.apply_link_kind === "employer")
ok("tiers: same city is same_location, the state row is no_city",
  [...g.tiers.values()].sort().join(",") === "no_city,same_location")
const d = groupCopies([
  row("Analyst", "Acme", "New York, NY", { source: "searchapi", apply_link_kind: "employer" }),
  row("Analyst", "Acme", "New York, NY", { source: "grnhse" }),
])[0]
ok("a direct source is primary over any Google Jobs row", d.primary.source === "grnhse")

console.log(failures ? `\n${failures} FAILED` : "\nall passed")
process.exit(failures ? 1 : 0)
