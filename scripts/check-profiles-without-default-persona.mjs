// scripts/check-profiles-without-default-persona.mjs
//
// F6 verification for Phase 1 Stage 1b: how many profiles in each env have
// NO default persona? Decides whether option (b) — return 400
// no_persona_configured — is safe to ship, or whether legacy zero-persona
// profiles still exist and need migration / option (c) instead.
//
// Read-only. Hits dev and prod sequentially via separate env files.

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

function loadEnv(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=")
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
      }),
  )
}

async function check(label, envPath) {
  console.log(`\n=== ${label}  (${envPath}) ===`)
  const env = loadEnv(envPath)
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log(`  ✗ missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ${envPath}`)
    return
  }
  console.log(`  project: ${env.SUPABASE_URL}`)

  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // All profile IDs (paginate to be safe even though prod is ~122).
  // Default Supabase row limit is 1000 — explicit just in case.
  const { data: profiles, error: profErr } = await sb
    .from("client_profiles")
    .select("id, email")
    .limit(5000)
  if (profErr) {
    console.log(`  ✗ profiles SELECT failed: ${profErr.message}`)
    return
  }

  // Profile IDs that have at least one default persona (is_default=true)
  const { data: defaultPersonas, error: persErr } = await sb
    .from("client_personas")
    .select("profile_id")
    .eq("is_default", true)
    .limit(5000)
  if (persErr) {
    console.log(`  ✗ client_personas SELECT failed: ${persErr.message}`)
    return
  }

  const withDefault = new Set(defaultPersonas.map((r) => r.profile_id))
  const missing = profiles.filter((p) => !withDefault.has(p.id))

  console.log(`  total profiles:               ${profiles.length}`)
  console.log(`  profiles with default persona: ${withDefault.size}`)
  console.log(`  profiles MISSING default:      ${missing.length}`)

  if (missing.length > 0) {
    console.log(`\n  Missing-default profiles (id, email):`)
    for (const p of missing) {
      console.log(`    - ${p.id}  ${p.email ?? "<no email>"}`)
    }
  }
}

await check("DEV", ".env.development.local")
await check("PROD", ".env.production.local")
