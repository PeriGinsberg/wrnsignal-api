// Run: npx tsx lib/collab/identity.test.ts
//
// THE EMAIL FALL-THROUGH, and the refusal Positioning and Cover Letter keep.
//
// getProfileId finds the caller's profile by login, then by email. When the
// email matches a profile that ANOTHER login owns, the default re-points that
// profile at the caller, which hands them someone else's profile, runs and
// board. The scope-based Positioning and Cover Letter routes opt into
// refuseOwnedEmailMatch so they refuse instead, as getAuthedProfileText always
// did. Driven with a fake client that records writes, so the refusal is proven
// to write nothing.

import { getProfileId } from "./identity"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

type Row = { id: string; user_id: string | null; email: string | null }

function fakeDb(rows: Row[]) {
  const updates: Array<{ id: unknown; patch: Record<string, unknown> }> = []
  const client: any = {
    from() {
      const filters: Record<string, unknown> = {}
      let patch: Record<string, unknown> | null = null
      const api: any = {
        select() { return api },
        update(p: Record<string, unknown>) { patch = p; return api },
        eq(col: string, val: unknown) {
          filters[col] = val
          if (patch) {
            updates.push({ id: val, patch })
            const row = rows.find((r) => r.id === val)
            if (row && "user_id" in patch) row.user_id = patch.user_id as string
            return Promise.resolve({ error: null })
          }
          return api
        },
        maybeSingle() {
          const hit = rows.find((r) => Object.entries(filters).every(([k, v]) => (r as any)[k] === v))
          return Promise.resolve({ data: hit ?? null, error: null })
        },
      }
      return api
    },
  }
  return { client, updates, rows }
}

async function main() {
  console.log("a profile another login owns, matched by email")
  {
    const db = fakeDb([{ id: "p-owner", user_id: "login-A", email: "shared@example.com" }])
    let err: any = null
    try {
      await getProfileId("login-B", "shared@example.com", { refuseOwnedEmailMatch: true, supabase: db.client })
    } catch (e) { err = e }
    ok("strict: refused", !!err)
    ok("...with a message routeError maps to 403", /forbidden/i.test(String(err?.message)))
    ok("...and nothing was written", db.updates.length === 0)
    ok("...so the profile still belongs to its owner", db.rows[0].user_id === "login-A")
  }
  {
    // The default every network route still uses: documents the behaviour
    // the strict option exists to refuse.
    const db = fakeDb([{ id: "p-owner", user_id: "login-A", email: "shared@example.com" }])
    const id = await getProfileId("login-B", "shared@example.com", { supabase: db.client })
    ok("default: the profile is re-pointed at the caller (the hole)", id === "p-owner" && db.rows[0].user_id === "login-B")
  }

  console.log("\nthe legitimate cases are unchanged by strict")
  {
    // A coach-created client signing in for the first time.
    const db = fakeDb([{ id: "p-new", user_id: null, email: "client@example.com" }])
    const id = await getProfileId("login-C", "client@example.com", { refuseOwnedEmailMatch: true, supabase: db.client })
    ok("strict: an UNOWNED profile is still attached", id === "p-new" && db.rows[0].user_id === "login-C")
  }
  {
    const db = fakeDb([{ id: "p-mine", user_id: "login-D", email: "old@example.com" }])
    const id = await getProfileId("login-D", "new@example.com", { refuseOwnedEmailMatch: true, supabase: db.client })
    ok("strict: the caller's own profile is found by login, whatever its email", id === "p-mine" && db.updates.length === 0)
  }
  {
    const db = fakeDb([])
    let err: any = null
    try { await getProfileId("login-E", "nobody@example.com", { refuseOwnedEmailMatch: true, supabase: db.client }) } catch (e) { err = e }
    ok("strict: no profile at all is still 'Profile not found'", /profile not found/i.test(String(err?.message)))
  }

  if (failures) { console.error(`\n${failures} identity assertion(s) failed`); process.exit(1) }
  console.log("\nall identity assertions passed")
}

main().catch((e) => { console.error(e); process.exit(1) })
