// Run: npx tsx lib/network-tracker/link-application.test.ts
//
// The cross-profile boundary, proven rather than asserted in a comment.
//
// The FK added in 20260805_application_company_link.sql can prove a company row
// exists. It cannot prove it belongs to the same person as the application, and
// a CHECK may not reference another table. So the only thing preventing a
// cross-profile link is linkApplicationToCompany comparing two uuids, and this
// file drives THAT function with a fake client rather than testing a helper the
// route might not call.
//
// The fake records every query, so the tests can assert not just the outcome
// but that no write was attempted on a rejected request.

import { linkApplicationToCompany, UNIQUE_VIOLATION } from "./link-application"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const MINE = "profile-mine"
const THEIRS = "profile-theirs"

type Row = Record<string, any>

/**
 * A fake PostgREST builder. Every method returns `this` and the terminal
 * awaits (`maybeSingle`, `single`) resolve against the scripted tables, with
 * the filters actually applied so a query that forgets `.eq("client_profile_id")`
 * genuinely returns the wrong row and fails a test.
 */
function makeFake(tables: Record<string, Row[]>, opts: { insertError?: { code: string } } = {}) {
  const calls: Array<{ table: string; op: string; filters: Row; payload?: Row }> = []

  function builder(table: string) {
    const filters: Row = {}
    let op = "select"
    let payload: Row | undefined
    const api: any = {
      select() { return api },
      insert(p: Row) { op = "insert"; payload = p; return api },
      update(p: Row) { op = "update"; payload = p; return api },
      eq(col: string, val: unknown) { filters[col] = val; return api },
      ilike(col: string, val: string) { filters[`ilike:${col}`] = String(val).toLowerCase(); return api },
      order() { return api },
      limit() { return api },
      maybeSingle() { return api.then_() },
      single() { return api.then_() },
      then_() {
        calls.push({ table, op, filters: { ...filters }, payload })
        const rows = tables[table] ?? []
        if (op === "insert") {
          if (opts.insertError) return Promise.resolve({ data: null, error: opts.insertError })
          const made = { id: `new-${rows.length + 1}`, ...payload }
          rows.push(made)
          return Promise.resolve({ data: made, error: null })
        }
        if (op === "update") {
          const hit = rows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
          if (hit) Object.assign(hit, payload)
          return Promise.resolve({ data: hit ?? null, error: null })
        }
        const found = rows.find((r) =>
          Object.entries(filters).every(([k, v]) =>
            k.startsWith("ilike:")
              ? String(r[k.slice(6)] ?? "").toLowerCase() === v
              : r[k] === v))
        return Promise.resolve({ data: found ?? null, error: null })
      },
      // The update path is awaited without maybeSingle/single.
      then(res: any, rej: any) { return api.then_().then(res, rej) },
    }
    return api
  }

  return { client: { from: (t: string) => builder(t) } as any, calls, tables }
}

