// Run: npx tsx lib/collab/identity.test.ts
//
// THE EMAIL FALL-THROUGH IN getProfileId, the ONE caller lookup behind
// resolveCaller, lib/collab/scope.ts, coachAuth.ts and meAuth.ts.
//
// By login first, then by email. The email fall-through never takes a profile
// from a LIVE login: that is refused (ForbiddenError, 403) and nothing is
// written. It may claim a profile that is unowned, or owned by a login that no
// longer exists (someone deleted and signed up again with the same email), and
// only on a definite "user not found": an outage must not hand a profile over.
// Driven with a fake client that records writes, so every refusal is proven to
// write nothing.

import { getProfileId } from "./identity"
import { ForbiddenError } from "./errors"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

type Row = { id: string; user_id: string | null; email: string | null }

/**
 * Just enough PostgREST: select/eq/maybeSingle for reads, and
 * update().eq().eq()|is().select() for the conditional claim, which only
 * matches a row still exactly as read. `logins` is auth.users: the ids that
 * exist. `adminError` makes getUserById fail the way an outage would.
 */
function fakeDb(rows: Row[], logins: string[] = [], adminError?: { status: number; code: string }) {
  const writes: Array<{ id: unknown; patch: Record<string, unknown> }> = []
  const adminLookups: string[] = []
  const client: any = {
    auth: {
      admin: {
        async getUserById(id: string) {
          adminLookups.push(id)
          if (adminError) return { data: { user: null }, error: adminError }
          if (logins.includes(id)) return { data: { user: { id } }, error: null }
          return { data: { user: null }, error: { status: 404, code: "user_not_found", message: "User not found" } }
        },
      },
    },
    from() {
      const filters: Record<string, unknown> = {}
      let patch: Record<string, unknown> | null = null
      const match = () => rows.filter((r) => Object.entries(filters).every(([k, v]) => (r as any)[k] === v))
      const api: any = {
        select() {
          if (patch) {
            const hit = match()
            for (const r of hit) { writes.push({ id: r.id, patch: patch! }); Object.assign(r, patch) }
            return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null })
          }
          return api
        },
        update(p: Record<string, unknown>) { patch = p; return api },
        eq(col: string, val: unknown) { filters[col] = val; return api },
        is(col: string, val: unknown) { filters[col] = val; return api },
        maybeSingle() { return Promise.resolve({ data: match()[0] ?? null, error: null }) },
      }
      return api
    },
  }
  return { client, writes, rows, adminLookups }
}

async function refused(p: Promise<unknown>): Promise<any> {
  try { await p; return null } catch (e) { return e }
}

async function main() {
  console.log("a profile a LIVE login owns, matched by email")
  {
    const db = fakeDb([{ id: "p-owner", user_id: "login-A", email: "shared@example.com" }], ["login-A", "login-B"])
    const err = await refused(getProfileId("login-B", "shared@example.com", { supabase: db.client }))
    ok("refused", !!err)
    ok("...as a ForbiddenError, which routeError / errorStatus map to 403", err instanceof ForbiddenError && err.status === 403)
    ok("...after checking the owner's login exists", db.adminLookups.includes("login-A"))
    ok("...and nothing was written", db.writes.length === 0)
    ok("...so the profile still belongs to its owner", db.rows[0].user_id === "login-A")
  }

  console.log("\na profile whose owning login NO LONGER EXISTS (deleted, signed up again)")
  {
    const db = fakeDb([{ id: "p-old", user_id: "login-deleted", email: "back@example.com" }], ["login-new"])
    const id = await getProfileId("login-new", "back@example.com", { supabase: db.client })
    ok("reconnected to the new login", id === "p-old" && db.rows[0].user_id === "login-new")
    ok("...with one write", db.writes.length === 1)
  }
  {
    // Not a "no such login", an outage. Must not count as gone.
    const db = fakeDb([{ id: "p-old", user_id: "login-maybe", email: "flaky@example.com" }], [], { status: 500, code: "unexpected_failure" })
    const err = await refused(getProfileId("login-new", "flaky@example.com", { supabase: db.client }))
    ok("when the login check itself fails, refused (fails closed)", err instanceof ForbiddenError)
    ok("...and nothing was written", db.writes.length === 0 && db.rows[0].user_id === "login-maybe")
  }
  {
    // Two new logins race to reconnect the same orphaned profile. The claim is
    // conditional on user_id still being the dead login, so only one can win.
    const rows: Row[] = [{ id: "p-orphan", user_id: "login-deleted", email: "race2@example.com" }]
    const db = fakeDb(rows, ["login-X", "login-Y"])
    const realFrom = db.client.from
    let raced = false
    db.client.from = () => {
      const api = realFrom()
      const realUpdate = api.update
      api.update = (p: Record<string, unknown>) => {
        if (!raced) { raced = true; rows[0].user_id = "login-Y" }
        return realUpdate(p)
      }
      return api
    }
    const err = await refused(getProfileId("login-X", "race2@example.com", { supabase: db.client }))
    ok("two logins racing to reconnect: the loser is refused", err instanceof ForbiddenError)
    ok("...and the winner keeps the profile", rows[0].user_id === "login-Y")
  }

  console.log("\nthe sign-in paths that must keep working")
  {
    // A coach-created client, or an imported profile, signing in first time.
    const db = fakeDb([{ id: "p-new", user_id: null, email: "client@example.com" }])
    const id = await getProfileId("login-C", "client@example.com", { supabase: db.client })
    ok("an UNOWNED profile is claimed by the first login with its email", id === "p-new" && db.rows[0].user_id === "login-C")
    ok("...without a login check (there is no owner to check)", db.adminLookups.length === 0)
  }
  {
    // Existing client or coach: found by login, whatever the profile's email.
    const db = fakeDb([{ id: "p-mine", user_id: "login-D", email: "old@example.com" }])
    const id = await getProfileId("login-D", "new@example.com", { supabase: db.client })
    ok("an existing login finds its own profile, and nothing is written", id === "p-mine" && db.writes.length === 0)
  }
  {
    // Brand-new user: no profile yet. This lookup never creates one.
    const db = fakeDb([])
    const err = await refused(getProfileId("login-E", "nobody@example.com", { supabase: db.client }))
    ok("a brand-new login with no profile is 'Profile not found'", /^Profile not found$/.test(String(err?.message)))
    ok("...which is NOT a ForbiddenError", !(err instanceof ForbiddenError))
  }

  console.log("\ntwo logins racing for one UNOWNED profile")
  {
    const rows: Row[] = [{ id: "p-race", user_id: null, email: "race@example.com" }]
    const db = fakeDb(rows)
    const realFrom = db.client.from
    let raced = false
    db.client.from = () => {
      const api = realFrom()
      const realUpdate = api.update
      api.update = (p: Record<string, unknown>) => {
        if (!raced) { raced = true; rows[0].user_id = "login-G" }
        return realUpdate(p)
      }
      return api
    }
    const err = await refused(getProfileId("login-F", "race@example.com", { supabase: db.client }))
    ok("the loser of the race is refused", err instanceof ForbiddenError)
    ok("...and the winner keeps the profile", rows[0].user_id === "login-G")
  }

  if (failures) { console.error(`\n${failures} identity assertion(s) failed`); process.exit(1) }
  console.log("\nall identity assertions passed")
}

main().catch((e) => { console.error(e); process.exit(1) })
