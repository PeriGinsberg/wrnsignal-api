// tests/workbooks/seed-demo-client.ts
//
// Creates the DEV workbook test client jordan+demo@workforcereadynow.com under
// the dev coach peri+devcoach1@workforcereadynow.com, through the REAL
// create-client route handler (not a fourth copy of account creation; see the
// account-creation triplication note). Idempotent: an existing account is
// reported and left alone.
//
// The coach's bearer token comes from a one-time magic-link token minted with
// the admin API and redeemed immediately. No email is sent to anyone.
//
// Credentials from process.env only; refuses anything but the dev project.
//   node --use-system-ca --env-file=.env.local node_modules/tsx/dist/cli.mjs tests/workbooks/seed-demo-client.ts
// Then seed the workbook with scripts/create-workbook.ts (it prints the command).

import { createClient } from "@supabase/supabase-js"

const DEV_REF = "zydrqckpwidipwbhrfgd"
const CLIENT_EMAIL = "jordan+demo@workforcereadynow.com"
const COACH_EMAIL = "peri+devcoach1@workforcereadynow.com"
const CONTENT = "docs/workbooks-v1/workbooks-v1/ryan-hecht_skyhawks-le-coordinator.json"

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
const anon = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
if (!url || !service || !anon) { console.error("Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the anon key"); process.exit(1) }
if (new URL(url).hostname.split(".")[0] !== DEV_REF) { console.error(`Refusing: ${url} is not the dev project`); process.exit(1) }
process.env.SUPABASE_URL = url // the route handler's getSupabaseAdmin() reads this exact name

const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })

async function main() {
  const { data: coach } = await admin.from("client_profiles").select("id, name, is_coach").eq("email", COACH_EMAIL).maybeSingle()
  if (!coach?.is_coach) throw new Error(`${COACH_EMAIL} is not a coach in dev`)

  let { data: client } = await admin.from("client_profiles").select("id, name").eq("email", CLIENT_EMAIL).maybeSingle()

  if (client) {
    console.log(`Exists already: ${client.name} ${client.id}; not creating.`)
  } else {
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email: COACH_EMAIL })
    if (link.error) throw new Error(`coach token: ${link.error.message}`)
    const pub = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const otp = await pub.auth.verifyOtp({ type: "magiclink", token_hash: link.data.properties.hashed_token })
    const token = otp.data.session?.access_token
    if (!token) throw new Error(`coach session: ${otp.error?.message ?? "no session"}`)

    const { POST } = await import("../../app/api/coach/create-client/route")
    const res = await POST(new Request("http://localhost/api/coach/create-client", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        firstName: "Jordan",
        lastName: "Demo",
        email: CLIENT_EMAIL,
        jobType: "Full-time",
        targetRoles: "Live entertainment and event coordination",
        targetLocations: "Atlanta, GA",
        timeframe: "Next 3 months",
      }),
    }) as any)
    const body = await res.json()
    if (!res.ok || !body.ok) throw new Error(`create-client ${res.status}: ${body.error ?? JSON.stringify(body)}`)
    ;({ data: client } = await admin.from("client_profiles").select("id, name").eq("email", CLIENT_EMAIL).maybeSingle())
    if (!client) throw new Error("create-client reported success but no profile was found")
    console.log(`Created ${client.name} ${client.id} under ${coach.name}`)
  }

  const { data: links } = await admin.from("coach_clients").select("status, access_level")
    .eq("client_profile_id", client!.id).eq("coach_profile_id", coach.id)
  console.log(`Link to ${coach.name}: ${JSON.stringify(links)}`)
  console.log(`\nNext:\n  node --use-system-ca --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/create-workbook.ts ${client!.id} ${CONTENT} --yes`)
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
