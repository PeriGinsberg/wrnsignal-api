#!/usr/bin/env tsx
/**
 * Propose a search lane from a client profile.
 *
 * Usage:
 *   npx tsx scripts/propose-search-lane.ts --profile <uuid>
 *   npx tsx scripts/propose-search-lane.ts --profile aiden      # name/email substring
 *   npx tsx scripts/propose-search-lane.ts --profile <uuid> --json
 *   npx tsx scripts/propose-search-lane.ts --profile <uuid> --dry-run
 *
 * --dry-run queries the board once per proposed title before anything is
 * saved, drops the titles that return nothing, flags the ones truncated by the
 * page cap, and outputs the pruned config. It still writes nothing.
 *
 * Reads only. This script never writes to search_lanes — the output is a
 * proposal for a human to edit and insert. That is deliberate and not just
 * caution: three of the five fields below are inferred from free text a client
 * typed into an intake form, and the failure mode of a wrong lane is silent
 * (a lane with the wrong keyword returns plausible jobs from the wrong
 * industry, and nobody can tell from the results that the config was wrong).
 *
 * Hits whatever SUPABASE_URL points to in .env.local.
 *
 * What it reads, and what each field is derived from:
 *
 *   titles     ← client_profiles.target_roles, split on separators
 *   keyword    ← the sector with the most word-boundary evidence across the
 *                profile's targeting text and resume
 *   location   ← client_profiles.target_locations, matched against the
 *                fetcher's LOCATIONS preset table
 *   years_max  ← graduation year if the resume states one, else the
 *                candidate_targeting career_stage, plus headroom
 *   exclusions ← seniority words above the candidate's stage
 *   companies  ← always [], because no profile field carries an employer
 *                allowlist and inventing one would silently shrink the search
 *
 * Every field prints the evidence that produced it. A proposal you cannot
 * argue with is a proposal you cannot correct.
 */

import { createClient } from "@supabase/supabase-js"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { proposeLane } from "../lib/laneProposal"

function loadEnvLocal() {
  for (const name of [".env.local", ".env.development.local"]) {
    const path = join(process.cwd(), name)
    if (!existsSync(path)) continue
    try {
      // @ts-ignore - Node 20.6+
      if (typeof process.loadEnvFile === "function") {
        // @ts-ignore
        process.loadEnvFile(path)
        return
      }
    } catch {}
  }
}
loadEnvLocal()

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local)")
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY)

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The heuristics, the board probe and the keyword scoring all live in
 * lib/laneProposal.ts, because the "Create search lane" button in the coach UI
 * proposes lanes too. A proposal that differed depending on who asked for it
 * would not be a proposal.
 */

// ---------------------------------------------------------------------------

async function findProfile(needle: string) {
  const cols =
    "id, name, email, job_type, target_roles, target_locations, preferred_locations, timeline, profile_text, resume_text"

  if (UUID.test(needle)) {
    const { data, error } = await sb.from("client_profiles").select(cols).eq("id", needle).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error(`no client_profile with id ${needle}`)
    return data as any
  }

  const { data, error } = await sb
    .from("client_profiles")
    .select(cols)
    .or(`name.ilike.%${needle}%,email.ilike.%${needle}%`)
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error(`no client_profile matching "${needle}"`)
  if (data.length > 1) {
    // Never guess. This app has many near-duplicate test accounts and
    // proposing a lane against the wrong one wastes the review, not just the run.
    const lines = (data as any[]).map(
      (p) => `  ${p.id}  ${p.name ?? "(no name)"}  ${p.email ?? ""}  roles: ${p.target_roles ?? "—"}`
    )
    throw new Error(`"${needle}" matches ${data.length} profiles — re-run with --profile <uuid>:\n${lines.join("\n")}`)
  }
  return data[0] as any
}

