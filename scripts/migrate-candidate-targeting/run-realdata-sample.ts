// scripts/migrate-candidate-targeting/run-realdata-sample.ts
//
// Run Claude Haiku inference on the FULL prod population (122 profiles as of
// 2026-05-12 — see DD-17). Read-only against prod. No DB writes. Anonymized
// inputs. Results saved to gitignored local file.
//
// Run:
//   npx tsx scripts/migrate-candidate-targeting/run-realdata-sample.ts
//
// Operational guards:
//   - readOnlySupabase wrapper throws if any .insert / .update / .delete /
//     .upsert is invoked. Runtime safety net beyond code review.
//   - Anonymization (emails, phones, name, URLs) applied to target_roles and
//     resume_text BEFORE sending to the LLM.
//   - Service-role key never logged or written to results file.
//   - Audit log at start (project URL, intent, expected reads) and end
//     (actual read count, write count = 0 enforced).
//   - Results file gitignored via scripts/migrate-candidate-targeting/results/
//     rule in .gitignore.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import {
  isValidLaneId,
  isValidSubLaneId,
  getLaneFromJobFamily,
} from "@/lib/laneTaxonomy"
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parseInferenceOutput,
  type InferenceInput,
  type InferenceOutput,
} from "./inference-prompt"

// ============================================================================
// Env loading — prefer .env.production.local for prod creds, .env.local for
// ANTHROPIC_API_KEY. Service-role key is read but NEVER printed or logged.
// ============================================================================

function loadEnv(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  const text = readFileSync(path, "utf8")
  const out: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const i = trimmed.indexOf("=")
    if (i < 0) continue
    out[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim()
  }
  return out
}

const envProd = loadEnv(".env.production.local")
const envLocal = loadEnv(".env.local")

const PROD_SUPABASE_URL = envProd.SUPABASE_URL
const PROD_SERVICE_ROLE_KEY = envProd.SUPABASE_SERVICE_ROLE_KEY
const ANTHROPIC_API_KEY =
  envProd.ANTHROPIC_API_KEY ??
  envLocal.ANTHROPIC_API_KEY ??
  process.env.ANTHROPIC_API_KEY

if (!PROD_SUPABASE_URL || !PROD_SERVICE_ROLE_KEY) {
  console.error(
    "Missing prod Supabase credentials in .env.production.local " +
      "(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required).",
  )
  process.exit(1)
}
if (!ANTHROPIC_API_KEY) {
  console.error(
    "Missing ANTHROPIC_API_KEY in .env.production.local, .env.local, or env.",
  )
  process.exit(1)
}

const MODEL = "claude-haiku-4-5-20251001"

// ============================================================================
// Read-only Supabase wrapper — Proxy throws on mutation methods.
// This is a runtime safety net: even if someone refactors and accidentally
// calls .insert(), it fails immediately rather than writing.
// ============================================================================

const BLOCKED_METHODS = new Set([
  "insert",
  "update",
  "delete",
  "upsert",
  "rpc", // also block RPC since stored procedures can mutate
])

function makeReadOnly(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "from") {
        return (table: string) => {
          const builder = target.from(table)
          return new Proxy(builder, {
            get(b, m) {
              if (typeof m === "string" && BLOCKED_METHODS.has(m)) {
                throw new Error(
                  `READ-ONLY ENFORCEMENT: .${m}() blocked on table '${table}'. ` +
                    `This script runs against prod; mutations are not permitted.`,
                )
              }
              const v = Reflect.get(b, m)
              return typeof v === "function" ? v.bind(b) : v
            },
          })
        }
      }
      if (prop === "rpc") {
        throw new Error(
          "READ-ONLY ENFORCEMENT: .rpc() blocked. " +
            "This script runs against prod; stored-procedure calls are not permitted.",
        )
      }
      return Reflect.get(target, prop)
    },
  })
}

