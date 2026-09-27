// tests/coach/list-controls.test.ts
//
// Search, sort and filter for the people lists.
//
// Pure. The point of pulling this out of the page was that two rosters must
// behave identically, and the only way to hold that is to test the behaviour
// once rather than each page's copy of it.
//
//   npx tsx tests/coach/list-controls.test.ts

import {
  DEFAULT_SORT,
  applyListControls,
  matchesSearch,
  sortRows,
  type FilterGroup,
} from "../../lib/coach/listControls"

let failures = 0
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? "   " + detail : ""}`)
}
const eq = (label: string, got: unknown, want: unknown) => {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  check(label, a === b, a === b ? "" : `got ${a}, wanted ${b}`)
}

const row = (name: string | null, email: string | null = null, created_at: string | null = null) =>
  ({ name, email, created_at })

const people = [
  row("Zoe Siegel", "zoe@example.com", "2026-01-05"),
  row("alex dupuy", "alex@example.com", "2026-03-01"),
  row("Marco Garcia", "marco@example.com", "2026-02-01"),
  row(null, "unnamed@example.com", "2026-04-01"),
]

console.log("\nsort")
eq("A to Z is case-insensitive, so alex comes before Marco",
  sortRows(people, "name_asc").map((p) => p.name ?? p.email),
  ["alex dupuy", "Marco Garcia", "unnamed@example.com", "Zoe Siegel"])
eq("Z to A is the exact reverse",
  sortRows(people, "name_desc").map((p) => p.name ?? p.email),
  ["Zoe Siegel", "unnamed@example.com", "Marco Garcia", "alex dupuy"])
eq("newest first", sortRows(people, "newest").map((p) => p.created_at),
  ["2026-04-01", "2026-03-01", "2026-02-01", "2026-01-05"])
eq("oldest first", sortRows(people, "oldest").map((p) => p.created_at),
  ["2026-01-05", "2026-02-01", "2026-03-01", "2026-04-01"])

// A plain string compare puts "Client 10" before "Client 9", which reads as a
// bug to anyone with numbered clients.
eq("numbers sort as numbers",
  sortRows([row("Client 10"), row("Client 9"), row("Client 1")], "name_asc").map((p) => p.name),
  ["Client 1", "Client 9", "Client 10"])

// An unnamed row is still a person somebody is looking for, so it sorts by
// what it CAN be identified by rather than collapsing to the top.
eq("a row with no name sorts by its email, not as empty",
  sortRows([row("Zoe"), row(null, "adam@example.com")], "name_asc").map((p) => p.name ?? p.email),
  ["adam@example.com", "Zoe"])

// "Unknown" is not "oldest", and it is certainly not "newest".
eq("a row with no date sorts last under newest",
  sortRows([row("A", null, null), row("B", null, "2026-01-01")], "newest").map((p) => p.name),
  ["B", "A"])
eq("and last under oldest too",
  sortRows([row("A", null, null), row("B", null, "2026-01-01")], "oldest").map((p) => p.name),
  ["B", "A"])

check("the default is alphabetical", DEFAULT_SORT === "name_asc")

console.log("\nsearch")
check("matches a name", matchesSearch(row("Marco Garcia", "m@x.com"), "marco"))
check("matches an email", matchesSearch(row("Marco Garcia", "mg@example.com"), "example"))
check("is case-insensitive", matchesSearch(row("Marco Garcia", null), "MARCO"))
check("matches a partial", matchesSearch(row("Marco Garcia", null), "gar"))
// Two words mean both, which is what a person typing them expects.
check("every term must match", !matchesSearch(row("Marco Garcia", null), "marco lily"))
check("a name term and an email term together still match",
  matchesSearch(row("Marco Garcia", "mg@signal.com"), "marco signal"))
check("an empty query matches everything", matchesSearch(row(null, null), "   "))

console.log("\nfilter groups")
const statusGroup: FilterGroup = {
  id: "status", label: "Status", values: ["Active", "Paused", "Archived"],
  all: "All", initial: "Active",
  matches: (r, sel) => r.status === sel,
}
const withStatus = [
  { ...row("Ann"), status: "Active" },
  { ...row("Bob"), status: "Archived" },
  { ...row("Cid"), status: "Paused" },
]
eq("defaults to Active", applyListControls(withStatus, {
  search: "", sort: "name_asc", groups: [statusGroup], selected: {},
}).map((r) => r.name), ["Ann"])
eq("All lets everything through", applyListControls(withStatus, {
  search: "", sort: "name_asc", groups: [statusGroup], selected: { status: "All" },
}).map((r) => r.name), ["Ann", "Bob", "Cid"])
eq("search narrows within the filter", applyListControls(withStatus, {
  search: "b", sort: "name_asc", groups: [statusGroup], selected: { status: "All" },
}).map((r) => r.name), ["Bob"])

// The reason this is a list of groups rather than one filter: an
// engagement-phase group slots in beside status without touching sort,
// search, or the page.
const phaseGroup: FilterGroup = {
  id: "phase", label: "Phase", values: ["Onboarding", "Searching"],
  all: "Any", initial: "Any",
  matches: (r, sel) => r.phase === sel,
}
const withPhase = withStatus.map((r, i) => ({ ...r, phase: i === 0 ? "Onboarding" : "Searching" }))
eq("a second group composes with the first", applyListControls(withPhase, {
  search: "", sort: "name_asc", groups: [statusGroup, phaseGroup],
  selected: { status: "All", phase: "Searching" },
}).map((r) => r.name), ["Bob", "Cid"])

console.log(failures === 0 ? "\nThe roster behaves the same wherever it is." : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
