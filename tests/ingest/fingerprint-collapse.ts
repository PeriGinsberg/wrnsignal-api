/**
 * Fingerprint collapse test for 20260918_ingest_schema.sql.
 *
 * Inserts five deliberately-shaped cases into public.postings and reports
 * whether each collapsed onto one row or stayed separate, against what the
 * schema claims. Case 2 asserts a KNOWN LIMIT rather than a success: the
 * fingerprint does not resolve corporate identity, and this test pins that so
 * the limit cannot quietly change without a failing case.
 *
 * Cases 4 and 5 cover the seen-timestamp contract, and case 5 FAILS unless
 * 20260918_postings_touch_last_seen.sql is applied: without that trigger a
 * caller can overwrite first_seen_at.
 *
 * Requires both migrations to be applied first. Run:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     NODE_OPTIONS=--use-system-ca npx tsx tests/ingest/fingerprint-collapse.ts
 *
 * Writes only rows carrying source = '__fingerprint_test__' and deletes them on
 * the way in and the way out, so it cannot touch real ingest data.
 */

import { createClient } from "@supabase/supabase-js"

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment")
  process.exit(1)
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } })

/** Every row this test writes carries it, and nothing else in the table does. */
const MARK = "__fingerprint_test__"

type Row = { title: string; company: string; location: string | null }

const row = (r: Row, extra: Record<string, unknown> = {}) => ({
  source: MARK,
  org_slug: "test",
  title: r.title,
  company: r.company,
  location: r.location,
  ...extra,
})

async function wipe() {
  const { error } = await sb.from("postings").delete().eq("source", MARK)
  if (error) throw new Error("cleanup failed: " + error.message)
}

/** Insert, then read back the distinct fingerprints those inputs produced. */
async function insertAndCount(rows: Row[]) {
  for (const r of rows) {
    const { error } = await sb
      .from("postings")
      .upsert(row(r), { onConflict: "fingerprint", ignoreDuplicates: false })
    if (error) throw new Error("insert failed for " + JSON.stringify(r) + ": " + error.message)
  }
  const { data, error } = await sb
    .from("postings")
    .select("fingerprint, title, company, location, first_seen_at, last_seen_at")
    .eq("source", MARK)
  if (error) throw new Error("readback failed: " + error.message)
  return data || []
}

let failures = 0

function report(name: string, expected: number, actual: number, note?: string) {
  const ok = expected === actual
  if (!ok) failures++
  console.log(
    "\n  " + (ok ? "PASS" : "FAIL") + "  " + name +
    "\n        expected " + expected + " row(s), got " + actual + (note ? "\n        " + note : "")
  )
}

async function case1() {
  console.log("\n=== CASE 1: same job, two location spellings -> expect 1 row ===")
  await wipe()
  const rows: Row[] = [
    { title: "Marketing Analyst", company: "Acme Corp", location: "New York, NY" },
    { title: "Marketing Analyst", company: "Acme Corp", location: "New York, New York, United States" },
  ]
  for (const r of rows) console.log("    in: " + JSON.stringify(r.location))
  const got = await insertAndCount(rows)
  for (const g of got) console.log("    -> fp " + String(g.fingerprint).slice(0, 12) + "  location kept as " + JSON.stringify(g.location))
  report("two location spellings collapse", 1, got.length,
    got.length === 1 ? "raw location stored is whichever arrived last; both spellings map to new york|ny" : undefined)
}

async function case2() {
  console.log("\n=== CASE 2: same job, two company spellings -> expect 2 rows (KNOWN LIMIT) ===")
  await wipe()
  const rows: Row[] = [
    { title: "Marketing Analyst", company: "Macy's", location: "New York, NY" },
    { title: "Marketing Analyst", company: "Macy's, Inc.", location: "New York, NY" },
  ]
  for (const r of rows) console.log("    in: " + JSON.stringify(r.company))
  const got = await insertAndCount(rows)
  for (const g of got) console.log("    -> fp " + String(g.fingerprint).slice(0, 12) + "  " + JSON.stringify(g.company))
  report("company name variants stay separate", 2, got.length,
    "This is the documented limit, not a bug. The fingerprint de-duplicates; it does not resolve corporate identity. Fixing it needs an employer table.")
}

async function case3() {
  console.log("\n=== CASE 3: two different jobs, same company and city -> expect 2 rows ===")
  await wipe()
  const rows: Row[] = [
    { title: "Marketing Analyst", company: "Case Three Corp", location: "New York, NY" },
    { title: "Business Analyst", company: "Case Three Corp", location: "New York, NY" },
  ]
  for (const r of rows) console.log("    in: " + JSON.stringify(r.title))
  const got = await insertAndCount(rows)
  for (const g of got) console.log("    -> fp " + String(g.fingerprint).slice(0, 12) + "  " + JSON.stringify(g.title))
  report("different titles stay separate", 2, got.length,
    got.length === 2 ? undefined : "titles collapsed, which would mean the fingerprint is ignoring title")
}

/** Read the single test row back. */
async function only() {
  const { data, error } = await sb
    .from("postings")
    .select("first_seen_at, last_seen_at")
    .eq("source", MARK)
  if (error) throw new Error("readback failed: " + error.message)
  return { rows: data || [], one: (data || [])[0] }
}