const rawSupabase = createClient(PROD_SUPABASE_URL, PROD_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const supabase = makeReadOnly(rawSupabase)

// Read counter — incremented on every SELECT we issue. Logged at end.
let readCount = 0
function trackRead(label: string): void {
  readCount++
  console.log(`  [read #${readCount}] ${label}`)
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

// ============================================================================
// Anonymization — applied to target_roles and resume_text before LLM call.
// ============================================================================

const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PHONE_RX =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g
const URL_RX = /https?:\/\/\S+/g

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function anonymize(text: string, name: string | null): string {
  if (!text) return ""
  let out = text
  out = out.replace(EMAIL_RX, "[EMAIL]")
  out = out.replace(URL_RX, "[URL]")
  out = out.replace(PHONE_RX, "[PHONE]")
  if (name && name.trim().length >= 2) {
    // Replace the candidate's stored name as whole-word, case-insensitive.
    const escaped = escapeRegex(name.trim())
    const nameRx = new RegExp(`\\b${escaped}\\b`, "gi")
    out = out.replace(nameRx, "[NAME]")
  }
  return out
}

// ============================================================================
// Profile types
// ============================================================================

type ProdProfile = {
  id: string
  name: string | null
  target_roles: string | null
  resume_text: string | null
  profile_structured: Record<string, unknown> | null
}

type ProfileWithSignals = {
  profileId: string
  inferenceInput: InferenceInput
  isMinSignal: boolean
  jobFamilyDeterministic: string | null // from JobFit run
}

// ============================================================================
// Data fetching (READ-ONLY)
// ============================================================================

async function fetchAllProfiles(): Promise<ProdProfile[]> {
  const { data, error } = await supabase
    .from("client_profiles")
    .select("id, name, target_roles, resume_text, profile_structured")
  trackRead("client_profiles (all rows)")
  if (error) throw new Error(`client_profiles select failed: ${error.message}`)
  return (data ?? []) as ProdProfile[]
}

async function fetchLatestJobFamilyByProfile(
  profileIds: string[],
): Promise<Map<string, string | null>> {
  // Pull all successful runs and group by profile, taking the most recent.
  // Done in one query rather than N to stay efficient.
  const { data, error } = await supabase
    .from("jobfit_runs")
    .select("client_profile_id, result_json, created_at")
    .neq("verdict", "error")
    .in("client_profile_id", profileIds)
    .order("created_at", { ascending: false })
  trackRead(`jobfit_runs for ${profileIds.length} profiles`)
  if (error) throw new Error(`jobfit_runs select failed: ${error.message}`)

  const latestByProfile = new Map<string, string | null>()
  for (const row of (data ?? []) as Array<{
    client_profile_id: string
    result_json: Record<string, unknown> | null
  }>) {
    if (latestByProfile.has(row.client_profile_id)) continue // already have latest
    const sig = (row.result_json as { job_signals?: { jobFamily?: string } })
      ?.job_signals
    latestByProfile.set(row.client_profile_id, sig?.jobFamily ?? null)
  }
  return latestByProfile
}

// ============================================================================
// Build inference inputs
// ============================================================================

function buildInputs(
  profiles: ProdProfile[],
  jobFamilyByProfile: Map<string, string | null>,
): ProfileWithSignals[] {
  return profiles.map((p) => {
    const targetRolesRaw = (p.target_roles ?? "").trim()
    const resumeTextRaw = (p.resume_text ?? "").trim()
    const intakeMeta =
      (p.profile_structured as { intakeMeta?: { currentStatus?: string } })
        ?.intakeMeta ?? {}
    const currentStatus = (intakeMeta.currentStatus ?? "").trim()
    const jobFamily = jobFamilyByProfile.get(p.id) ?? null

    const isMinSignal =
      targetRolesRaw.length === 0 &&
      resumeTextRaw.length < 50 &&
      jobFamily === null

    // Anonymize the two free-text fields before they reach the LLM.
    const targetRoles = anonymize(targetRolesRaw, p.name)
    const resumeAnonymized = anonymize(resumeTextRaw, p.name)
    const resumeSnippet = resumeAnonymized.slice(0, 500)

    return {
      profileId: p.id,
      isMinSignal,
      jobFamilyDeterministic: jobFamily,
      inferenceInput: {
        targetRoles,
        currentStatus,
        jobFamily,
        resumeSnippet,
      },
    }
  })
}

// ============================================================================
// Inference (single shot, temp=0, sequential — keep it simple and observable)
// ============================================================================

type InferenceResult = {
  profileId: string
  input: InferenceInput
  isMinSignal: boolean
  jobFamilyDeterministic: string | null
  output: InferenceOutput | null
  rawResponse: string | null
  error: string | null
  laneHallucination: boolean
  sublaneHallucination: boolean
  forwardMapConsistent: "yes" | "no" | "na"
}

async function inferOne(p: ProfileWithSignals): Promise<InferenceResult> {
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(p.inferenceInput) }],
    })
    const block = resp.content.find((b) => b.type === "text")
    const raw = block && block.type === "text" ? block.text : ""

    const parseResult = parseInferenceOutput(raw)
    if (!parseResult.ok) {
      return {
        profileId: p.profileId,
        input: p.inferenceInput,
        isMinSignal: p.isMinSignal,
        jobFamilyDeterministic: p.jobFamilyDeterministic,
        output: null,
        rawResponse: raw,
        error: `parse: ${parseResult.error}`,
        laneHallucination: false,
        sublaneHallucination: false,
        forwardMapConsistent: "na",
      }
    }

    const out = parseResult.output

    // Lane hallucination: not in LANES.
    const laneHallucination = !isValidLaneId(out.lane)

    // Sub-lane hallucination: actual sub-lane doesn't belong to actual lane.
    // Skipped when lane='other' (sub-lane should be null then).
    let sublaneHallucination = false
    if (out.sublane && out.lane !== "other") {
      if (!isValidSubLaneId(out.lane, out.sublane)) sublaneHallucination = true
    }

    // Forward-map consistency: when jobFamily set, does it map to the
    // chosen lane? Only when jobFamily is mappable (Analytics/Trades →
    // null, those are N/A).
    let forwardMapConsistent: "yes" | "no" | "na"
    if (p.jobFamilyDeterministic) {
      const mapped = getLaneFromJobFamily(
        p.jobFamilyDeterministic as Parameters<typeof getLaneFromJobFamily>[0],
      )
      if (!mapped) {
        forwardMapConsistent = "na"
      } else {
        forwardMapConsistent = mapped.id === out.lane ? "yes" : "no"
      }
    } else {
      forwardMapConsistent = "na"
    }

    return {
      profileId: p.profileId,
      input: p.inferenceInput,
      isMinSignal: p.isMinSignal,
      jobFamilyDeterministic: p.jobFamilyDeterministic,
      output: out,
      rawResponse: raw,
      error: null,
      laneHallucination,
      sublaneHallucination,
      forwardMapConsistent,
    }
  } catch (e) {
    return {
      profileId: p.profileId,
      input: p.inferenceInput,
      isMinSignal: p.isMinSignal,
      jobFamilyDeterministic: p.jobFamilyDeterministic,
      output: null,
      rawResponse: null,
      error: `llm: ${e instanceof Error ? e.message : String(e)}`,
      laneHallucination: false,
      sublaneHallucination: false,
      forwardMapConsistent: "na",
    }
  }
}

