// Run: npx tsx lib/ingest/link.test.ts
//
// Cross-source linking rules (lib/ingest/link.ts) and the SerpApi title
// cleanup they depend on. Cases come from real dev and prod rows: Point72's
// Greenhouse locations, Guidehouse's Workday counts, prod's "New York City",
// Gong.io vs GONG!, and the bare-Washington rule.

import { citiesOf, employerKey, proposeLinks, sharedCity, type LinkRow } from "./link"
import { cleanTitle } from "./serpapi"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}
const shared = (a: string, b: string) => sharedCity(citiesOf(a), citiesOf(b))
const none = new Map<string, string>()

// ── Employer key ──────────────────────────────────────────────────────────
ok("L.P. stripped", employerKey("Point72 Asset Management, L.P", none) === "point72 asset management")
ok("Inc stripped, trailing space ignored", employerKey("Point72 ", none) === "point72" && employerKey("Accela, Inc.", none) === "accela")
ok("stacked endings stripped", employerKey("Arthur D. Little Services S.A.S.", none) === "arthur d little services")
ok("Group is NOT stripped", employerKey("Capital Group", none) === "capital group")
ok("alias wins", employerKey("JPMorganChase", new Map([["jpmorganchase", "JPMorgan Chase"]])) === "jpmorgan chase")

// ── Cities ────────────────────────────────────────────────────────────────
ok("bare New York = city", shared("New York", "New York, NY") === "new york")
ok("multi-city with semicolon", shared("New York, NY; Stamford, CT", "New York, NY") === "new york")
ok("'or' list", shared("Stamford, CT or New York, NY", "New York, NY (+1 other)") === "new york")
ok("comma list of bare cities", shared("New York, Stamford, London", "New York, NY") === "new york")
ok("state name in a list is a region", citiesOf("Chicago, Florida, New York, San Francisco").map((c) => c.city).join("|") === "chicago|new york|san francisco")
ok("Portland, OR is not split on 'or'", JSON.stringify(citiesOf("Portland, OR")) === JSON.stringify([{ city: "portland", state: "or" }]))
ok("Portland OR vs Portland ME: no match", shared("Portland, OR", "Portland, ME") === null)
ok("New York City = New York", shared("New York City", "New York, NY") === "new york")
ok("NYC and Manhattan = New York", shared("NYC", "New York") === "new york" && shared("Manhattan, NY", "New York, NY") === "new york")
ok("Brooklyn = New York, Brooklyn Park is not", shared("Brooklyn, NY", "New York, NY") === "new york" && shared("Brooklyn Park, MN", "New York, NY") === null)
ok("office / street / leading US cleaned", shared("New York Office", "New York, NY") === "new york" && shared("New York - 245 Park Avenue", "New York") === "new york" && shared("US - New York", "New York, NY") === "new york")
ok("no-comma 'New York NY'", shared("New York NY", "New York, NY") === "new york")
ok("count, remote, anywhere name no city", citiesOf("10 Locations").length === 0 && citiesOf("Remote").length === 0 && citiesOf("Anywhere").length === 0)
ok("DC spellings agree", shared("Washington, DC", "Washington D.C.") === "washington" && shared("DC", "Washington, DC") === "washington")
ok("bare Washington matches DC", shared("Washington", "Washington, DC") === "washington")
ok("bare Washington vs bare Washington: no", shared("Washington", "Washington") === null)
ok("bare Washington vs Seattle, Washington: no", shared("Washington", "Seattle, Washington") === null)

// ── Titles ────────────────────────────────────────────────────────────────
ok("' at <company> <city>' cut", cleanTitle("Sector Analyst, MI-Data at Point72 New York, NY", "Point72") === "Sector Analyst, MI-Data")
ok("'| company | board' cut", cleanTitle("2027 Summer Internship - MS/PhD Data Scientist, Proprietary Research | Point72 | Handshake", "Point72") === "2027 Summer Internship - MS/PhD Data Scientist, Proprietary Research")
ok("unrelated pipe kept", cleanTitle("Privileged Access Architect | IAM Leader & AI Security", "Point72") === "Privileged Access Architect | IAM Leader & AI Security")
ok("idempotent", cleanTitle(cleanTitle("Sector Analyst at Point72 NY", "Point72"), "Point72") === "Sector Analyst")

// ── Proposal ──────────────────────────────────────────────────────────────
let n = 0
const row = (source: string, company: string, title: string, location: string | null, first = "2026-09-01"): LinkRow =>
  ({ id: String(++n).padStart(4, "0"), source, org_slug: null, title, company, location, first_seen_at: first })

const gh = row("grnhse", "Point72 ", "NLP Engineer", "New York")
const serp = row("serpapi", "Point72", "NLP Engineer", "New York, NY", "2026-10-25")
const p1 = proposeLinks([gh, serp], none)
ok("Point72 NLP Engineer links, Greenhouse primary", p1.links.length === 1 && p1.links[0].primary_id === gh.id && p1.links[0].secondary_id === serp.id && p1.links[0].tier === "city")

const wd = row("workday", "guidehouse", "Consulting Analyst - State & Local Government - Campus 2027", "10 Locations")
const gj = row("serpapi", "Guidehouse", "Consulting Analyst - State & Local Government - Campus 2027", "Boston, MA", "2026-10-25")
const p2 = proposeLinks([wd, gj], none)
ok("count-only tier links when one candidate each side", p2.links.length === 1 && p2.links[0].tier === "count_location" && p2.links[0].primary_id === wd.id)

const wd2 = row("workday", "guidehouse", "Consulting Analyst - State & Local Government - Campus 2027", "4 Locations")
const p3 = proposeLinks([wd, wd2, gj], none)
ok("count-only tier refuses two candidates", p3.links.length === 0 && p3.nearMisses.length === 2)

const other = row("grnhse", "Point72", "NLP Engineer", "London")
const p4 = proposeLinks([other, serp], none)
ok("no shared city: near miss, not a link", p4.links.length === 0 && p4.nearMisses.length === 1)

const sr = row("smartrecruiters", "GONG!", "Content Manager", "New York, NY")
const go = row("grnhse", "Gong.io", "Content Manager", "New York, NY")
const p5 = proposeLinks([sr, go], none)
ok("Gong.io vs GONG!: no link, alias only suggested", p5.links.length === 0 && p5.aliasSuggestions.some((a) => a.alias === "gong io" && a.canonical === "gong"))

const ser2 = row("serpapi", "Point72", "Sector Analyst, MI-Data at Point72 New York, NY", "New York, NY", "2026-10-25")
const gh2 = row("grnhse", "Point72", "Sector Analyst, MI-Data", "New York, NY")
ok("stored uncleaned SerpApi title still links", proposeLinks([gh2, ser2], none).links.length === 1)

const a = row("grnhse", "Acme", "Analyst", "Boston, MA", "2026-09-01")
const b = row("workday", "acme", "Analyst", "Boston", "2026-09-05")
const c = row("serpapi", "Acme Inc", "Analyst", "Boston, MA", "2026-10-25")
const p6 = proposeLinks([a, b, c], none)
ok("two direct sources: earlier-seen is primary, no chains", p6.links.length === 2 && p6.links.every((l) => l.primary_id === a.id))

const s1 = row("serpapi", "Acme", "Analyst", "Boston, MA", "2026-10-25")
const s2 = row("serpapi", "Acme", "Analyst", "Boston", "2026-10-26")
ok("two SerpApi rows never link to each other", proposeLinks([s1, s2], none).links.length === 0)

console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
if (failures) process.exit(1)
