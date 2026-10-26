// Run: npx tsx lib/match/rules.test.ts
//
// Hard rules (lib/match/rules.ts) and criteria seeding (lib/match/criteria.ts),
// offline. The rule that matters most: NOT STATED NEVER FAILS.

import { availableFromProfile, parseTimeline, PRESET_STATES, seedCriteria, UnknownPresetError } from "./criteria"
import { applyRules, parseLocations, type MatchPosting } from "./rules"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

// Alex, as decided 2026-10-25: max years 2, Cincinnati added to his lane's three markets.
const { criteria: alex, warnings } = seedCriteria(
  { titles: ["financial analyst", "m&a analyst"], location: { presets: ["chicago", "columbus", "indianapolis"], radius_miles: 50 }, years_max: 3, exclusions: { title_keywords: ["director", "vice president", "head of"] } },
  { id: "alex", job_type: "Full-time", grad_date: "2027-05-28", education_status: "in_school", timeline: "June 2027", target_roles: "financial analyst, M&A analyst" },
  { maxYearsRequired: 2, addPresets: ["cincinnati"] },
)
ok("seed: no warnings, four markets, max years 2, full-time", !warnings.length && alex.markets.map((m) => m.name).join() === "chicago,columbus,indianapolis,cincinnati" && alex.maxYearsRequired === 2 && alex.jobTypes.join() === "full_time")

const blank: MatchPosting = {
  title: "Financial Analyst", company: "Acme", locations: null, remote: null,
  yearsMin: null, yearsMax: null, yearsBasis: null, employmentTypes: null,
  salaryLow: null, salaryHigh: null, salaryPeriod: null, graduationFrom: null, graduationTo: null, level: null,
  startType: null, startDate: null, startSeason: null, startYear: null, campus: null, text: "",
}
const TODAY = "2026-10-25"
const r = (p: Partial<MatchPosting>, c = alex) => applyRules(c, { ...blank, ...p }, TODAY)
const at = (city: string, state: string) => ({ city, state, country: "US" })

ok("nothing stated: passes everything", r({}).length === 0)

// location
ok("Chicago passes", r({ locations: [at("chicago", "il")] }).length === 0)
ok("Cincinnati passes (added market)", r({ locations: [at("cincinnati", "oh")] }).length === 0)
ok("suburb in a covered state passes (distance is the judge's)", r({ locations: [at("downers grove", "il")] }).length === 0)
ok("Houston fails", r({ locations: [at("houston", "tx")] }).join() === "location")
ok("multi-city with one covered city passes", r({ locations: [at("houston", "tx"), at("chicago", "il")] }).length === 0)
ok("remote passes", r({ locations: [at("houston", "tx")], remote: true }).length === 0)
ok("London only fails", r({ locations: [{ city: "london", state: null, country: "GB" }] }).join() === "location")
ok("one unplaceable location passes", r({ locations: [at("houston", "tx"), { city: "somewhere", state: null, country: null }] }).length === 0)
const anywhere = seedCriteria({ location: { presets: [] } }, { id: "x" }).criteria
ok("anywhere client: no location rule", r({ locations: [at("houston", "tx")] }, anywhere).length === 0)
// An unknown city can never widen a search: seeding stops with an error naming
// it, alone or beside known cities, in any case or spacing (2026-10-26).
const seedThrows = (presets: string[]) => { try { seedCriteria({ location: { presets } }, { id: "x" }); return null } catch (e) { return e } }
for (const presets of [["atlantis"], ["chicago", "atlantis"], ["Atlantis", "nyc"], ["chicago", "atlantis", "el dorado"]]) {
  const e = seedThrows(presets)
  ok(`unknown preset stops seeding: ${JSON.stringify(presets)}`, e instanceof UnknownPresetError && /atlantis/i.test((e as Error).message))
}
ok("every unknown preset is named", (seedThrows(["chicago", "atlantis", "el dorado"]) as UnknownPresetError).presets.join() === "atlantis,el dorado")
// The four added 2026-10-26 seed a location rule, and it still rejects elsewhere.
const added = seedCriteria({ location: { presets: ["atlanta", "nashville", "washington_dc", "south_florida"] } }, { id: "x" }).criteria
ok("atlanta, nashville, washington_dc, south_florida seed four markets", added.markets.map((m) => m.name).join() === "atlanta,nashville,washington_dc,south_florida")
ok("added presets: Houston still fails location", r({ locations: [at("houston", "tx")] }, added).join() === "location")
ok("added presets: Atlanta, Nashville, Arlington VA, Miami pass", ["ga", "tn", "va", "fl"].every((st) => r({ locations: [at("x", st)] }, added).length === 0))
// Every known preset seeds a non-empty market: a known name never becomes "anywhere".
ok("every preset in PRESET_STATES has states", Object.entries(PRESET_STATES).every(([, s]) => s.length > 0))
ok("only an empty preset list means anywhere", seedCriteria({ location: { presets: [] } }, { id: "x" }).criteria.markets.length === 0)