// ============================================================================
// Spot-check selection: 5 random + 3 Other + 2 low (with fallbacks)
// ============================================================================

function pickRandom<T>(arr: T[], n: number, exclude: Set<T>): T[] {
  const pool = arr.filter((x) => !exclude.has(x))
  const out: T[] = []
  const copy = [...pool]
  while (out.length < n && copy.length > 0) {
    const idx = Math.floor(Math.random() * copy.length)
    const picked = copy.splice(idx, 1)[0]
    out.push(picked)
  }
  return out
}

function selectSpotCheckCandidates(results: InferenceResult[]): {
  picked: InferenceResult[]
  breakdown: { other: number; low: number; random: number }
} {
  const okResults = results.filter((r) => r.output !== null)
  const otherCases = okResults.filter((r) => r.output!.lane === "other")
  const lowCases = okResults.filter(
    (r) => r.output!.confidence === "low" && r.output!.lane !== "other",
  )

  const picked = new Set<InferenceResult>()
  let nOther = 0
  let nLow = 0
  let nRandom = 0

  // 3 Other (fallback: random)
  for (const r of pickRandom(otherCases, 3, picked)) {
    picked.add(r)
    nOther++
  }
  // 2 low (fallback: random)
  for (const r of pickRandom(lowCases, 2, picked)) {
    picked.add(r)
    nLow++
  }
  // Fill remaining slots to 10 with random
  const remaining = 10 - picked.size
  for (const r of pickRandom(okResults, remaining, picked)) {
    picked.add(r)
    nRandom++
  }

  return {
    picked: [...picked],
    breakdown: { other: nOther, low: nLow, random: nRandom },
  }
}

