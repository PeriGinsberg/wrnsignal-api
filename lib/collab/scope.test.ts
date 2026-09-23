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
import { verifyCoachAccess } from "./access"

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

/**
 * A fake PostgREST builder over two scripted tables: coach_clients and
 * coach_delegates. Filters are applied for real, so a query that forgets
 * .eq("status", "active") genuinely returns a revoked row and fails a test.
 *
 * `.in()` matters as much as `.eq()` now: resolveScope matches the coach column
 * against every coach the caller may act as, and a delegate is exactly the case
 * where that set holds more than one id.
 */
function makeFake(rows: Row[], delegates: Row[] = []) {
  const calls: Array<{ table: string; filters: Row }> = []
  function builder(table: string) {
    const filters: Row = {}
    const ins: Row = {}
    const source = () => (table === "coach_delegates" ? delegates : rows)
    const matches = (r: Row) =>
      Object.entries(filters).every(([k, v]) => r[k] === v) &&
      Object.entries(ins).every(([k, v]) => (v as unknown[]).includes(r[k]))
    const api: any = {
      select() { return api },
      eq(col: string, val: unknown) { filters[col] = val; return api },
      in(col: string, vals: unknown[]) { ins[col] = vals; return api },
      maybeSingle() {
        calls.push({ table, filters: { ...filters, ...ins } })
        return Promise.resolve({ data: source().find(matches) ?? null, error: null })
      },
      // The delegation lookup and the widened coach_clients read await the
      // builder itself rather than calling maybeSingle().
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        calls.push({ table, filters: { ...filters, ...ins } })
        return Promise.resolve(resolve({ data: source().filter(matches), error: null }))
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
    //
    // Two queries now, not one: "which coaches may I act as" (coach_delegates)
    // and then the relationship itself. The guarantee is unchanged, and the
    // self path above still short-circuits both.
    ok("a coach subject is only ever produced after a coach_clients lookup",
      String(s.subjectId) === CLIENT && fake.calls.some((c) => c.table === "coach_clients"))
    ok("...and the delegation set is resolved first",
      fake.calls[0]?.table === "coach_delegates")
  }

  console.log("\ndelegation")
  {
    const PRINCIPAL = "profile-principal"
    const DELEGATE = "profile-delegate"
    const principalLink = link({ coach_profile_id: PRINCIPAL, access_level: "full" })
    const active = [{ delegate_coach_profile_id: DELEGATE, principal_coach_profile_id: PRINCIPAL, status: "active" }]

    {
      const fake = makeFake([principalLink], [])
      await throws("without a delegation the principal's client is out of reach",
        () => resolveScope(fake.client, actor(DELEGATE), { subject: CLIENT, require: "read" }))
    }
    {
      const fake = makeFake([principalLink], active)
      const s = await resolveScope(fake.client, actor(DELEGATE), { subject: CLIENT, require: "write" })
      ok("a delegate reaches the principal's client", String(s.subjectId) === CLIENT)
      ok("...at the level the PRINCIPAL holds", s.accessLevel === "full")
      ok("...recorded as acting through the principal", s.viaCoachId === PRINCIPAL && s.actingAsDelegate === true)
      ok("...while the actor is still the delegate", s.actorId === DELEGATE)
    }
    {
      const fake = makeFake([principalLink], [{ ...active[0], status: "revoked" }])
      await throws("a revoked delegation grants nothing",
        () => resolveScope(fake.client, actor(DELEGATE), { subject: CLIENT, require: "read" }))
    }
    {
      // The principal holds 'view'; the delegate holds 'full' in her own right.
      // A delegation must never LOWER access the caller already had.
      const own = link({ id: "cc-own", coach_profile_id: DELEGATE, access_level: "full" })
      const principalView = link({ id: "cc-p", coach_profile_id: PRINCIPAL, access_level: "view" })
      const fake = makeFake([own, principalView], active)
      const s = await resolveScope(fake.client, actor(DELEGATE), { subject: CLIENT, require: "write" })
      ok("the strongest row wins when both exist", s.accessLevel === "full" && s.viaCoachId === DELEGATE)
    }
    {
      const otherLink = link({ id: "cc-other", coach_profile_id: "profile-other-coach" })
      const fake = makeFake([otherLink], active)
      await throws("a delegate reaches no other coach's client",
        () => resolveScope(fake.client, actor(DELEGATE), { subject: CLIENT, require: "read" }))
    }

    // verifyCoachAccess is the OTHER door into the same rules: the routes that
    // predate resolveScope still call it, and it was left behind when the
    // inline copies were widened, which is how the Job Tracker's detail panel
    // came to refuse a delegate on staging. Same four cases, same answers.
    console.log("\nthe older verifyCoachAccess door")
    {
      const fake = makeFake([principalLink], active)
      const got = await verifyCoachAccess(DELEGATE, CLIENT, "view", fake.client)
      ok("a delegate passes on the principal's row", got?.coach_profile_id === PRINCIPAL)
    }
    {
      const fake = makeFake([principalLink], [{ ...active[0], status: "revoked" }])
      ok("a revoked delegation does not",
        (await verifyCoachAccess(DELEGATE, CLIENT, "view", fake.client)) === null)
    }
    {
      const own = link({ id: "cc-own", coach_profile_id: DELEGATE, access_level: "full" })
      const principalView = link({ id: "cc-p", coach_profile_id: PRINCIPAL, access_level: "view" })
      const fake = makeFake([own, principalView], active)
      const got = await verifyCoachAccess(DELEGATE, CLIENT, "full", fake.client)
      ok("the strongest row still wins", got?.id === "cc-own" && got?.access_level === "full")
    }
    {
      const otherLink = link({ id: "cc-other", coach_profile_id: "profile-other-coach" })
      const fake = makeFake([otherLink], active)
      ok("and no other coach's client is reachable",
        (await verifyCoachAccess(DELEGATE, CLIENT, "view", fake.client)) === null)
    }
    {
      // A 'view' row must not answer a 'full' question, delegation or not.
      const fake = makeFake([link({ coach_profile_id: PRINCIPAL, access_level: "view" })], active)
      ok("the level ladder is unchanged",
        (await verifyCoachAccess(DELEGATE, CLIENT, "full", fake.client)) === null)
    }
  }
}

main().then(() => {
  console.log(failures === 0 ? "\nall scope assertions passed\n" : `\n${failures} FAILED\n`)
  process.exit(failures === 0 ? 0 : 1)
})
