// tests/briefs/model.test.ts
//
// The list parsing and the submit gate.
//
// WHY THESE TWO. A brief's list fields are the only structured targeting
// SIGNAL has ever had, and they arrive as whatever a coach typed or pasted.
// Getting "Analyst, analyst" wrong shows the same target twice in the email
// and in the plan; getting the submit gate wrong assigns Erin a campaign with
// nothing to search for.
//
//   npx tsx tests/briefs/model.test.ts
//
// Pure. No database, no network.

import {
  briefLine,
  defaultBriefName,
  toList,
  validateBriefWrite,
  validateForSubmit,
} from "../../lib/briefs/model"

let failures = 0

function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? "   " + detail : ""}`)
}

function eq(label: string, got: unknown, want: unknown): void {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  check(label, a === b, a === b ? "" : `got ${a}, wanted ${b}`)
}

console.log("\ntoList")
eq("takes an array", toList(["Analyst", "Associate"]), ["Analyst", "Associate"])
eq("takes the comma-separated string a coach pastes",
  toList("Analyst, Associate, Strategy"), ["Analyst", "Associate", "Strategy"])
eq("splits newlines and semicolons, because a paste from a document has them",
  toList("Analyst\nAssociate; Strategy"), ["Analyst", "Associate", "Strategy"])
eq("drops the blanks a trailing separator leaves",
  toList("Analyst, , Associate,"), ["Analyst", "Associate"])
// One target, however it was capitalised. The first spelling is the one the
// coach meant, and showing three rows back would read as a bug.
eq("de-duplicates case-insensitively, keeping the first spelling",
  toList("Analyst, analyst, ANALYST"), ["Analyst"])
eq("null is empty", toList(null), [])
eq("undefined is empty", toList(undefined), [])
eq("a number is empty rather than stringified", toList(42), [])

console.log("\nvalidateForSubmit")
eq("a name and one primary role is enough",
  validateForSubmit({ name: "Autumn", primary_roles: ["Analyst"] }), [])
check("no primary role is refused",
  validateForSubmit({ name: "Autumn", primary_roles: [] })[0]?.includes("primary role") === true)
check("a nameless campaign is refused",
  validateForSubmit({ name: "   ", primary_roles: ["Analyst"] }).includes("Give the campaign a name."))
// The form sends the raw string and lets the server split it, so the gate has
// to read it the same way.
eq("a primary role that arrived as a string counts",
  validateForSubmit({ name: "Autumn", primary_roles: "Analyst" as any }), [])
eq("industries and locations are genuinely optional", validateForSubmit({
  name: "Autumn", primary_roles: ["Analyst"],
  primary_industries: [], locations: [], education_status: null,
}), [])

console.log("\nvalidateBriefWrite")
eq("a partial write checks only what was sent",
  validateBriefWrite({ locations: "New York" }, { partial: true }), [])
check("a full write still wants a name",
  validateBriefWrite({}).includes("Give the campaign a name."))
check("a list sent as an object is refused",
  validateBriefWrite({ primary_roles: { a: 1 } }, { partial: true })[0]?.includes("must be a list") === true)
eq("a text field may be cleared to null",
  validateBriefWrite({ education_status: null }, { partial: true }), [])

console.log("\nbriefLine")
eq("roles, then industries, then locations", briefLine({
  primary_roles: ["Analyst"], primary_industries: ["Sports"], locations: ["New York"],
}), "Analyst · Sports · New York")
eq("what is missing is left out, not printed as an empty separator", briefLine({
  primary_roles: ["Analyst"], primary_industries: [], locations: ["Remote"],
}), "Analyst · Remote")

console.log("\ndefaultBriefName")
eq("names the client and the month", defaultBriefName("Lily Stein", new Date(2026, 8, 27)),
  "Lily Stein - September 2026")
eq("still produces a name with no client", defaultBriefName(null, new Date(2026, 8, 27)),
  "Networking campaign - September 2026")

console.log(failures === 0 ? "\nBriefs read the way they are typed." : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