// ============================================================================
// Summary computation
// ============================================================================

function computeSummary(results: InferenceResult[]): string {
  const lines: string[] = []
  const total = results.length
  const parseErrors = results.filter((r) =>
    r.error?.startsWith("parse:"),
  ).length
  const llmErrors = results.filter((r) => r.error?.startsWith("llm:")).length
  const ok = results.filter((r) => r.output !== null)

  // Confidence distribution
  let high = 0,
    medium = 0,
    low = 0
  for (const r of ok) {
    if (r.output!.confidence === "high") high++
    else if (r.output!.confidence === "medium") medium++
    else low++
  }
  const pct = (n: number) =>
    total === 0 ? "0%" : `${((n / total) * 100).toFixed(1)}%`

  // Lane distribution
  const laneCounts = new Map<string, number>()
  for (const r of ok) {
    const k = r.output!.lane
    laneCounts.set(k, (laneCounts.get(k) ?? 0) + 1)
  }

  // Other rate
  const otherCount = laneCounts.get("other") ?? 0

  // Hallucination counts
  const laneHalluc = results.filter((r) => r.laneHallucination).length
  const sublaneHalluc = results.filter((r) => r.sublaneHallucination).length

  // JobFamily consistency
  const consistencyEligible = results.filter(
    (r) => r.forwardMapConsistent !== "na",
  )
  const consistencyMatch = consistencyEligible.filter(
    (r) => r.forwardMapConsistent === "yes",
  ).length

  // Min-signal
  const minSignalCount = results.filter((r) => r.isMinSignal).length
  const minSignalResults = results.filter(
    (r) => r.isMinSignal && r.output !== null,
  )
  const minSignalOtherCount = minSignalResults.filter(
    (r) => r.output!.lane === "other",
  ).length

  lines.push("")
  lines.push("=== SUMMARY ===")
  lines.push(`Total profiles processed:    ${total}`)
  lines.push(`  Inference successful:      ${ok.length}`)
  lines.push(`  Parse errors:              ${parseErrors}`)
  lines.push(`  LLM errors:                ${llmErrors}`)
  lines.push("")
  lines.push(`Confidence distribution (of successful):`)
  lines.push(`  high:   ${high}   (${pct(high)})`)
  lines.push(`  medium: ${medium}   (${pct(medium)})`)
  lines.push(`  low:    ${low}   (${pct(low)})`)
  lines.push("")
  lines.push(`Other rate:                  ${otherCount}   (${pct(otherCount)})`)
  lines.push("")
  lines.push(`Hallucination counts:`)
  lines.push(`  Lane hallucinations:       ${laneHalluc}`)
  lines.push(`  Sub-lane hallucinations:   ${sublaneHalluc}`)
  lines.push("")
  lines.push(`JobFamily-to-lane consistency (where JobFamily set + mappable):`)
  lines.push(
    `  Eligible profiles:         ${consistencyEligible.length}`,
  )
  lines.push(
    `  Consistent:                ${consistencyMatch}   (${
      consistencyEligible.length === 0
        ? "n/a"
        : `${((consistencyMatch / consistencyEligible.length) * 100).toFixed(1)}%`
    })`,
  )
  lines.push("")
  lines.push(`Min-signal profiles (no target_roles + no resume + no JobFit):`)
  lines.push(`  Total min-signal:          ${minSignalCount}`)
  lines.push(`  Min-signal → lane='other': ${minSignalOtherCount}`)
  lines.push("")
  lines.push(`Lane distribution:`)
  const sortedLanes = [...laneCounts.entries()].sort((a, b) => b[1] - a[1])
  for (const [lane, n] of sortedLanes) {
    lines.push(`  ${lane.padEnd(22)} ${n}`)
  }

  return lines.join("\n")
}

