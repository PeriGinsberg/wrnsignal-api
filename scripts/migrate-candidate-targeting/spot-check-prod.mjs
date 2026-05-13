// scripts/migrate-candidate-targeting/spot-check-prod.mjs
//
// Read-only spot-checks against prod for the four named profiles + PreMed
// verification. Surfaces lane distribution and joins client_profiles.name
// onto candidate_targeting for the specific names.
//
// NO writes. Anonymization not needed — we only print fields we already
// know are safe to surface (lane, sublane, description, name).

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

const env = Object.fromEntries(
  readFileSync(".env.production.local", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=")
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

console.log(`Prod project: ${env.SUPABASE_URL}\n`)

// ─── 1. Lane distribution ────────────────────────────────────────────────
console.log("=== Lane distribution (source='migration') ===")
const { data: targetingRows } = await sb
  .from("candidate_targeting")
  .select("profile_id, primary_lane, primary_sublane, primary_other_description, status_premed, status_prelaw, status_pregrad")
  .eq("source", "migration")

const laneCounts = new Map()
for (const r of targetingRows ?? []) {
  laneCounts.set(r.primary_lane, (laneCounts.get(r.primary_lane) ?? 0) + 1)
}
for (const [lane, n] of [...laneCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${lane.padEnd(22)} ${n}`)
}
console.log(`  TOTAL                  ${targetingRows?.length ?? 0}`)

// ─── 2. Named-profile spot checks ────────────────────────────────────────
console.log("\n=== Named-profile spot checks ===")
const targetNames = [
  { label: "Aiden Ginsberg (MLB/sports)", patternIlike: "Aiden Ginsberg" },
  { label: "Babette Gilles (biomed eng)", patternIlike: "Babette Gilles" },
  { label: "Allison Rutstein (recruiter)", patternIlike: "Allison Rutstein" },
]

for (const t of targetNames) {
  const { data } = await sb
    .from("client_profiles")
    .select("id, name")
    .ilike("name", `%${t.patternIlike}%`)
  if (!data || data.length === 0) {
    console.log(`  ${t.label}: NOT FOUND`)
    continue
  }
  for (const profile of data) {
    const ct = (targetingRows ?? []).find((r) => r.profile_id === profile.id)
    if (!ct) {
      console.log(`  ${t.label}: ${profile.id.slice(0, 8)}… (${profile.name}) → NO TARGETING ROW`)
      continue
    }
    console.log(`  ${t.label}: ${profile.id.slice(0, 8)}… (${profile.name})`)
    console.log(`    lane:        ${ct.primary_lane}`)
    console.log(`    sublane:     ${ct.primary_sublane ?? "(null)"}`)
    console.log(`    description: ${ct.primary_other_description ?? "(null)"}`)
    console.log(`    premed:      ${ct.status_premed}`)
  }
}

// ─── 3. Other-lane biomedical / engineering description scan ────────────
console.log("\n=== Other-lane biomedical/engineering descriptions ===")
const otherRows = (targetingRows ?? []).filter((r) => r.primary_lane === "other")
const engineeringPattern = /(mechanical|civil|biomed|industrial|chemical|electrical|aerospace|engineer|engineering)/i
for (const r of otherRows) {
  const desc = r.primary_other_description ?? ""
  if (engineeringPattern.test(desc)) {
    const { data } = await sb
      .from("client_profiles")
      .select("name")
      .eq("id", r.profile_id)
      .maybeSingle()
    console.log(`  ${r.profile_id.slice(0, 8)}… (${data?.name ?? "?"})`)
    console.log(`    description: ${desc}`)
  }
}

// ─── 4. Sports / MLB description scan ───────────────────────────────────
console.log("\n=== Other-lane sports/MLB descriptions ===")
const sportsPattern = /(sport|mlb|nba|nfl|athlet|baseball|basketball|football|hockey|coach|team)/i
for (const r of otherRows) {
  const desc = r.primary_other_description ?? ""
  if (sportsPattern.test(desc)) {
    const { data } = await sb
      .from("client_profiles")
      .select("name")
      .eq("id", r.profile_id)
      .maybeSingle()
    console.log(`  ${r.profile_id.slice(0, 8)}… (${data?.name ?? "?"})`)
    console.log(`    description: ${desc}`)
  }
}

// ─── 5. PreMed verification ──────────────────────────────────────────────
console.log("\n=== PreMed verification ===")
const premedRows = (targetingRows ?? []).filter((r) => r.status_premed === true)
console.log(`  Profiles with status_premed=true: ${premedRows.length}`)
for (const r of premedRows) {
  const { data } = await sb
    .from("client_profiles")
    .select("name")
    .eq("id", r.profile_id)
    .maybeSingle()
  console.log(`  ${r.profile_id.slice(0, 8)}… (${data?.name ?? "?"})`)
  console.log(`    lane:        ${r.primary_lane}`)
  console.log(`    sublane:     ${r.primary_sublane ?? "(null)"}`)
}

// ─── 6. Null-sublane override (single case predicted: Maleri Ginsberg) ───
console.log("\n=== Null-sublane override (transcript flagged 1 case) ===")
// Cross-reference: from transcript, profile 71f87d02 got null_sublane_override
const overrideProfileId = "71f87d02-d5d8-4f38-889f-6caf08b10027"
const { data: overrideProfile } = await sb
  .from("client_profiles")
  .select("name")
  .eq("id", overrideProfileId)
  .maybeSingle()
const overrideTarget = (targetingRows ?? []).find(
  (r) => r.profile_id === overrideProfileId,
)
if (overrideTarget) {
  console.log(`  ${overrideProfileId.slice(0, 8)}… (${overrideProfile?.name ?? "?"})`)
  console.log(`    lane:        ${overrideTarget.primary_lane}`)
  console.log(`    sublane:     ${overrideTarget.primary_sublane ?? "(null)"}`)
}

console.log("\nDone (read-only).")
