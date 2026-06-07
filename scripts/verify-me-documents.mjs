#!/usr/bin/env node
// Verification for the client-facing shared-documents read — GET /api/me/documents.
//
// THE PRIVACY WALL is the point: a coached client must see ONLY their own
// shared (visible_to_client=true, not deleted) docs — never private docs, never
// soft-deleted docs, never another client's docs. A coach creates the docs via
// the coach documents API; the client signs in and reads /api/me/documents.
//
// SAFETY: dev-ref guard (aborts on prod). Uses the dev fixture sign-in-able
// clients (alex/brooke/casey) as the logged-in clients and peri+coach1 as the
// coach. Distinct client profiles for A and B (avoids the UNIQUE(coach,client)
// collision). Throwaway docs (title prefix "__me_") + any created relationships
// are cleaned up at start + end.
//
// USAGE:
//   SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<dev_service_role> \
//   NEXT_PUBLIC_SUPABASE_URL=https://zydrqckpwidipwbhrfgd.supabase.co \
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=<dev_anon> \
//   COACH_EMAIL=peri+coach1@workforcereadynow.com \
//   ENDPOINT_BASE=https://wrnsignal-api-staging.vercel.app \
//   node scripts/verify-me-documents.mjs

import { createClient } from "@supabase/supabase-js"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const PROD_REF = "ejhnokcnahauvrcbcmic"
const SUPABASE_URL = process.env.SUPABASE_URL || ""
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL
const NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
const COACH_EMAIL = (process.env.COACH_EMAIL || "peri+coach1@workforcereadynow.com").trim().toLowerCase()
const CLIENT_A_EMAIL = (process.env.CLIENT_A_EMAIL || "alex+test@example.com").trim().toLowerCase()
const CLIENT_B_EMAIL = (process.env.CLIENT_B_EMAIL || "brooke+test@example.com").trim().toLowerCase()
const CLIENT_C_EMAIL = (process.env.CLIENT_C_EMAIL || "casey+test@example.com").trim().toLowerCase()
const TEST_PASSWORD = process.env.TEST_PASSWORD || "dev-test-1234"
const ENDPOINT_BASE = process.env.ENDPOINT_BASE || "http://localhost:3000"
const MARKER_REL = "__verify_me_docs_rel__"
const CAT_MARKER = "__me_privonly_cat__"
const TITLE_PREFIX = "__me_"
const TAG = "[verify-me-documents]"

function abort(msg) { console.error(`✗ ${msg}`); process.exit(1) }
if (!SUPABASE_URL) abort("SUPABASE_URL is required")
if (SUPABASE_URL.includes(PROD_REF)) abort(`REFUSED: SUPABASE_URL contains the PROD ref (${PROD_REF}). Dev only.`)
if (!SUPABASE_URL.includes(DEV_REF)) abort(`REFUSED: SUPABASE_URL must contain dev ref (${DEV_REF}).`)
if (!SUPABASE_SERVICE_ROLE_KEY) abort("SUPABASE_SERVICE_ROLE_KEY is required")
if (!NEXT_PUBLIC_SUPABASE_ANON_KEY) abort("NEXT_PUBLIC_SUPABASE_ANON_KEY is required (sign-in path)")

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const anon = createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)

let pass = true
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`)
  else { pass = false; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`) }
}

async function getToken(email) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: TEST_PASSWORD })
  if (error || !data?.session?.access_token) abort(`Sign-in failed for ${email}: ${error?.message} (is the dev fixture seeded?)`)
  return data.session.access_token
}
async function http(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}
const ME = `${ENDPOINT_BASE}/api/me/documents`
const docsUrl = (relId, path = "") => `${ENDPOINT_BASE}/api/coach/coach-clients/${relId}/documents${path}`
const catUrl = () => `${ENDPOINT_BASE}/api/coach/document-categories`