async function main() {
  // ── THE BOUNDARY ────────────────────────────────────────────────────────────

  console.log("\ncross-profile rejection")
  {
    const fake = makeFake({
      signal_applications: [{ id: "app-1", profile_id: MINE, company_id: null }],
      network_companies: [{ id: "co-theirs", name: "Globex", client_profile_id: THEIRS }],
    })
    const out = await linkApplicationToCompany(fake.client, MINE, {
      applicationId: "app-1",
      companyId: "co-theirs",
    })
    ok("linking MY application to THEIR company is rejected", out.ok === false)
    ok("...with 403, not 404 or 500", out.ok === false && out.status === 403)
    // A distinct "that company belongs to someone else" would confirm the row
    // exists, which is a fact about another user's board.
    ok("...and the message does not confirm the company exists",
      out.ok === false && out.error === "Not authorized")
    ok("...and NO update was attempted", !fake.calls.some((c) => c.op === "update"))
    ok("...and the application is still unlinked",
      fake.tables.signal_applications[0].company_id === null)
  }

  {
    const fake = makeFake({
      signal_applications: [{ id: "app-theirs", profile_id: THEIRS, company_id: null }],
      network_companies: [{ id: "co-mine", name: "Globex", client_profile_id: MINE }],
    })
    const out = await linkApplicationToCompany(fake.client, MINE, {
      applicationId: "app-theirs",
      companyId: "co-mine",
    })
    ok("linking THEIR application to MY company is rejected", out.ok === false && out.status === 403)
    ok("...and the company was never even looked up",
      !fake.calls.some((c) => c.table === "network_companies"))
  }

  {
    // The by-name path cannot express a cross-profile link at all: both the
    // lookup and the insert pin client_profile_id.
    const fake = makeFake({
      signal_applications: [{ id: "app-1", profile_id: MINE, company_id: null }],
      network_companies: [{ id: "co-theirs", name: "Globex", client_profile_id: THEIRS }],
    })
    const out = await linkApplicationToCompany(fake.client, MINE, {
      applicationId: "app-1",
      companyName: "Globex",
    })
    ok("by-name does NOT find another profile's identically named company",
      out.ok === true && out.companyId !== "co-theirs")
    ok("...it creates one owned by the caller instead", out.ok === true && out.created === true)
    const made = fake.tables.network_companies.find((c) => c.id === (out as any).companyId)
    ok("...with client_profile_id set to the caller", made?.client_profile_id === MINE)
    ok("...and the other profile's company is untouched",
      fake.tables.network_companies.filter((c) => c.client_profile_id === THEIRS).length === 1)
  }

  // ── UNLINK ──────────────────────────────────────────────────────────────────
  // A mislink must be correctable. The suggestion is name-based and the user
  // confirms it, so some confirmations will be wrong, and the migration's
  // ON DELETE SET NULL only fires if the company itself is deleted.

  console.log("\nunlinking")
  {
    const fake = makeFake({
      signal_applications: [{ id: "app-1", profile_id: MINE, company_id: "co-1" }],
      network_companies: [{ id: "co-1", name: "Globex", client_profile_id: MINE }],
    })
    const out = await linkApplicationToCompany(fake.client, MINE, {
      applicationId: "app-1",
      companyId: null,
    })
    ok("company_id: null clears the link", out.ok === true && out.unlinked === true)
    ok("...and reports no company back", out.ok === true && out.companyId === null)
    ok("...and the row is actually NULL", fake.tables.signal_applications[0].company_id === null)
    // The user said "this application is not for that company", not "delete
    // that company". Deleting it would take its contacts with it.
    ok("...and the company row SURVIVES", fake.tables.network_companies.length === 1)
    const upd = fake.calls.find((c) => c.op === "update")
    ok("...and the UPDATE is scoped by profile_id as well as id",
      upd?.filters.id === "app-1" && upd?.filters.profile_id === MINE)
  }

  {
    // Correcting a mistake is not a lesser operation than making one.
    const fake = makeFake({
      signal_applications: [{ id: "app-theirs", profile_id: THEIRS, company_id: "co-theirs" }],
      network_companies: [{ id: "co-theirs", name: "Globex", client_profile_id: THEIRS }],
    })
    const out = await linkApplicationToCompany(fake.client, MINE, {
      applicationId: "app-theirs",
      companyId: null,
    })
    ok("unlinking someone else's application is rejected", out.ok === false && out.status === 403)
    ok("...with NO write attempted", !fake.calls.some((c) => c.op === "update"))
    ok("...and their link intact", fake.tables.signal_applications[0].company_id === "co-theirs")
  }

  {
    const fake = makeFake({
      signal_applications: [{ id: "app-1", profile_id: MINE, company_id: null }],
      network_companies: [],
    })
    const out = await linkApplicationToCompany(fake.client, MINE, { applicationId: "app-1", companyId: null })
    ok("unlinking an already-unlinked application succeeds", out.ok === true && out.unlinked === true)
  }

  {
    // THE REGRESSION THIS GUARDS. If the route collapsed absent into null with
    // `?? null`, every link-by-name request would silently become an unlink.
    const fake = makeFake({
      signal_applications: [{ id: "app-1", profile_id: MINE, company_id: null }],
      network_companies: [{ id: "co-1", name: "Globex", client_profile_id: MINE }],
    })
    const out = await linkApplicationToCompany(fake.client, MINE, {
      applicationId: "app-1",
      companyName: "Globex",
      // companyId deliberately ABSENT, not null.
    })
    ok("an absent company_id is NOT an unlink", out.ok === true && out.unlinked === false)
    ok("...it links by name as normal", out.ok === true && out.companyId === "co-1")
  }

  {
    const fake = makeFake({ signal_applications: [], network_companies: [] })
    const out = await linkApplicationToCompany(fake.client, MINE, { applicationId: "nope", companyId: null })
    ok("unlinking a missing application is a 404", out.ok === false && out.status === 404)
  }

  // ── ORDINARY PATHS ──────────────────────────────────────────────────────────

  console.log("\nlinking by id")
  {
    const fake = makeFake({
      signal_applications: [{ id: "app-1", profile_id: MINE, company_id: null }],
      network_companies: [{ id: "co-1", name: "Globex", client_profile_id: MINE }],
    })
    const out = await linkApplicationToCompany(fake.client, MINE, { applicationId: "app-1", companyId: "co-1" })
    ok("a company I own links", out.ok === true && out.companyId === "co-1")
    ok("...and reports created:false", out.ok === true && out.created === false)
    ok("...and the row is updated", fake.tables.signal_applications[0].company_id === "co-1")
    const upd = fake.calls.find((c) => c.op === "update")
    ok("...and the UPDATE is scoped by profile_id as well as id",
      upd?.filters.id === "app-1" && upd?.filters.profile_id === MINE)
  }

  console.log("\nlinking by name")
  {
    const fake = makeFake({
      signal_applications: [{ id: "app-1", profile_id: MINE, company_id: null }],
      network_companies: [{ id: "co-1", name: "Globex", client_profile_id: MINE }],
    })
    const out = await linkApplicationToCompany(fake.client, MINE, { applicationId: "app-1", companyName: "globex" })
    ok("an existing company matches case-insensitively", out.ok === true && out.companyId === "co-1")
    ok("...and is NOT reported as created", out.ok === true && out.created === false)
    ok("...and no duplicate row was inserted", fake.tables.network_companies.length === 1)
  }
  {
    const fake = makeFake({
      signal_applications: [{ id: "app-1", profile_id: MINE, company_id: null }],
      network_companies: [],
    })
    const out = await linkApplicationToCompany(fake.client, MINE, { applicationId: "app-1", companyName: "  Initech  " })
    ok("a new company is created", out.ok === true && out.created === true)
    ok("...with the name trimmed", fake.tables.network_companies[0].name === "Initech")
  }

  console.log("\n23505 is a success, not an error")
  {
    // The insert loses the race, then the re-read finds the winner. Scripted by
    // seeding the table AND forcing the insert to fail the way Postgres would.
    const fake = makeFake(
      {
        signal_applications: [{ id: "app-1", profile_id: MINE, company_id: null }],
        network_companies: [],
      },
      { insertError: { code: UNIQUE_VIOLATION } },
    )
    // The racing writer commits between our lookup and our insert.
    fake.tables.network_companies.push({ id: "co-race", name: "Globex", client_profile_id: MINE })
    const out = await linkApplicationToCompany(fake.client, MINE, { applicationId: "app-1", companyName: "Globex" })
    ok("a unique violation resolves to the winning row", out.ok === true && out.companyId === "co-race")
    ok("...reported as NOT created, because we did not create it", out.ok === true && out.created === false)
    ok("...and the application is linked to it",
      fake.tables.signal_applications[0].company_id === "co-race")
  }
  {
    const fake = makeFake(
      { signal_applications: [{ id: "app-1", profile_id: MINE, company_id: null }], network_companies: [] },
      { insertError: { code: "42501" } },
    )
    const out = await linkApplicationToCompany(fake.client, MINE, { applicationId: "app-1", companyName: "Globex" })
    ok("a NON-23505 insert error is still a failure", out.ok === false && out.status === 500)
  }

  console.log("\nbad input")
  {
    const fake = makeFake({ signal_applications: [], network_companies: [] })
    const a = await linkApplicationToCompany(fake.client, MINE, { applicationId: "", companyName: "X" })
    ok("no application id is a 400", a.ok === false && a.status === 400)
    const b = await linkApplicationToCompany(fake.client, MINE, { applicationId: "app-1" })
    ok("neither company id nor name is a 400", b.ok === false && b.status === 400)
    ok("...and neither touched the database", fake.calls.length === 0)
  }
  {
    const fake = makeFake({ signal_applications: [], network_companies: [] })
    const out = await linkApplicationToCompany(fake.client, MINE, { applicationId: "nope", companyName: "X" })
    ok("a missing application is a 404", out.ok === false && out.status === 404)
    // Ownership is checked BEFORE anything is created, so a bad application id
    // cannot leave a stray company row behind.
    ok("...and no company was created as a side effect",
      fake.tables.network_companies.length === 0)
  }
}

main().then(() => {
  console.log(failures === 0 ? "\nall link-application assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
})