function assert(name: string, ok: boolean, note?: string) {
  if (!ok) failures++
  console.log("  " + (ok ? "PASS" : "FAIL") + "  " + name + (!ok && note ? "\n        " + note : ""))
}

async function case4() {
  console.log("\n=== CASE 4: same job ingested twice -> expect 1 row, last_seen_at advanced ===")
  await wipe()
  const r: Row = { title: "Operations Coordinator", company: "Case Four Corp", location: "Brooklyn, NY" }

  // NEITHER timestamp is sent, on either pass. That is the contract: on insert
  // both columns default to the same now(); on update postings_touch_last_seen
  // advances last_seen_at and pins first_seen_at.
  //
  // Sending last_seen_at here instead would fail with 23514 on the second pass.
  // Postgres runs CHECK constraints on the proposed tuple BEFORE resolving
  // ON CONFLICT, so the absent first_seen_at takes DEFAULT now() and lands
  // ahead of a client-generated last_seen_at.
  const { error: e1 } = await sb
    .from("postings")
    .upsert(row(r), { onConflict: "fingerprint", ignoreDuplicates: false })
  if (e1) throw new Error("first ingest failed: " + e1.message)

  const before = (await only()).one
  console.log("    ingest 1: first_seen=" + before?.first_seen_at + "  last_seen=" + before?.last_seen_at)

  await new Promise((res) => setTimeout(res, 1200))

  const { error: e2 } = await sb
    .from("postings")
    .upsert(row(r), { onConflict: "fingerprint", ignoreDuplicates: false })
  if (e2) throw new Error("second ingest failed: " + e2.message)

  const { rows, one: after } = await only()
  console.log("    ingest 2: first_seen=" + after?.first_seen_at + "  last_seen=" + after?.last_seen_at)

  report("re-ingest does not create a second row", 1, rows.length)
  console.log("")
  assert(
    "last_seen_at advanced on re-ingest",
    !!after && !!before && Date.parse(after.last_seen_at) > Date.parse(before.last_seen_at),
    "last_seen_at did not move, so nothing is recording that the posting is still live"
  )
  assert(
    "first_seen_at unchanged on re-ingest",
    !!after && !!before && Date.parse(after.first_seen_at) === Date.parse(before.first_seen_at),
    "first_seen_at moved, which means the upsert is overwriting it"
  )
}

async function case5() {
  console.log("\n=== CASE 5: re-ingest tries to OVERWRITE first_seen_at -> must be ignored ===")
  await wipe()
  const r: Row = { title: "Data Coordinator", company: "Case Five Corp", location: "Queens, NY" }

  const { error: e1 } = await sb
    .from("postings")
    .upsert(row(r), { onConflict: "fingerprint", ignoreDuplicates: false })
  if (e1) throw new Error("first ingest failed: " + e1.message)

  const before = (await only()).one
  console.log("    ingest 1: first_seen=" + before?.first_seen_at + "  last_seen=" + before?.last_seen_at)

  await new Promise((res) => setTimeout(res, 1200))

  // A deliberately wrong first_seen_at, far enough from now() to be unmistakable
  // if it ever lands. This is the misbehaving-caller case: the trigger has to
  // defend the column rather than trusting every writer to leave it alone.
  const BOGUS = "2020-01-01T00:00:00.000Z"
  const { error: e2 } = await sb
    .from("postings")
    .upsert(row(r, { first_seen_at: BOGUS }), { onConflict: "fingerprint", ignoreDuplicates: false })
  if (e2) throw new Error("second ingest failed: " + e2.message)

  const { rows, one: after } = await only()
  console.log("    ingest 2: sent first_seen_at=" + BOGUS)
  console.log("              stored first_seen=" + after?.first_seen_at + "  last_seen=" + after?.last_seen_at)

  report("overwrite attempt does not create a second row", 1, rows.length)
  console.log("")
  assert(
    "first_seen_at ignored the supplied value",
    !!after && !!before && Date.parse(after.first_seen_at) === Date.parse(before.first_seen_at),
    "first_seen_at was overwritten. Without postings_touch_last_seen any caller can rewrite it."
  )
  assert(
    "first_seen_at is not the bogus value",
    !!after && Date.parse(after.first_seen_at) !== Date.parse(BOGUS),
    "the supplied 2020 timestamp landed in the table"
  )
  assert(
    "last_seen_at still advanced",
    !!after && !!before && Date.parse(after.last_seen_at) > Date.parse(before.last_seen_at),
    "last_seen_at did not move on this update"
  )
}

;(async () => {
  console.log("fingerprint collapse test  ->  " + URL)
  try {
    await case1()
    await case2()
    await case3()
    await case4()
    await case5()
  } finally {
    await wipe()
    console.log("\ntest rows removed (source = '" + MARK + "')")
  }
  console.log(failures === 0 ? "\nALL CASES AS EXPECTED\n" : "\n" + failures + " CASE(S) NOT AS EXPECTED\n")
  process.exit(failures === 0 ? 0 : 1)
})().catch((e) => {
  console.error("\nFAILED: " + e.message)
  process.exit(1)
})
