// Run: npx tsx tests/network-tracker/coach-write-access.test.ts
//
// WHO MAY WRITE TO A NETWORKING BOARD, asserted against the route SOURCE.
//
// This is a source-shape test and that is deliberate. The failure it exists to
// catch is not a wrong return value, it is a route quietly resolving the wrong
// SCOPE: resolveOwnerScope never reads the query string, so a route that keeps
// it after being widened does not 403 a coach, it succeeds against the COACH'S
// OWN board. The response is a 200 with a plausible body. No type checker, no
// integration test against a single account, and no amount of clicking as one
// user would show it.
//
// So the contract under test is: for each route, WHICH resolver is called. That
// is a fact about the file, it is exactly the thing that gets edited by
// accident, and reading it here costs nothing at runtime.
//
// The second half asserts attribution, for the same class of reason: a row that
// records the wrong author is not recoverable later, because the information
// needed to correct it is the information that was not written down.

import { readFileSync } from "node:fs"
import { join } from "node:path"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const ROOT = join(process.cwd(), "app", "api", "network")
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8")

/** The body of one exported handler, so POST and DELETE in one file are
 *  judged separately. */
function handler(src: string, verb: string): string {
  const head = `export async function ${verb}(`
  const at = src.indexOf(head)
  if (at < 0) throw new Error(`no ${verb} handler`)
  const rest = src.slice(at + head.length)
  const next = rest.indexOf("\nexport async function ")
  return next < 0 ? rest : rest.slice(0, next)
}

// ── 1. what a coach with 'full' may now do ──────────────────────────────────
//
// Every one of these was owner-only before coach write access. Each must ask
// for "write", which resolveRequestScope refuses for 'view' and 'annotate'.
const COACH_WRITABLE: Array<[string, string, string]> = [
  ["contacts/route.ts", "POST", "add a contact"],
  ["companies/route.ts", "POST", "add a company"],
  ["contacts/[contactId]/route.ts", "PATCH", "edit a contact"],
  ["companies/[companyId]/route.ts", "PATCH", "edit a company"],
  ["contacts/[contactId]/stage/route.ts", "POST", "move a stage"],
  ["contacts/[contactId]/actions/route.ts", "POST", "log an action"],
  ["contacts/[contactId]/messages/route.ts", "POST", "write a message"],
  ["contacts/[contactId]/messages/route.ts", "PATCH", "edit a draft"],
  ["contacts/[contactId]/messages/route.ts", "DELETE", "discard a draft"],
]

console.log("a coach holding 'full' can act on the client's board")
for (const [file, verb, what] of COACH_WRITABLE) {
  const body = handler(read(file), verb)
  ok(`${verb} ${file} resolves a write scope (${what})`,
    body.includes(`resolveRequestScope(req, supabase, { require: "write" })`))
  ok(`${verb} ${file} does not also fall back to the owner-only resolver`,
    !body.includes("resolveOwnerScope("))
}

// ── 2. what stays owner-only, and why each one is not an oversight ──────────
//
// Read this list as the answer to "what can a coach NOT do". Deleting is the
// theme: a coach may build and advance a board, and may not destroy parts of
// it. Import is here for a different reason (see the note in NetworkLanding):
// its route ignores the subject, so widening it needs its own change.
const OWNER_ONLY: Array<[string, string, string]> = [
  ["contacts/[contactId]/route.ts", "DELETE", "deleting a contact is destructive and has no undo"],
  ["companies/[companyId]/route.ts", "DELETE", "deleting a company loses which firm people belonged to"],
  ["contacts/delete/route.ts", "POST", "bulk delete, same reason at scale"],
  ["contacts/[contactId]/reminder/route.ts", "POST", "a snooze is the client's decision about their own week"],
  ["import/preview/route.ts", "POST", "import does not read the subject"],
  ["import/commit/route.ts", "POST", "import does not read the subject"],
  ["companies/link-application/route.ts", "POST", "writes to signal_applications, out of scope here"],
]

console.log("\nand what it stays unable to do")
for (const [file, verb, why] of OWNER_ONLY) {
  const body = handler(read(file), verb)
  ok(`${verb} ${file} is still owner-only: ${why}`,
    body.includes("resolveOwnerScope(req)") && !body.includes("resolveRequestScope("))
}

// ── 3. attribution is recorded, not defaulted ───────────────────────────────
console.log("\nevery row a coach can create records who created it")

for (const [file, verb] of [
  ["contacts/route.ts", "POST"],
  ["companies/route.ts", "POST"],
] as const) {
  ok(`${verb} ${file} stamps created_by on the insert`,
    handler(read(file), verb).includes("...createdBy(scope)"))
}

for (const [file, verb] of [
  ["contacts/[contactId]/route.ts", "PATCH"],
  ["companies/[companyId]/route.ts", "PATCH"],
] as const) {
  const body = handler(read(file), verb)
  ok(`${verb} ${file} stamps edited_by on the update`, body.includes("editedBy(scope)"))
  // The guard must come FIRST. A no-op PATCH that stamped an editor would
  // rewrite the row's history every time a form saved on blur.
  ok(`${verb} ${file} stamps it only past the "nothing to update" guard`,
    body.indexOf(`error: "nothing to update"`) < body.indexOf("editedBy(scope)"))
}

// author_role used to be the string "client" with the board owner's id, which
// was right only while the owner was the only possible writer.
console.log("\nauthor_role comes from the actor, never from a literal")
for (const file of [
  "contacts/[contactId]/actions/route.ts",
  "contacts/[contactId]/messages/route.ts",
]) {
  const src = read(file)
  ok(`${file} derives author_role from the scope`, src.includes("author_role: authorRole(scope)"))
  ok(`${file} no longer hardcodes author_role: "client"`, !src.includes(`author_role: "client"`))
  ok(`${file} attributes to the ACTOR, not the board owner`,
    src.includes("author_id: scope.actorId") && !src.includes("author_id: scope.subjectId"))
}

// ── 4. the roster never hands a client their coach's profile id ─────────────
{
  const src = read("contacts/route.ts")
  const get = handler(src, "GET")
  ok("the roster selects created_by_id", get.includes("created_by_id"))
  ok("...and destructures it out of the response rather than returning it",
    get.includes("({ created_by_id, ...c })"))
  ok("...leaving two booleans in its place",
    get.includes("added_by_coach:") && get.includes("added_by_you:"))
}

console.log(failures === 0 ? "\nall coach-write assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