async function resolveProfileId(email) {
  const { data } = await sb.from("client_profiles").select("id").eq("email", email).maybeSingle()
  if (!data?.id) abort(`No client_profiles row for ${email} (is the dev fixture seeded?)`)
  return data.id
}
// Get-or-create a coach→client relationship (UNIQUE(coach,client) safe).
async function getOrCreateRel(coachId, clientId) {
  const { data: existing } = await sb.from("coach_clients").select("id")
    .eq("coach_profile_id", coachId).eq("client_profile_id", clientId).maybeSingle()
  if (existing?.id) return { id: existing.id, created: false }
  const { data, error } = await sb.from("coach_clients").insert({
    coach_profile_id: coachId, client_profile_id: clientId,
    status: "active", access_level: "full", lifecycle_status: "Active", name: MARKER_REL,
  }).select("id").single()
  if (error) abort(`getOrCreateRel failed: ${error.message}`)
  return { id: data.id, created: true }
}
async function cleanup(clientIds) {
  // Throwaway docs by title prefix, scoped to the test clients.
  await sb.from("coach_client_documents").delete().in("client_profile_id", clientIds).like("title", `${TITLE_PREFIX}%`)
  // The throwaway private-only category (FK ON DELETE SET NULL; docs deleted above).
  await sb.from("coach_document_categories").delete().eq("name", CAT_MARKER)
  // Only relationships WE created (marker name); reused fixture rels survive.
  await sb.from("coach_clients").delete().eq("name", MARKER_REL)
}
// Flatten all doc titles across a /api/me/documents response.
function titlesOf(meJson) { return (meJson?.groups || []).flatMap((g) => (g.documents || []).map((d) => d.title)) }

