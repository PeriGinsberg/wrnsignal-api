#!/usr/bin/env tsx
// tests/jobfit-regression/build-prod-corpus.ts
//
// READ-ONLY prod pull. Builds the LOCAL-ONLY real-pair corpus fixture
// (prod-corpus.local.json) from jobfit_runs. SELECT only — never writes to
// prod, never logs or writes the service-role key.
//
// Reassembles effectiveProfileText exactly as assembleProfileForScoring
// (runJobFitForProfile.ts:240-262). The fixture is the engine INPUT; it is
// gitignored (*.local.json) because it carries real-candidate resume PII.
// oldResult (result_json) is kept ONLY as a local cross-check — the committed
// baseline comes from re-running TODAY's engine, not from oldResult.
//
// USAGE:
//   NODE_OPTIONS=--use-system-ca npx tsx tests/jobfit-regression/build-prod-corpus.ts --count
//   NODE_OPTIONS=--use-system-ca npx tsx tests/jobfit-regression/build-prod-corpus.ts --limit 3
//   NODE_OPTIONS=--use-system-ca npx tsx tests/jobfit-regression/build-prod-corpus.ts        # full pull

import { createClient } from "@supabase/supabase-js"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { mapClientProfileToOverrides } from "../../app/api/_lib/jobfitProfileAdapter"

// ── Env (mirror inspect-prod-runs.ts) ────────────────────────────────────────
function loadEnvLocal() {
  try {
    // @ts-ignore Node 20.6+
    if (typeof process.loadEnvFile === "function") process.loadEnvFile(join(process.cwd(), ".env.local"))
  } catch {
    /* env may already be exported in the shell */
  }
}
loadEnvLocal()

const SB_URL = process.env.SUPABASE_URL
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB_URL || !SB_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).")
  process.exit(1)
}

// Hard prod guard — refuse to run against anything but prod. Prints the HOST
// only (project ref), never the key.
const PROD_REF = "ejhnokcnahauvrcbcmic"
const host = new URL(SB_URL).host
if (!host.startsWith(PROD_REF)) {
  console.error(`REFUSING: SUPABASE_URL host "${host}" is not prod (${PROD_REF}). No query issued.`)
  process.exit(1)
}
console.log(`[build-prod-corpus] prod host confirmed: ${host}`)

const args = process.argv.slice(2)
function argValue(name: string): string | null {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null
}
const COUNT_ONLY = args.includes("--count")
const LIMIT = argValue("--limit") ? Number(argValue("--limit")) : null
const OUT_PATH = join(process.cwd(), "tests/jobfit-regression/prod-corpus.local.json")

const supabase = createClient(SB_URL, SB_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// Strip an embedded "\nResume:\n" block from the profile_text header
// (runJobFitForProfile.ts:240-244).
function stripHeader(profileText: string | null): string {
  let header = String(profileText || "").trim()
  const idx = header.search(/\n\s*Resume:\s*\n/i)
  if (idx !== -1) header = header.slice(0, idx).trim()
  return header
}

// Mirror of assembleProfileForScoring (runJobFitForProfile.ts:240-262).
function reassemble(profileText: string | null, baseResume: string | null, personaResume: string | null): string {
  const header = stripHeader(profileText)
  const activeResume = String(personaResume || "").trim() || String(baseResume || "").trim()
  const parts: string[] = []
  if (header) parts.push(header)
  if (activeResume) parts.push("Resume:\n" + activeResume)
  return parts.join("\n\n")
}

// Redact contact PII for console preview only (handles "(305) 761-1337",
// "305-761-1337", "305.761.1337" and emails). The committed artifact is the
// outputs-only baseline; this only protects the dry-run preview.
function redact(s: string): string {
  return String(s || "")
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, "<email>")
    .replace(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g, "<phone>")
}

