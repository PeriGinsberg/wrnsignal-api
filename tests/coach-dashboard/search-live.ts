#!/usr/bin/env tsx
// Coaches Dashboard client search, live against the local dev server and the
// DEV database: who sees whom. A delegate (erin@) sees her principal's clients
// (peri+devcoach1@) and nobody else's; a coach does not see another coach's
// clients; a client account, no login, and a 1-character query get nothing.
//
// Signs in as dev test accounts WITHOUT a password or an email (an admin
// sign-in link exchanged on the spot). Read-only. DEV ONLY.
//
//   node --use-system-ca --env-file=.env.local --env-file=.env.development.local \
//     node_modules/tsx/dist/cli.mjs tests/coach-dashboard/search-live.ts

import { createClient } from "@supabase/supabase-js"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000"
const DELEGATE = "erin@workforcereadynow.com"
const PRINCIPAL = "peri+devcoach1@workforcereadynow.com"
const OTHER_COACH = "peri+democoach@workforcereadynow.com"
const CLIENT = "peri+demojordan@workforcereadynow.com"

function need(n: string) { const v = process.env[n]; if (!v) { console.error(`${n} is not set.`); process.exit(1) } return v }
const url = need("SUPABASE_URL")
if (!url.includes(DEV_REF)) { console.error("Refusing: SUPABASE_URL is not dev."); process.exit(1) }
const admin = createClient(url, need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } })
const anon = createClient(url, need("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } })

let pass = 0, fail = 0
const ok = (l: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  ok    ${l}`) } else { fail++; console.error(`  FAIL  ${l}${d ? `  (${d})` : ""}`) } }

async function token(email: string) {
  const { data } = await admin.auth.admin.generateLink({ type: "magiclink", email })
  if (!data?.properties?.hashed_token) return null
  const { data: s } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: data.properties.hashed_token })
  return s.session?.access_token ?? null
}
async function search(tok: string | null, q: string) {
  const res = await fetch(`${BASE}/api/coach/clients/search?q=${encodeURIComponent(q)}`, { headers: tok ? { Authorization: `Bearer ${tok}` } : {} })
  const j: any = await res.json().catch(() => ({}))
  return { status: res.status, names: (j.clients ?? []).map((c: any) => c.name) as string[], hrefs: (j.clients ?? []).map((c: any) => c.href) as string[] }
}

/** Display names of a coach's active clients, the same way the route names them. */
async function roster(email: string): Promise<string[]> {
  const { data: coach } = await admin.from("client_profiles").select("id").ilike("email", email).maybeSingle()
  const { data: rels } = await admin.from("coach_clients").select("name, client_profile_id, lifecycle_status").eq("coach_profile_id", coach!.id).eq("status", "active")
  const out: string[] = []
  for (const r of (rels ?? []) as any[]) {
    if (r.lifecycle_status === "Prospect") continue
    let n = r.name?.trim()
    if (!n && r.client_profile_id) n = ((await admin.from("client_profiles").select("name").eq("id", r.client_profile_id).maybeSingle()).data as any)?.name?.trim()
    if (n) out.push(n)
  }
  return out
}

async function main() {
  const principalNames = await roster(PRINCIPAL)
  const otherNames = await roster(OTHER_COACH)
  // A name only the principal has, and one only the other coach has.
  const pick = (mine: string[], theirs: string[]) => mine.find((n) => !theirs.some((t) => t.toLowerCase().split(/\s+/)[0] === n.toLowerCase().split(/\s+/)[0]))
  const pName = pick(principalNames, otherNames)
  const oName = pick(otherNames, principalNames)
  if (!pName || !oName) { console.error("Could not find distinct names on dev."); process.exit(1) }
  const pq = pName.split(/\s+/)[0].slice(0, 4)
  const oq = oName.split(/\s+/)[0].slice(0, 4)
  console.log(`Principal's client: "${pName}" (searching "${pq}"); other coach's client: "${oName}" (searching "${oq}")\n`)

  const erin = await token(DELEGATE)
  const principal = await token(PRINCIPAL)
  const other = await token(OTHER_COACH)
  const client = await token(CLIENT)
  ok("signed in (no password, no email)", !!erin && !!principal && !!other)

  let r = await search(erin, pq)
  ok(`delegate finds her principal's client "${pName}"`, r.status === 200 && r.names.includes(pName), JSON.stringify(r))
  ok("each result links to an existing client page", r.hrefs.every((h) => /^\/dashboard\/coach\/(clients|coach-clients)\/[0-9a-f-]{36}$/.test(h)))
  r = await search(erin, oq)
  ok(`delegate does NOT find another coach's client "${oName}"`, r.status === 200 && !r.names.includes(oName), JSON.stringify(r.names))
  r = await search(principal, pq)
  ok("the principal finds the same client", r.names.includes(pName))
  r = await search(other, pq)
  ok(`a different coach does NOT find "${pName}"`, r.status === 200 && !r.names.includes(pName), JSON.stringify(r.names))
  r = await search(other, oq)
  ok(`that coach finds her own "${oName}"`, r.names.includes(oName))
  const lastName = pName.split(/\s+/).slice(-1)[0]
  if (lastName.length >= 2 && lastName !== pName.split(/\s+/)[0]) {
    r = await search(erin, lastName.slice(0, 3).toUpperCase())
    ok(`matches by last name, any case ("${lastName.slice(0, 3).toUpperCase()}")`, r.names.includes(pName), JSON.stringify(r.names))
  }
  r = await search(erin, pq.slice(0, 1))
  ok("one character returns nothing", r.status === 200 && r.names.length === 0)
  r = await search(erin, "zzqx")
  ok("no match returns an empty list", r.status === 200 && r.names.length === 0)
  r = await search(null, pq)
  ok("no login: refused", r.status === 401, String(r.status))
  if (client) {
    r = await search(client, pq)
    ok("a client account: refused", r.status === 403 || r.status === 401, String(r.status))
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
