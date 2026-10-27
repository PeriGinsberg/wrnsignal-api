// Run: npx tsx lib/collab/supporterScope.test.ts
//
// THE SUPPORTER CHECK, PROVEN. A supporter reaches exactly one thing: a client
// who invited them, while the invite is accepted and live, and while the plan
// flag lets that client have supporters. Every other combination must throw,
// and none of them may fall through to a coach rung.
//
// The fake applies filters for real, so a query that forgets
// .eq("status", "active") genuinely returns a revoked row and fails a test.

import { resolveSupporterScope, authorRole, createdBy, ForbiddenError } from "./scope"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}
async function throws(label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
    failures++
    console.error(`  FAIL  ${label} (expected a throw, got a value)`)
  } catch (e: any) {
    if (e instanceof ForbiddenError) console.log(`  ok    ${label}`)
    else { failures++; console.error(`  FAIL  ${label} (threw ${e?.constructor?.name}: ${e?.message})`) }
  }
}

const LOGIN = "auth-user-mom"
const OTHER_LOGIN = "auth-user-stranger"
const CLIENT = "profile-client"
const OTHER_CLIENT = "profile-other"

type Row = Record<string, any>
type Tables = Record<string, Row[]>

function makeFake(tables: Tables) {
  function builder(table: string) {
    const eqs: Row = {}
    const nulls: string[] = []
    const rows = () =>
      (tables[table] ?? []).filter(
        (r) => Object.entries(eqs).every(([k, v]) => r[k] === v) && nulls.every((k) => r[k] == null),
      )
    const api: any = {
      select() { return api },
      eq(col: string, val: unknown) { eqs[col] = val; return api },
      is(col: string, val: unknown) { if (val === null) nulls.push(col); return api },
      limit() { return api },
      maybeSingle() { return Promise.resolve({ data: rows()[0] ?? null, error: null }) },
      then(resolve: (v: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve(resolve({ data: rows(), error: null }))
      },
    }
    return api
  }
  return { from: (t: string) => builder(t) } as any
}

function supporter(over: Row = {}): Row {
  return { id: "sup-1", supporter_user_id: LOGIN, client_profile_id: CLIENT, status: "active", ...over }
}
const FREE = [{ feature: "supporters", mode: "free" }]

async function main() {
  console.log("\nan accepted, live supporter")
  {
    const db = makeFake({ client_supporters: [supporter()], feature_modes: FREE })
    const s = await resolveSupporterScope(db, { userId: LOGIN }, CLIENT)
    ok("reaches the client who invited them", s.subjectId === CLIENT)
    ok("...as role supporter, never coach or self", s.actorRole === "supporter")
    ok("...at level supporter, which no coach ladder accepts", s.accessLevel === "supporter")
    ok("...carrying the supporter row for attribution", s.supporterId === "sup-1")
    ok("...with the login as actor, not the client", s.actorId === LOGIN)
  }

  console.log("\nthe row must be theirs, for this client, and active")
  await throws("a login with no supporter row throws",
    () => resolveSupporterScope(makeFake({ client_supporters: [supporter()], feature_modes: FREE }), { userId: OTHER_LOGIN }, CLIENT))
  await throws("a supporter cannot reach a different client",
    () => resolveSupporterScope(makeFake({ client_supporters: [supporter()], feature_modes: FREE }), { userId: LOGIN }, OTHER_CLIENT))
  for (const status of ["invited", "revoked", "expired"]) {
    await throws(`status '${status}' throws`,
      () => resolveSupporterScope(makeFake({ client_supporters: [supporter({ status })], feature_modes: FREE }), { userId: LOGIN }, CLIENT))
  }
  await throws("an empty client id throws",
    () => resolveSupporterScope(makeFake({ client_supporters: [supporter()], feature_modes: FREE }), { userId: LOGIN }, ""))

  console.log("\nthe plan flag")
  await throws("mode off pauses an active supporter",
    () => resolveSupporterScope(makeFake({ client_supporters: [supporter()], feature_modes: [{ feature: "supporters", mode: "off" }] }), { userId: LOGIN }, CLIENT))
  await throws("no feature_modes row counts as off",
    () => resolveSupporterScope(makeFake({ client_supporters: [supporter()], feature_modes: [] }), { userId: LOGIN }, CLIENT))
  await throws("mode paid without an entitlement throws",
    () => resolveSupporterScope(makeFake({
      client_supporters: [supporter()],
      feature_modes: [{ feature: "supporters", mode: "paid" }],
      feature_entitlements: [{ id: "e1", client_profile_id: CLIENT, feature: "supporters", revoked_at: "2026-10-01" }],
    }), { userId: LOGIN }, CLIENT))
  {
    const s = await resolveSupporterScope(makeFake({
      client_supporters: [supporter()],
      feature_modes: [{ feature: "supporters", mode: "paid" }],
      feature_entitlements: [{ id: "e1", client_profile_id: CLIENT, feature: "supporters", revoked_at: null }],
    }), { userId: LOGIN }, CLIENT)
    ok("mode paid with a live entitlement reaches the client", s.subjectId === CLIENT)
  }

  console.log("\na supporter never writes author_role rows")
  {
    const s = await resolveSupporterScope(makeFake({ client_supporters: [supporter()], feature_modes: FREE }), { userId: LOGIN }, CLIENT)
    let threw = false
    try { authorRole(s) } catch (e) { threw = e instanceof ForbiddenError }
    ok("authorRole refuses a supporter rather than calling them the client", threw)
    threw = false
    try { createdBy(s) } catch (e) { threw = e instanceof ForbiddenError }
    ok("createdBy refuses a supporter too", threw)
  }

  console.log(`\n${failures === 0 ? "all passed" : `${failures} failed`}`)
  if (failures) process.exit(1)
}

main()