async function main() {
  console.log(`${TAG} endpoint=${ENDPOINT_BASE} A=${CLIENT_A_EMAIL} B=${CLIENT_B_EMAIL} coach=${COACH_EMAIL}`)

  const coachId = await resolveProfileId(COACH_EMAIL)
  const aId = await resolveProfileId(CLIENT_A_EMAIL)
  const bId = await resolveProfileId(CLIENT_B_EMAIL)
  const cId = await resolveProfileId(CLIENT_C_EMAIL)
  if (new Set([aId, bId, cId]).size !== 3) abort("A, B, C must be distinct client profiles")

  await cleanup([aId, bId, cId])

  const coachToken = await getToken(COACH_EMAIL)
  const aToken = await getToken(CLIENT_A_EMAIL)
  const bToken = await getToken(CLIENT_B_EMAIL)
  const cToken = await getToken(CLIENT_C_EMAIL)

  // Coach categories (lazy seed). catVisible holds a visible doc; catPrivateOnly
  // holds ONLY a private doc (must not surface to the client).
  const cats = (await http(coachToken, "GET", catUrl())).json?.categories || []
  check("coach has categories", cats.length >= 1, `got ${cats.length}`)
  const catVisible = cats[0]
  // Dedicated throwaway category for the private-only test — created THIS run, so
  // its absence from the client read is deterministic (no stray real docs can
  // populate a brand-new category). It holds only a private doc below.
  const catPrivResp = await http(coachToken, "POST", catUrl(), { name: CAT_MARKER })
  check("created throwaway private-only category", catPrivResp.status === 201, `status ${catPrivResp.status} ${JSON.stringify(catPrivResp.json).slice(0,120)}`)
  const catPrivateOnly = catPrivResp.json?.category

  const relA = await getOrCreateRel(coachId, aId)
  const relB = await getOrCreateRel(coachId, bId)

  // Coach authors A's docs.
  console.log("\nSetup: coach authors docs for A and B")
  const mk = async (relId, body) => {
    const r = await http(coachToken, "POST", docsUrl(relId), body)
    check(`POST ${body.title} → 201`, r.status === 201, `status ${r.status} ${JSON.stringify(r.json).slice(0,140)}`)
    return r.json?.document?.id
  }
  await mk(relA.id, { title: `${TITLE_PREFIX}visible`, url: "https://drive.example.com/a-visible", category_id: catVisible.id, visible_to_client: true })
  await mk(relA.id, { title: `${TITLE_PREFIX}private`, url: "https://drive.example.com/a-private", category_id: catVisible.id, visible_to_client: false })
  await mk(relA.id, { title: `${TITLE_PREFIX}privonly`, url: "https://drive.example.com/a-privonly", category_id: catPrivateOnly.id, visible_to_client: false })
  await mk(relA.id, { title: `${TITLE_PREFIX}uncat`, url: "https://drive.example.com/a-uncat", visible_to_client: true })
  const softId = await mk(relA.id, { title: `${TITLE_PREFIX}softdel`, url: "https://drive.example.com/a-softdel", visible_to_client: true })
  await http(coachToken, "DELETE", docsUrl(relA.id, `/${softId}`)) // soft-delete it
  await mk(relB.id, { title: `${TITLE_PREFIX}bvisible`, url: "https://drive.example.com/b-visible", visible_to_client: true })

  // ── A's read: the privacy wall ──
  console.log("\nA's /api/me/documents — privacy wall")
  const aRes = await http(aToken, "GET", ME)
  check("A GET 200", aRes.status === 200, `status ${aRes.status}`)
  const aTitles = titlesOf(aRes.json)
  check("VISIBLE doc appears", aTitles.includes(`${TITLE_PREFIX}visible`))
  check("PRIVATE doc ABSENT", !aTitles.includes(`${TITLE_PREFIX}private`))
  check("private-only-category doc ABSENT", !aTitles.includes(`${TITLE_PREFIX}privonly`))
  check("soft-deleted doc ABSENT", !aTitles.includes(`${TITLE_PREFIX}softdel`))
  check("other client B's doc ABSENT (cross-client isolation)", !aTitles.includes(`${TITLE_PREFIX}bvisible`))
  check("uncategorized visible doc appears", aTitles.includes(`${TITLE_PREFIX}uncat`))

  // ── A's grouping + ordering ──
  console.log("\nA's grouping + ordering")
  const groups = aRes.json?.groups || []
  const groupOf = (title) => groups.find((g) => (g.documents || []).some((d) => d.title === title))
  check("visible doc grouped under its category", groupOf(`${TITLE_PREFIX}visible`)?.name === catVisible.name, groupOf(`${TITLE_PREFIX}visible`)?.name)
  check("uncat doc in 'Uncategorized' group", groupOf(`${TITLE_PREFIX}uncat`)?.name === "Uncategorized")
  check("Uncategorized group is last", groups.length > 0 && groups[groups.length - 1].name === "Uncategorized", JSON.stringify(groups.map((g) => g.name)))
  // Deterministic: catPrivateOnly is a brand-new category this run holding only a
  // private doc, so it must not surface (scoped to THIS run, not "no such category").
  check("throwaway category with ONLY a private doc does NOT appear", !groups.some((g) => g.name === catPrivateOnly.name),
    `groups: ${JSON.stringify(groups.map((g) => g.name))}`)
  // No coach-only fields leak in the per-doc payload.
  const sampleDoc = (groupOf(`${TITLE_PREFIX}visible`)?.documents || [])[0] || {}
  const leakKeys = Object.keys(sampleDoc).filter((k) => !["id", "title", "url"].includes(k))
  check("per-doc payload is minimal (id/title/url only)", leakKeys.length === 0, `extra keys: ${leakKeys.join(",")}`)

  // ── B's read: sees own, not A's ──
  console.log("\nB's /api/me/documents — cross-client isolation")
  const bRes = await http(bToken, "GET", ME)
  const bTitles = titlesOf(bRes.json)
  check("B sees own visible doc", bTitles.includes(`${TITLE_PREFIX}bvisible`))
  check("B does NOT see A's visible doc", !bTitles.includes(`${TITLE_PREFIX}visible`))
  check("B does NOT see A's uncat doc", !bTitles.includes(`${TITLE_PREFIX}uncat`))

  // ── Non-coached / no shared docs → not an error; sees none of THIS run's docs ──
  // Scoped to the throwaway set (the __me_ prefix), NOT "groups empty overall",
  // so stray real dev data for this fixture user can't false-pass or false-fail.
  console.log("\nNon-coached client (C) → ok, sees none of this run's shared docs")
  const cRes = await http(cToken, "GET", ME)
  check("C GET 200 ok (not an error)", cRes.status === 200 && cRes.json?.ok === true, `status ${cRes.status}`)
  check("C sees none of this run's throwaway docs", !titlesOf(cRes.json).some((t) => t.startsWith(TITLE_PREFIX)))

  // ── Auth ──
  console.log("\nAuth")
  const noAuth = await http(null, "GET", ME)
  check("no bearer → 401", noAuth.status === 401, `status ${noAuth.status}`)
  const badAuth = await http("garbage.token.value", "GET", ME)
  check("invalid bearer → 401", badAuth.status === 401, `status ${badAuth.status}`)

  await cleanup([aId, bId, cId])
  console.log("\ncleanup: throwaway docs + created relationships cleared")
  console.log(`\n${pass ? "✓ ALL PASS" : "✗ FAILURES ABOVE"}`)
  process.exit(pass ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
