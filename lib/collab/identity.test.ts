// Run: npx tsx lib/collab/identity.test.ts
//
// THE EMAIL FALL-THROUGH IN getProfileId, the one caller lookup behind
// resolveCaller and lib/collab/scope.ts.
//
// By login first, then by email. The email fall-through may only CLAIM an
// unowned profile. A profile another login owns is refused, never re-pointed
// at the caller: re-pointing it handed one person's profile, runs, tracker and
// board to whoever signed in with an email that profile still carried. Driven
// with a fake client that records writes, so a refusal is proven to write
// nothing.

import { getProfileId } from "./identity"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

type Row = { id: string; user_id: string | null; email: string | null }

/**
 * Just enough PostgREST: select/eq/maybeSingle for reads, and
 * update().eq().is().select() for the conditional claim, which only matches a
 * row whose user_id is still null.
 */
function fakeDb(rows: Row[]) {
  const writes: Array<{ id: unknown; patch: Record<string, unknown> }> = []
  const client: any = {
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
  return { client, writes, rows }
}

async function main() {
  console.log("a profile another login owns, matched by email")
  {
    const db = fakeDb([{ id: "p-owner", user_id: "login-A", email: "shared@example.com" }])
    let err: any = null
    try { await getProfileId("login-B", "shared@example.com", { supabase: db.client }) } catch (e) { err = e }
    ok("refused, by default", !!err)
    ok("...with a message routeError maps to 403", /forbidden/i.test(String(err?.message)))
    ok("...and nothing was written", db.writes.length === 0)
    ok("...so the profile still belongs to its owner", db.rows[0].user_id === "login-A")
  }

  console.log("\nthe sign-in paths that must keep working")
  {
    // Coach-created client signing in for the first time, where the profile
    // was made without a login (the create paths normally set user_id).
    const db = fakeDb([{ id: "p-new", user_id: null, email: "client@example.com" }])
    const id = await getProfileId("login-C", "client@example.com", { supabase: db.client })
    ok("an UNOWNED profile is claimed by the first login with its email", id === "p-new" && db.rows[0].user_id === "login-C")
  }
  {
    // Existing client or coach: found by login, whatever the profile's email.
    const db = fakeDb([{ id: "p-mine", user_id: "login-D", email: "old@example.com" }])
    const id = await getProfileId("login-D", "new@example.com", { supabase: db.client })
    ok("an existing login finds its own profile, and nothing is written", id === "p-mine" && db.writes.length === 0)
  }
  {
    // Brand-new user: no profile yet. This lookup never creates one (the
    // profile routes do), and that is unchanged.
    const db = fakeDb([])
    let err: any = null
    try { await getProfileId("login-E", "nobody@example.com", { supabase: db.client }) } catch (e) { err = e }
    ok("a brand-new login with no profile is still 'Profile not found'", /profile not found/i.test(String(err?.message)))
  }

  console.log("\ntwo logins racing for one unowned profile")
  {
    // Login F reads the profile as unowned, then login G claims it before F's
    // write lands. F's claim is conditional on user_id still being null, so it
    // matches nothing and F is refused instead of overwriting G.
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
    let err: any = null
    try { await getProfileId("login-F", "race@example.com", { supabase: db.client }) } catch (e) { err = e }
    ok("the loser of the race is refused", /forbidden/i.test(String(err?.message)))
    ok("...and the winner keeps the profile", rows[0].user_id === "login-G")
  }

  if (failures) { console.error(`\n${failures} identity assertion(s) failed`); process.exit(1) }
  console.log("\nall identity assertions passed")
}

main().catch((e) => { console.error(e); process.exit(1) })