// ============================================================================
// Per-profile log block
// ============================================================================

function formatProfileBlock(r: InferenceResult): string {
  const lines: string[] = []
  lines.push(`── ${r.profileId} ──`)
  if (r.isMinSignal) lines.push(`  MIN-SIGNAL: true`)
  lines.push(`  Input:`)
  lines.push(`    target_roles:    "${r.input.targetRoles || "(empty)"}"`)
  lines.push(
    `    current_status:  "${r.input.currentStatus || "(empty)"}"`,
  )
  lines.push(`    job_family:      ${r.input.jobFamily ?? "(none)"}`)
  if (r.input.resumeSnippet) {
    const snip = r.input.resumeSnippet.slice(0, 100).replace(/\s+/g, " ")
    lines.push(`    resume_snippet:  "${snip}${r.input.resumeSnippet.length > 100 ? "…" : ""}"`)
  } else {
    lines.push(`    resume_snippet:  (empty)`)
  }

  if (r.error) {
    lines.push(`  ERROR: ${r.error}`)
    if (r.rawResponse) {
      lines.push(`  Raw response: ${r.rawResponse.slice(0, 200)}`)
    }
    return lines.join("\n")
  }

  const o = r.output!
  lines.push(`  Output:`)
  lines.push(`    lane:            ${o.lane}`)
  lines.push(`    sublane:         ${o.sublane ?? "null"}`)
  lines.push(
    `    description:     ${o.primary_other_description ?? "null"}`,
  )
  lines.push(`    confidence:      ${o.confidence}`)
  lines.push(`    reasoning:       ${o.reasoning}`)
  if (r.laneHallucination) lines.push(`  ⚠ LANE HALLUCINATION`)
  if (r.sublaneHallucination) lines.push(`  ⚠ SUB-LANE HALLUCINATION`)
  lines.push(`  Forward-map consistent: ${r.forwardMapConsistent}`)
  return lines.join("\n")
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log("============================================================")
  console.log("READ-ONLY PROD INFERENCE")
  console.log("============================================================")
  console.log(`Project URL:    ${PROD_SUPABASE_URL}`)
  console.log(`Model:          ${MODEL}`)
  console.log(`Temperature:    0`)
  console.log(`Started:        ${new Date().toISOString()}`)
  console.log(`Read-only mode: ENFORCED via Proxy wrapper`)
  console.log(`Writes:         0 expected, 0 enforced`)
  console.log("")

  // 1. Fetch all profiles
  console.log("Fetching profiles…")
  const profiles = await fetchAllProfiles()
  console.log(`  Got ${profiles.length} profiles`)

  // 2. Fetch latest JobFit-derived JobFamily per profile
  console.log("Fetching latest JobFit job_family per profile…")
  const jobFamilyByProfile = await fetchLatestJobFamilyByProfile(
    profiles.map((p) => p.id),
  )
  console.log(`  Got JobFamily for ${jobFamilyByProfile.size} profiles`)

  // 3. Build inference inputs with anonymization
  const inputs = buildInputs(profiles, jobFamilyByProfile)
  const minSignalCount = inputs.filter((p) => p.isMinSignal).length
  console.log(`  Min-signal profiles in population: ${minSignalCount}`)
  console.log("")

  // 4. Run inference sequentially
  console.log("Running inference (sequential, single-shot per profile)…")
  const results: InferenceResult[] = []
  for (let i = 0; i < inputs.length; i++) {
    const p = inputs[i]
    process.stdout.write(`  [${i + 1}/${inputs.length}] ${p.profileId.slice(0, 8)}… `)
    const r = await inferOne(p)
    results.push(r)
    if (r.error) {
      process.stdout.write(`ERROR ${r.error}\n`)
    } else {
      process.stdout.write(
        `${r.output!.lane}/${r.output!.sublane ?? "—"} (${r.output!.confidence})\n`,
      )
    }
  }
  console.log("")

  // 5. Compute summary
  const summary = computeSummary(results)

  // 6. Select spot-check candidates
  const spotcheck = selectSpotCheckCandidates(results)
  console.log(
    `Spot-check picks: ${spotcheck.picked.length} (${spotcheck.breakdown.other} other, ${spotcheck.breakdown.low} low, ${spotcheck.breakdown.random} random)`,
  )

  // 7. Write transcript
  const resultsDir = join(
    "scripts",
    "migrate-candidate-targeting",
    "results",
  )
  if (!existsSync(resultsDir)) mkdirSync(resultsDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const outPath = join(resultsDir, `realdata-${ts}.txt`)

  const lines: string[] = []
  lines.push("============================================================")
  lines.push("READ-ONLY PROD INFERENCE — full transcript")
  lines.push("============================================================")
  lines.push(`Project URL:   ${PROD_SUPABASE_URL}`)
  lines.push(`Model:         ${MODEL}`)
  lines.push(`Temperature:   0`)
  lines.push(`Population:    ${profiles.length} profiles`)
  lines.push(`Min-signal:    ${minSignalCount}`)
  lines.push(`Read count:    ${readCount}`)
  lines.push(`Write count:   0 (enforced via Proxy wrapper)`)
  lines.push(`Started:       see process logs above`)
  lines.push(`Finished:      ${new Date().toISOString()}`)
  lines.push("")
  lines.push("─── PER-PROFILE DETAIL ───")
  lines.push("")
  for (const r of results) {
    lines.push(formatProfileBlock(r))
    lines.push("")
  }
  lines.push("─── SPOT-CHECK CANDIDATES (Peri to review) ───")
  lines.push(
    `Composition target: 3 other + 2 low + 5 random (with fallback). ` +
      `Actual: ${spotcheck.breakdown.other} other, ${spotcheck.breakdown.low} low, ${spotcheck.breakdown.random} random.`,
  )
  lines.push("")
  for (const r of spotcheck.picked) {
    lines.push(formatProfileBlock(r))
    lines.push("")
  }
  lines.push(summary)

  writeFileSync(outPath, lines.join("\n"), "utf8")
  console.log("")
  console.log(summary)
  console.log("")
  console.log(`Transcript: ${outPath}`)
  console.log("")
  console.log("============================================================")
  console.log("AUDIT — end of run")
  console.log("============================================================")
  console.log(`  Reads issued:  ${readCount}`)
  console.log(`  Writes issued: 0 (enforced)`)
  console.log(`  Profiles processed: ${results.length}`)
  console.log(`  Errors: ${results.filter((r) => r.error).length}`)
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : String(e))
  console.error(
    "Audit: reads issued before fatal =",
    readCount,
    "; writes = 0 (enforced)",
  )
  process.exit(1)
})
