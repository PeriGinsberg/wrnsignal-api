// Run: npx tsx lib/collab/scope.test.ts
//
// THE AUTHORISATION LADDER, PROVEN. This code had no test before today, which
// is a poor place to start a refactor whose failure mode is a scoping error:
// hand a route the wrong subject and it returns 200 with someone else's data,
// which no type checker and no smoke test would notice.
//
// The subject of these tests is the SEMANTICS, not one function. They were
// written against assertBoardAccess (lib/network-tracker/access.ts) to document
// what shipped, then repointed at resolveScope when that absorbed it. If the
// two ever disagreed, that difference is a behaviour change and these fail.
//
// The fake applies the filters for real, so a query that forgets
// .eq("status", "active") genuinely returns a revoked row and fails a test
// rather than passing on a stub that answers yes to everything.

import { resolveScope, ForbiddenError, type ActorContext } from "./scope"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}
async function throws(label: string, fn: () => Promise<unknown>, wants?: string) {
  try {
    await fn()
    failures++
    console.error(`  FAIL  ${label} (expected a throw, got a value)`)
  } catch (e: any) {
    const isForbidden = e instanceof ForbiddenError
    const msgOk = wants ? String(e?.message || "").includes(wants) : true
    if (isForbidden && msgOk) console.log(`  ok    ${label}`)
    else { failures++; console.error(`  FAIL  ${label} (threw ${e?.constructor?.name}: ${e?.message})`) }
  }
}

const COACH = "profile-coach"
const CLIENT = "profile-client"
const STRANGER = "profile-stranger"

type Row = Record<string, any>

/** A fake PostgREST builder over one scripted coach_clients table. */
function makeFake(rows: Row[]) {
  const calls: Array<{ table: string; filters: Row }> = []
  function builder(table: string) {
    const filters: Row = {}
    const api: any = {
      select() { return api },
      eq(col: string, val: unknown) { filters[col] = val; return api },
      maybeSingle() {
        calls.push({ table, filters: { ...filters } })
        const found = rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
        return Promise.resolve({ data: found ?? null, error: null })
      },
    }
    return api
  }
  return { client: { from: (t: string) => builder(t) } as any, calls }
}

/** The actor, pre-resolved. resolveScope takes this rather than a Request so
 *  the ladder can be tested without a JWT or a network round trip. */
function actor(profileId: string): ActorContext {
  return { actorId: profileId, isCoach: profileId === COACH }
}

function link(over: Row = {}): Row {
  return {
    id: "cc-1",
    coach_profile_id: COACH,
    client_profile_id: CLIENT,
    status: "active",
    access_level: "full",
    ...over,
  }
}

async function main() {
  console.log("\nself")
  {
    const fake = makeFake([])
    const s = await resolveScope(fake.client, actor(CLIENT), { subject: null, require: "write" })
    ok("no subject resolves to the actor", s.subjectId === CLIENT)
    ok("...as role self", s.actorRole === "self")
    ok("...at level owner", s.accessLevel === "owner")
    ok("...and never queries coach_clients", fake.calls.length === 0)
  }
  {
    const fake = makeFake([])
    const s = await resolveScope(fake.client, actor(CLIENT), { subject: CLIENT, require: "write" })
    ok("an explicit subject equal to the actor is still self", s.subjectId === CLIENT)
    ok("...and still short-circuits the lookup", fake.calls.length === 0)
  }

  console.log("\nthe relationship must exist and be active")
  await throws("no coach_clients row at all throws",
    () => resolveScope(makeFake([]).client, actor(COACH), { subject: CLIENT, require: "read" }))
  await throws("a stranger with no row cannot reach a subject",
    () => resolveScope(makeFake([link()]).client, actor(STRANGER), { subject: CLIENT, require: "read" }))
  for (const status of ["paused", "revoked", "pending"]) {
    await throws(`status '${status}' throws`,
      () => resolveScope(makeFake([link({ status })]).client, actor(COACH), { subject: CLIENT, require: "read" }))
  }
  {
    const fake = makeFake([link()])
    const s = await resolveScope(fake.client, actor(COACH), { subject: CLIENT, require: "read" })
    ok("an active link reaches the subject", s.subjectId === CLIENT)
    ok("...as role coach", s.actorRole === "coach")
    ok("...with the actor unchanged", s.actorId === COACH)
    ok("...and the status filter was actually applied",
      fake.calls.some((c) => c.filters.status === "active"))
  }

  console.log("\nthe access ladder")
  {
    const readable = ["view", "annotate", "full"]
    for (const lvl of readable) {
      const s = await resolveScope(makeFake([link({ access_level: lvl })]).client, actor(COACH),
        { subject: CLIENT, require: "read" })
      ok(`'${lvl}' satisfies a read`, s.accessLevel === lvl)
    }
  }
  await throws("'view' does NOT satisfy a write",
    () => resolveScope(makeFake([link({ access_level: "view" })]).client, actor(COACH),
      { subject: CLIENT, require: "write" }))
  {
    const s = await resolveScope(makeFake([link({ access_level: "full" })]).client, actor(COACH),
      { subject: CLIENT, require: "write" })
    ok("'full' satisfies a write", s.accessLevel === "full")
  }
  // 'annotate' vs write is the one rung the product has not decided. The old
  // assertBoardAccess call sites asked for "full" on every write, so that is
  // what is preserved here: write means full, and annotate does not clear it.
  await throws("'annotate' does not satisfy a write (matches the shipped call sites)",
    () => resolveScope(makeFake([link({ access_level: "annotate" })]).client, actor(COACH),
      { subject: CLIENT, require: "write" }))

  console.log("\nthe subject is not forgeable")
  {
    const fake = makeFake([link()])
    const s = await resolveScope(fake.client, actor(COACH), { subject: CLIENT, require: "read" })
    // The branded type is a compile-time guarantee; at runtime the value is the
    // plain uuid, so this asserts the thing that IS observable: the only way to
    // obtain it was through a call that queried the relationship.
    ok("a coach subject is only ever produced after a coach_clients lookup",
      String(s.subjectId) === CLIENT && fake.calls.length === 1)
  }
}

main().then(() => {
  console.log(failures === 0 ? "\nall scope assertions passed\n" : `\n${failures} FAILED\n`)
  process.exit(failures === 0 ? 0 : 1)
})
