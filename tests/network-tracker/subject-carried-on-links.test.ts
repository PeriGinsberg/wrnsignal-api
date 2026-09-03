// Run: npx tsx tests/network-tracker/subject-carried-on-links.test.ts
//
// EVERY LINK INSIDE NETWORKING CARRIES THE SUBJECT.
//
// This test exists because the failure it catches already happened once, in a
// way that no type checker, no unit test and no click-through as a single user
// would have found. ContactRow.tsx and ContactCard.tsx both build a link into
// the contact record; the roster renders the CARD. A grep for `<a href` found
// the row's anchor and missed the card's, which assigns to a `href` variable
// first. The result was a coach clicking a contact, silently landing on their
// OWN board, and getting navy text on a navy ground because the shell no longer
// recognised the page as a client's.
//
// Note what did NOT go wrong there: nothing 404'd, nothing 403'd, no request
// failed. A dropped subject is always a working page about the wrong person.
// So the guard cannot be "does it load" and has to be this: no internal
// networking URL is built without withSubject() unless there is a stated
// reason, and each reason is written down below where it can be argued with.
//
// If this fails on a link you just added, the fix is almost always to wrap it.

import { readdirSync, statSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const ROOT = join(process.cwd(), "app", "dashboard", "network")
const TARGET = "/dashboard/network"

/** Occurrences that are deliberately NOT wrapped, each with the argument for
 *  why. Matched on a distinctive fragment of the line. */
const EXEMPT: Array<{ file: string; contains: string; why: string }> = [
  { file: "authFetch.ts", contains: "pathname.startsWith",
    why: "the gate's own check that the PAGE is a networking page, not a link" },
  { file: "backTarget.ts", contains: "DEFAULT_BACK =",
    why: "a base target; the record wraps it as withSubject(readBackTarget())" },
  { file: "backTarget.ts", contains: "url.startsWith",
    why: "a safety guard on a stored value, not a link" },
  { file: "companies/page.tsx", contains: "router.replace",
    why: "the retired board's redirect, which forwards the WHOLE query string and so carries the subject already" },
  { file: "contacts/page.tsx", contains: "router.replace",
    why: "the legacy roster redirect, same: it forwards qs verbatim" },
  { file: "contacts/[contactId]/page.tsx", contains: "location.assign",
    why: "the post-delete bounce; deleting is owner-only and hidden from a coach, so this is unreachable for one" },
  { file: "DashboardPanels.tsx", contains: "const CONTACTS =",
    why: "the base constant; every link built from it is wrapped at the point of use" },
  { file: "import/page.tsx", contains: "<a href=",
    why: "returns from the import page, which is owner-only and hidden from a coach" },
  { file: "NetworkLanding.tsx", contains: "network/import",
    why: "the Import control itself, hidden from a coach for the same reason" },
]

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if ((e.endsWith(".tsx") || e.endsWith(".ts")) && !e.includes(".test.")) out.push(full)
  }
  return out
}

console.log("internal networking links carry ?client_profile_id")

const usedExemptions = new Set<string>()
let checked = 0

for (const full of walk(ROOT)) {
  const rel = relative(ROOT, full).split("\\").join("/")
  const lines = readFileSync(full, "utf8").split("\n")

  lines.forEach((line, i) => {
    if (!line.includes(TARGET)) return
    // Prose, not a link. Half the mentions of these paths in this tree are
    // comments explaining the redirects, and a comment cannot navigate anyone
    // anywhere.
    const t = line.trim()
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) return
    checked++

    if (line.includes("withSubject(")) {
      ok(`${rel}:${i + 1} wrapped`, true)
      return
    }

    const hit = EXEMPT.find((e) => rel.endsWith(e.file) && line.includes(e.contains))
    if (hit) {
      usedExemptions.add(hit.file + "|" + hit.contains)
      ok(`${rel}:${i + 1} exempt: ${hit.why}`, true)
      return
    }

    ok(`${rel}:${i + 1} builds ${TARGET}... without withSubject() and without a stated reason\n        ${line.trim()}`, false)
  })
}

ok(`something was actually scanned (${checked} live occurrences)`, checked >= 10)

// A stale exemption is its own bug: it means a link was deleted or rewritten
// and the reason for excusing it was never revisited.
console.log("\nno exemption outlives the line it excuses")
for (const e of EXEMPT) {
  ok(`${e.file} "${e.contains}" still exists`, usedExemptions.has(e.file + "|" + e.contains))
}

console.log(failures === 0 ? "\nall link-threading assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