// years
ok("3+ required fails at max 2", r({ yearsMin: 3, yearsBasis: "required" }).join() === "years")
ok("2+ required passes at max 2", r({ yearsMin: 2, yearsBasis: "required" }).length === 0)
ok("5+ preferred passes (judge weighs it)", r({ yearsMin: 5, yearsBasis: "preferred" }).length === 0)
ok("0 required passes", r({ yearsMin: 0, yearsMax: 0, yearsBasis: "required" }).length === 0)

// graduation
ok("Class of 2027 window passes a May 2027 grad", r({ graduationFrom: "2027", graduationTo: "2027" }).length === 0)
ok("Dec 2025 - Jun 2026 window fails a May 2027 grad", r({ graduationFrom: "2025-12", graduationTo: "2026-06" }).join() === "graduation")
ok("open-ended 'graduated after May 2024' passes", r({ graduationFrom: "2024-05", graduationTo: null }).length === 0)

// exclusions
ok("Director title fails", r({ title: "Director, FP&A" }).join() === "excluded_title")
ok("word boundary: 'Directory Analyst' passes", r({ title: "Directory Data Analyst" }).length === 0)

// salary floor
const floor = { ...alex, salaryFloor: { amount: 70000, period: "year" as const } }
ok("up to $60,000 fails a $70,000 floor", r({ salaryLow: null, salaryHigh: 60000, salaryPeriod: "year" }, floor).join() === "salary")
ok("$60,000-$80,000 passes (ceiling clears the floor)", r({ salaryLow: 60000, salaryHigh: 80000, salaryPeriod: "year" }, floor).length === 0)
ok("from $50,000 passes (no ceiling)", r({ salaryLow: 50000, salaryHigh: null, salaryPeriod: "year" }, floor).length === 0)
ok("hourly never compared with a yearly floor", r({ salaryLow: 20, salaryHigh: 25, salaryPeriod: "hour" }, floor).length === 0)
ok("no salary floor: no salary rule", r({ salaryLow: 1, salaryHigh: 2, salaryPeriod: "year" }).length === 0)

// job type
ok("internship-only fails a full-time client", r({ employmentTypes: ["internship"] }).join() === "job_type")
ok("internship + full-time passes", r({ employmentTypes: ["internship", "full_time"] }).length === 0)
ok("part-time passes a full-time client (a full-time client pushed one)", r({ employmentTypes: ["part_time", "seasonal"] }).length === 0)
const intern = { ...alex, jobTypes: ["internship"] }
ok("full-time-only fails an internship-only client (2026-10-26: Lindsey Keyes)", r({ employmentTypes: ["full_time"] }, intern).join() === "job_type")
ok("internship + part-time passes an internship client", r({ employmentTypes: ["internship", "part_time"] }, intern).length === 0)
ok("type not stated passes an internship client", r({ employmentTypes: null }, intern).length === 0)