async function main() {
  if (COUNT_ONLY) {
    const { count, error } = await supabase
      .from("jobfit_runs")
      .select("*", { count: "exact", head: true })
      .not("job_description", "is", null)
    if (error) throw error
    console.log(`rows with job_description NOT NULL: ${count}`)
    return
  }

  let q = supabase
    .from("jobfit_runs")
    .select("id,client_profile_id,persona_id,job_description,result_json,fingerprint_code,created_at")
    .not("job_description", "is", null)
    .order("created_at", { ascending: false })
  if (LIMIT) q = q.limit(LIMIT)
  const { data: runs, error } = await q
  if (error) throw error
  if (!runs || runs.length === 0) {
    console.log("No rows returned.")
    return
  }

  // Batch the profile/persona joins (avoid N+1).
  const profileIds = [...new Set(runs.map((r) => r.client_profile_id).filter(Boolean))]
  const personaIds = [...new Set(runs.map((r) => r.persona_id).filter(Boolean))]
  const profilesById = new Map<string, any>()
  const personasById = new Map<string, any>()

  for (const c of chunk(profileIds, 100)) {
    const { data, error: e } = await supabase
      .from("client_profiles")
      .select("id,resume_text,profile_text,profile_structured,target_roles,target_locations")
      .in("id", c)
    if (e) throw e
    for (const row of data || []) profilesById.set(row.id, row)
  }
  for (const c of chunk(personaIds, 100)) {
    const { data, error: e } = await supabase
      .from("client_personas")
      .select("id,resume_text")
      .in("id", c)
    if (e) throw e
    for (const row of data || []) personasById.set(row.id, row)
  }

  const fixture = runs.map((r) => {
    const cp = profilesById.get(r.client_profile_id) || {}
    const persona = r.persona_id ? personasById.get(r.persona_id) : null
    const profileText = reassemble(cp.profile_text, cp.resume_text, persona?.resume_text)
    const header = stripHeader(cp.profile_text)
    // profileOverrides derived EXACTLY as the paid path (runJobFitForProfile.ts:257-262).
    const profileStructured =
      typeof cp.profile_structured === "string"
        ? JSON.parse(cp.profile_structured || "null")
        : cp.profile_structured ?? null
    const profileOverrides = mapClientProfileToOverrides({
      profileText: header || profileText,
      profileStructured,
      targetRoles: cp.target_roles ?? null,
      preferredLocations: cp.target_locations ?? null,
    })
    const js = (r.result_json && r.result_json.job_signals) || {}
    return {
      id: r.id,
      label: `prod ${String(r.id).slice(0, 8)} — ${js.jobTitle || "?"} @ ${js.companyName || "?"} (${String(r.created_at).slice(0, 10)})`,
      profileText,
      jobText: String(r.job_description || ""),
      userJobTitle: js.jobTitle || undefined,
      userCompanyName: js.companyName || undefined,
      profileOverrides,
      oldResult: r.result_json,
    }
  })

  writeFileSync(OUT_PATH, JSON.stringify(fixture, null, 2))
  console.log(`Wrote ${fixture.length} rows to ${OUT_PATH} (gitignored)`)

  // ── Reassembly preview for row 0 (PII-redacted) ──────────────────────────
  const r0 = runs[0]
  const cp0 = profilesById.get(r0.client_profile_id) || {}
  const persona0 = r0.persona_id ? personasById.get(r0.persona_id) : null
  const header0 = String(cp0.profile_text || "").trim()
  const hadEmbedded = header0.search(/\n\s*Resume:\s*\n/i) !== -1
  const f0 = fixture[0]
  const seamIdx = f0.profileText.indexOf("\n\nResume:\n")

  console.log("\n=== ROW 0 reassembly preview (redacted) ===")
  console.log("label:", f0.label)
  console.log("client_profile_id present:", Boolean(r0.client_profile_id), "| persona used:", Boolean(persona0))
  console.log("profile_text(header) len:", header0.length, "| embedded 'Resume:' stripped:", hadEmbedded)
  console.log("base resume_text len:", String(cp0.resume_text || "").length, "| persona resume_text len:", String(persona0?.resume_text || "").length)
  console.log("assembled profileText total len:", f0.profileText.length, "| seam at index:", seamIdx)
  console.log("userJobTitle:", f0.userJobTitle, "| userCompanyName:", f0.userCompanyName)
  console.log("jobText len:", f0.jobText.length)
  console.log("\n--- header (first 240 chars, redacted) ---")
  console.log(redact(f0.profileText.slice(0, 240)))
  console.log("\n--- SEAM (±120 chars around the Resume: marker, redacted) ---")
  if (seamIdx >= 0) console.log(redact(f0.profileText.slice(Math.max(0, seamIdx - 120), seamIdx + 130)))
  console.log("\n--- jobText (first 200 chars, redacted) ---")
  console.log(redact(f0.jobText.slice(0, 200)))
  console.log("\n--- oldResult sanity: decision/score ---")
  console.log("oldResult.decision:", r0.result_json?.decision, "| oldResult.score:", r0.result_json?.score)
}

main().catch((e) => {
  console.error("Fatal:", e?.message || String(e))
  process.exit(2)
})
