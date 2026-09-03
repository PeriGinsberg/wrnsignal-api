// Run: npx tsx lib/collab/attribution.test.ts
//
// THE TWO VOCABULARIES, and the translation between them.
//
// Scope.actorRole is RELATIVE and describes the request: the same person is
// "self" on their own board and "coach" on someone else's. The author_role
// columns are ABSOLUTE and describe the row: 'client' means the board's owner
// wrote it, permanently, including when a coach later reads it and is the
// "self" of their own separate request.
//
// Getting this backwards is not a crash. It writes a row that says "self",
// which every later reader has to interpret by asking whose request it was,
// and that is exactly the fact that is gone by then. So the mapping is pinned
// here rather than left to be re-derived at each call site.

import { authorRole, createdBy, editedBy, type Scope, type SubjectId } from "./scope"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const CLIENT = "profile-client"
const COACH = "profile-coach"

const ownerScope: Scope = {
  actorId: CLIENT, actorRole: "self",
  subjectId: CLIENT as SubjectId, accessLevel: "owner",
}
const coachScope: Scope = {
  actorId: COACH, actorRole: "coach",
  subjectId: CLIENT as SubjectId, accessLevel: "full",
}

console.log("actorRole -> author_role")
ok("'self' is stored as 'client', because the row outlives the request",
  authorRole(ownerScope) === "client")
ok("'coach' is stored as 'coach'", authorRole(coachScope) === "coach")

console.log("\ncreated_by")
{
  const owner = createdBy(ownerScope)
  ok("the owner's own row is client-created", owner.created_by_role === "client")
  ok("...attributed to the owner", owner.created_by_id === CLIENT)

  const coach = createdBy(coachScope)
  ok("a coach's row is coach-created", coach.created_by_role === "coach")
  // THE ONE THAT MATTERS. subjectId is the BOARD and actorId is the PERSON,
  // and they differ only in the coach case, which is why using the wrong one
  // survives every test run as the owner and is unfalsifiable afterwards: a
  // row claiming a coach wrote it while carrying the client's id cannot be
  // told apart from a data-entry mistake later.
  ok("...attributed to the COACH, not to the board it landed on",
    coach.created_by_id === COACH && String(coach.created_by_id) !== String(coachScope.subjectId))
}

console.log("\nedited_by")
{
  const before = Date.now()
  const e = editedBy(coachScope)
  ok("records the editing role", e.edited_by_role === "coach")
  ok("records the editing person", e.edited_by_id === COACH)
  // Stamped here rather than by the database, so an update that changes no
  // column cannot claim a fresh timestamp on its way through.
  const t = Date.parse(e.edited_at)
  ok("stamps a real ISO instant, in the client's hand not the DB's",
    Number.isFinite(t) && t >= before && t <= Date.now() + 1000)

  ok("an owner edit is a client edit", editedBy(ownerScope).edited_by_role === "client")
}

console.log("\nthe two halves always come from the same scope")
{
  // createdBy and editedBy each take the WHOLE scope rather than a role and an
  // id, which makes the mismatched pair unrepresentable at the call site.
  const c = createdBy(coachScope)
  const e = editedBy(coachScope)
  ok("role and id can never be crossed between two different actors",
    (c.created_by_role === "coach") === (c.created_by_id === COACH) &&
    (e.edited_by_role === "coach") === (e.edited_by_id === COACH))
}

console.log(failures === 0 ? "\nall attribution assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