// parseLocations: postings.location strings, as SmartRecruiters / Greenhouse / SearchApi write them
const pl = (s: string) => parseLocations(s)
ok("'London, , United Kingdom' is abroad", JSON.stringify(pl("London, , United Kingdom")) === JSON.stringify([{ city: "London", state: null, country: "United Kingdom" }]))
ok("'Abu Dhabi, UAE, United Arab Emirates' is abroad", pl("Abu Dhabi, UAE, United Arab Emirates")?.[0].country === "United Arab Emirates")
ok("'Chicago, IL, United States' is Chicago", pl("Chicago, IL, United States")?.[0].state === "il")
ok("'Chicago, IL' is Chicago", pl("Chicago, IL")?.[0].state === "il")
ok("'New York, NY; London, , United Kingdom' keeps both", pl("New York, NY; London, , United Kingdom")?.map((l) => l.country).join() === "US,United Kingdom")
ok("'Louisville, Kentucky (KY), United States' is Kentucky", pl("Louisville, Kentucky (KY), United States")?.[0].state === "ky")
ok("'Morrisville, North Carolina (NC), United States' fails Alex", r({ locations: pl("Morrisville, North Carolina (NC), United States") }).join() === "location")
ok("unplaceable stays not stated", pl("Hybrid - Indianapolis, IN") === null && pl("") === null)
ok("London, UK fails Alex", r({ locations: pl("London, , United Kingdom") }).join() === "location")
ok("remote in India fails Alex", r({ locations: pl("Remote, , India"), remote: true }).join() === "location")
ok("remote with no country passes", r({ locations: pl("Remote"), remote: true }).length === 0)
ok("New York or London fails Alex (neither in his states)", r({ locations: pl("New York, NY; London, , United Kingdom") }).join() === "location")
ok("Chicago or London passes Alex", r({ locations: pl("Chicago, IL; London, , United Kingdom") }).length === 0)

// profile -> available_from (2026-10-26)
{
  const d = "2026-10-26"
  ok("timeline month wins", availableFromProfile({ timeline: "June 2027", grad_date: "2027-05-10", education_status: "in_school" }, d).date === "2027-06-01")
  ok("in school, future graduation", JSON.stringify(availableFromProfile({ timeline: "6-12 months", grad_date: "2027-05-10", education_status: "in_school" }, d)) === JSON.stringify({ date: "2027-05-10", source: "graduation" }))
  ok("relative months", JSON.stringify(availableFromProfile({ timeline: "1-3 months" }, d)) === JSON.stringify({ date: "2026-11-26", source: "relative" }))
  ok("Now / Actively looking: available now", availableFromProfile({ timeline: "Now" }, d).date === null && availableFromProfile({ timeline: "Actively looking", grad_date: "2025-05-12", education_status: "graduated" }, d).date === null)
  ok("past season stays a past date", availableFromProfile({ timeline: "Summer 2026" }, d).date === "2026-06-01")
}

// timeline -> available_from
ok("Alex's timeline seeds available_from 2027-06-01", alex.availableFrom === "2027-06-01")
ok("'Summer 2027' -> 2027-06-01", parseTimeline("Summer 2027") === "2027-06-01")
ok("'Fall 2026' -> 2026-09-01", parseTimeline("Fall 2026") === "2026-09-01")
ok("relative timelines give no date", parseTimeline("Now") === null && parseTimeline("6-12 months") === null && parseTimeline("Actively looking") === null && parseTimeline(null) === null)

// start timing (Alex free from 2027-06-01; today 2026-10-25)
ok("start not stated passes", r({}).length === 0)
ok("immediate start fails Alex", r({ startType: "immediate" }).join() === "start")
ok("Jan 11 2027 internship start fails Alex", r({ startType: "date", startDate: "2027-01-11" }).join() === "start")
ok("June 15 2027 start passes", r({ startType: "date", startDate: "2027-06-15" }).length === 0)
ok("May 15 2027 start passes (within a month of June 1)", r({ startType: "date", startDate: "2027-05-15" }).length === 0)
ok("Summer 2027 passes", r({ startType: "season", startSeason: "summer", startYear: 2027 }).length === 0)
ok("Spring 2027 fails (over by May 31)", r({ startType: "season", startSeason: "spring", startYear: 2027 }).join() === "start")
ok("Fall 2026 fails", r({ startType: "season", startSeason: "fall", startYear: 2026 }).join() === "start")
const now = { ...alex, availableFrom: null }
ok("client with no available_from: no start rule", r({ startType: "immediate" }, now).length === 0)
const soon = { ...alex, availableFrom: "2026-11-10" }
ok("immediate passes a client free within a month", r({ startType: "immediate" }, soon).length === 0)

console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
if (failures) process.exit(1)