async function main() {
  const needle = arg("profile")
  if (!needle) {
    console.error("usage: propose-search-lane.ts --profile <uuid|name|email> [--json] [--dry-run]")
    process.exit(1)
  }

  const p = await findProfile(needle)
  const { data: targeting } = await sb
    .from("candidate_targeting")
    .select("career_stage, career_stage_locked_by, primary_other_description")
    .eq("profile_id", p.id)
    .maybeSingle()
  const { data: existing } = await sb
    .from("search_lanes")
    .select("id, name, titles")
    .eq("client_profile_id", p.id)

  // --dry-run asks the board. Without it this is the offline derivation only.
  const probe = process.argv.includes("--dry-run")
  const result = await proposeLane(
    {
      clientProfileId: p.id,
      targetRoles: p.target_roles ?? null,
      targetLocations: p.target_locations ?? null,
      preferredLocations: p.preferred_locations ?? null,
      profileText: p.profile_text ?? null,
      resumeText: p.resume_text ?? null,
      careerStage: targeting?.career_stage ?? null,
      primaryOtherDescription: targeting?.primary_other_description ?? null,
    },
    { probe }
  )

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result.proposal, null, 2))
    return
  }

  const { proposal, evidence, flags } = result

  console.log(`profile:  ${p.name ?? "(no name)"}  <${p.email ?? "no email"}>`)
  console.log(`          ${p.id}`)
  console.log(`  target_roles:      ${p.target_roles ?? "(none)"}`)
  console.log(`  target_locations:  ${p.target_locations ?? "(none)"}`)
  console.log(`  career_stage:      ${targeting?.career_stage ?? "(no candidate_targeting row)"}`)
  console.log(`  existing lanes:    ${existing?.length ? existing.map((l: any) => l.name).join(", ") : "(none)"}`)
  console.log()

  console.log(probe ? "PROPOSED LANE (checked against the board)" : "PROPOSED LANE (offline — pass --dry-run to check it)")
  console.log(`  name:       ${proposal.name}`)
  console.log(`  titles:     ${proposal.titles.length ? proposal.titles.join(" | ") : "(none)"}`)
  console.log(`  keyword:    ${proposal.keyword ?? "(none)"}`)
  console.log(
    `  location:   ${proposal.location.preset ? `${proposal.location.preset} ${proposal.location.radius_miles}mi` : "(no filter — nationwide)"}`
  )
  console.log(`  years_max:  ${proposal.years_max ?? "none"}`)
  console.log(`  exclusions: ${JSON.stringify(proposal.exclusions)}`)
  console.log()

  console.log("WHY")
  console.log(`  titles      ${evidence.titlesFromRoles} from target_roles`)
  console.log(
    `  keyword     resume evidence: ${evidence.sectors.map((x) => `${x.keyword} (${x.score})`).join(", ") || "none"}`
  )
  console.log(`  years_max   ${evidence.yearsRule}`)
  console.log()

  if (result.probe) {
    console.log("BOARD CHECK")
    for (const c of result.probe.candidates) {
      const label = c.keyword === null ? "(no keyword)" : c.keyword
      const verdict = c.keyword === result.probe.chosenKeyword ? "CHOSEN" : c.disqualifiedBecause ? `x ${c.disqualifiedBecause}` : "ok"
      console.log(`  ${String(label).padEnd(16)} kept ${(c.retention * 100).toFixed(0).padStart(3)}% of baseline, ${String(c.totalFetched).padStart(3)} postings   ${verdict}`)
    }
    console.log()
    for (const t of result.probe.titles) {
      const verdict = t.available === 0 ? "DROP" : t.capped ? "keep!" : "keep"
      console.log(`  ${verdict.padEnd(6)} "${t.query}"  ${t.fetched} fetched of ${t.available}`)
    }
    console.log()
  }

  if (flags.length) {
    console.log("REVIEW BEFORE SAVING")
    for (const f of flags) console.log(`  ! ${f}`)
    console.log()
  }

  console.log("row (nothing was written):")
  console.log(JSON.stringify(proposal, null, 2))
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
