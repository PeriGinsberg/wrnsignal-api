// tests/positioning-v2/phase2/pattern-b-eval-harness.ts
//
// Pattern B eval harness — Positioning Phase 2, Q3.1 (state-check session).
//
// ⚠️  LIVE ANTHROPIC API CALLS — incurs real cost (~$0.003/scenario on
//     Haiku 4.5; ~$0.03 for the full set). Run DELIBERATELY, never in CI.
//
// What this is (and is not):
//   - This is a MEASUREMENT harness, not a pass/fail test. It exercises the
//     REAL production Pattern B path (aiClient.generateBulletReframe →
//     anthropicClient.invokeClaude → Claude Haiku 4.5) and runs the raw
//     output through the REAL production validator
//     (groundingValidator.isAcceptableAiResult), then reports accept/reject
//     rates + a rejection-reason breakdown.
//   - It does NOT mock the model — that's the whole point. Everything else in
//     tests/positioning-v2/phase2/*-check.ts mocks the AI via invokeClaudeImpl;
//     this harness inverts that to see what the prompt actually produces.
//   - Output is a durable JSON snapshot (./snapshots/) that serves as the
//     BASELINE for Q2 (Pattern B prompt/validator tuning). Q2 re-runs this
//     pre/post tuning to measure improvement.
//
// Measurement semantics:
//   - One FIRST-ATTEMPT call per scenario (temperature 0.7 — the production
//     first-attempt temp). Production retries once at temp 1.0 before showing
//     the user a 422, so the user-facing manual-entry rate is lower than the
//     single-attempt reject rate measured here. Single-attempt is the right
//     signal for PROMPT quality (how often the prompt produces grounded output
//     on the first try); the retry is a recovery mechanism, not a prompt fix.
//
// Allowed-source contract (matches /draft route for Pattern B): the validator
// is fed [original_bullet, user_response] ONLY — NOT the full resume. The
// resume is given to the model as context but is not a grounding source for
// the reframe (FRD §6.8 / bulletPrompt.ts).
//
// Run:
//   npx tsx tests/positioning-v2/phase2/pattern-b-eval-harness.ts
//   (NODE_OPTIONS=--use-system-ca not required — no DB; only the Anthropic
//    HTTPS call, which uses the public CA.)
//
// State check: docs/positioning-phase2-state-check-2026-05-27.md (Q3 / Q2)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

import { generateBulletReframe } from "@/lib/positioning/v2/phase2/aiClient"
import { isAcceptableAiResult } from "@/lib/positioning/v2/phase2/groundingValidator"
import { MODEL } from "@/lib/positioning/v2/phase2/anthropicClient"
import type { PhaseTwoBulletItem } from "@/lib/positioning/v2/phase2/types"
import { CATHERINE_RESUME_TEXT, CATHERINE_TEXT_SWOT_LINE } from "./fixtures"

// ============================================================================
// Env: load ANTHROPIC_API_KEY into process.env (tsx does not auto-load .env).
// The key lives in .env.local on this machine; .env.development.local does
// not carry it. Load both, preferring whichever defines the key.
// ============================================================================

function loadEnv(path: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l.trim() && !l.startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=")
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
        }),
    )
  } catch {
    return {}
  }
}

const fileEnv = { ...loadEnv(".env.development.local"), ...loadEnv(".env.local") }
if (!process.env.ANTHROPIC_API_KEY && fileEnv.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = fileEnv.ANTHROPIC_API_KEY
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY not found in process.env, .env.local, or .env.development.local. Cannot run live harness.",
  )
  process.exit(1)
}

// ============================================================================
// Cost model (Haiku 4.5 — anthropicClient.ts MODEL): $1/MTok in, $5/MTok out.
// ============================================================================

const COST_PER_INPUT_TOKEN = 1 / 1_000_000
const COST_PER_OUTPUT_TOKEN = 5 / 1_000_000

// ============================================================================
// Rejection categorization (harness-local heuristic; the validator itself
// only reports "empty_drafts" | "ungrounded" + entities). Buckets:
//   - insufficient_evidence: Claude refused / returned no usable draft
//   - corporate_paraphrase: ungrounded tokens include corporate buzzwords
//     (the documented Pattern B failure mode — FRD §10/§12 + state-check Q2)
//   - ungrounded_other: ungrounded tokens that aren't buzzwords (invented
//     specifics, domain terms, names, numbers, etc.)
// ============================================================================

const CORPORATE_BUZZWORDS = new Set([
  "stakeholder", "stakeholders", "vision", "visionary", "synergy", "synergies",
  "spearheaded", "spearhead", "orchestrated", "orchestrate", "leveraged",
  "leverage", "leveraging", "holistic", "ecosystem", "paradigm", "optimized",
  "optimize", "optimizing", "streamlined", "streamline", "scalable",
  "transformative", "transformed", "transforming", "impactful", "innovative",
  "dynamic", "robust", "mission-critical", "synergistic", "empowered",
  "spearheading", "stewardship", "thought-leadership", "best-in-class",
])

type RejectionCategory =
  | "insufficient_evidence"
  | "corporate_paraphrase"
  | "ungrounded_other"

function categorizeRejection(
  reason: "empty_drafts" | "ungrounded",
  ungrounded: string[],
): RejectionCategory {
  if (reason === "empty_drafts") return "insufficient_evidence"
  const hitBuzzword = ungrounded.some((t) =>
    CORPORATE_BUZZWORDS.has(t.toLowerCase()),
  )
  return hitBuzzword ? "corporate_paraphrase" : "ungrounded_other"
}

// ============================================================================
// Scenario set: 4 Catherine-fixture-grounded + 5 synthetic. Hardcoded for
// reproducibility (no dev-state dependency — same scenarios every run).
//
// Each scenario is a (original_bullet, user_response) pair plus context.
// The validator grounds against [original_bullet, user_response]; resume_text
// + job_description are model context only.
// ============================================================================

type Scenario = {
  input_id: string
  source: "catherine_fixture" | "synthetic"
  original_bullet: string
  resume_text: string
  job_description: string
  jd_context: string
  user_response: string
  gap_context: {
    gap_shape: string
    severity: "high" | "medium" | "low"
    bullet_shape: "achievement-heavy" | "responsibility-heavy" | "hybrid"
  }
  expected_behavior: string
}

// Short synthetic resumes — context only; grounding is bullet + response.
const SYN_RESUME_HACKATHON =
  "JORDAN PARK\nComputer Science, State University\nProjects\nHelped organize a campus hackathon\nTeaching Assistant, Intro to CS"
const SYN_RESUME_BARISTA =
  "ALEX MORENO\nB.A. English\nExperience\nWorked part-time as a barista at a campus coffee shop\nTutored writing at the student center"
const SYN_RESUME_SOCIAL =
  "SAM RIVERA\nMarketing student\nActivities\nCreated social media posts for the photography club\nPart-time retail associate"
const SYN_RESUME_FOODBANK =
  "TAYLOR KIM\nB.S. Public Health\nCommunity\nVolunteered at a local food bank\nPeer health educator"
const SYN_RESUME_CHESS =
  "RILEY CHEN\nUndeclared, first year\nClubs\nMember of the chess club\nIntramural soccer"

const SCENARIOS: Scenario[] = [
  // ── Catherine fixtures (real resume) ──────────────────────────────────
  {
    input_id: "catherine-swot-analysis",
    source: "catherine_fixture",
    original_bullet: CATHERINE_TEXT_SWOT_LINE,
    resume_text: CATHERINE_RESUME_TEXT,
    job_description:
      "Versant Internship — Corporate Finance, Analytics & Human Resources. Supporting financial strategy and data-driven decision-making.",
    jd_context:
      "Versant finance/analytics interns: data-driven decision-making and reporting for corporate strategy.",
    user_response:
      "I gathered competitor data and market trends in a spreadsheet, ran a SWOT framework, and summarized the findings into recommendations the team used to choose a positioning angle.",
    gap_context: { gap_shape: "experience", severity: "high", bullet_shape: "responsibility-heavy" },
    expected_behavior:
      "Reframe toward data analysis / strategic reporting using only the user's stated tools (spreadsheet, SWOT) and outcome (recommendations). No invented metrics or finance jargon.",
  },
  {
    input_id: "catherine-client-deck",
    source: "catherine_fixture",
    original_bullet:
      "Presented findings through a professional client deck and written report",
    resume_text: CATHERINE_RESUME_TEXT,
    job_description:
      "Versant Internship — reporting and stakeholder communication expected.",
    jd_context: "Reporting and stakeholder communication.",
    user_response:
      "I built a 15-slide deck and a written report, walked the client through the recommendations in a live presentation, and answered their questions.",
    gap_context: { gap_shape: "experience", severity: "medium", bullet_shape: "achievement-heavy" },
    expected_behavior:
      "Reframe to emphasize communicating analysis/results; may use '15-slide' and 'live presentation' (both in user response). No invented audience size.",
  },
  {
    input_id: "catherine-photo-client-mgmt",
    source: "catherine_fixture",
    original_bullet:
      "Delivered photography for 30+ client events, managing creative execution and client communication",
    resume_text: CATHERINE_RESUME_TEXT,
    job_description:
      "Client management and project coordination across multiple concurrent engagements.",
    jd_context: "Client management and multi-project coordination.",
    user_response:
      "I managed bookings and timelines for more than 30 events, coordinated directly with each client on deliverables, and handled all communication from the first quote to final delivery.",
    gap_context: { gap_shape: "experience", severity: "medium", bullet_shape: "hybrid" },
    expected_behavior:
      "Reframe toward client/project management; '30+' is in both bullet and response so it's grounded. No invented revenue or satisfaction metrics.",
  },
  {
    input_id: "catherine-bpad-ops",
    source: "catherine_fixture",
    original_bullet:
      "Coordinated sponsorship, networking, and professional development events",
    resume_text: CATHERINE_RESUME_TEXT,
    job_description:
      "Operations and process execution in a fast-paced, team-based environment.",
    jd_context: "Operations and process execution.",
    user_response:
      "I planned logistics for about six events a semester, secured three corporate sponsors, and coordinated schedules across a 24-person team.",
    gap_context: { gap_shape: "experience", severity: "low", bullet_shape: "responsibility-heavy" },
    expected_behavior:
      "Reframe toward operations/logistics using the stated numbers (six events, three sponsors, 24-person team — all in user response).",
  },

  // ── Synthetic ─────────────────────────────────────────────────────────
  {
    input_id: "syn-hackathon-clean",
    source: "synthetic",
    original_bullet: "Helped organize a campus hackathon",
    resume_text: SYN_RESUME_HACKATHON,
    job_description:
      "Program/operations coordinator — budget ownership, sponsor management, event logistics.",
    jd_context: "Event operations, budget, and sponsor management.",
    user_response:
      "I recruited eight sponsors, managed a 5,000 dollar budget, and coordinated 120 participants over a weekend event.",
    gap_context: { gap_shape: "experience", severity: "high", bullet_shape: "achievement-heavy" },
    expected_behavior:
      "Clean reframe — all specifics (8 sponsors, $5,000, 120 participants) are in the user response. Should ACCEPT.",
  },
  {
    input_id: "syn-barista-domain-mismatch",
    source: "synthetic",
    original_bullet: "Worked part-time as a barista at a campus coffee shop",
    resume_text: SYN_RESUME_BARISTA,
    job_description:
      "Finance analyst intern — financial analysis, stakeholder management, strategic reporting.",
    jd_context: "Financial analysis and stakeholder management.",
    user_response:
      "I handled cash, trained two new hires, and kept the morning rush organized.",
    gap_context: { gap_shape: "domain", severity: "high", bullet_shape: "responsibility-heavy" },
    expected_behavior:
      "Edge case: deep domain mismatch. The JD tempts finance/stakeholder/strategic vocabulary that is NOT in the bullet or response. Likely REJECT (corporate_paraphrase) — and that's the correct, integrity-preserving outcome.",
  },
  {
    input_id: "syn-social-analytics",
    source: "synthetic",
    original_bullet: "Created social media posts for the photography club",
    resume_text: SYN_RESUME_SOCIAL,
    job_description:
      "Marketing intern — campaign analytics and performance measurement.",
    jd_context: "Marketing analytics and campaign measurement.",
    user_response:
      "I planned a content calendar, wrote captions, and tracked likes and follower growth week over week.",
    gap_context: { gap_shape: "skill", severity: "medium", bullet_shape: "responsibility-heavy" },
    expected_behavior:
      "Borderline — should reframe toward content/measurement using 'tracked likes and follower growth'. Watch for invented 'engagement rate %' or 'analytics tools' not in the response.",
  },
  {
    input_id: "syn-foodbank-ops",
    source: "synthetic",
    original_bullet: "Volunteered at a local food bank",
    resume_text: SYN_RESUME_FOODBANK,
    job_description:
      "Operations and logistics coordinator — scheduling, inventory, process improvement.",
    jd_context: "Operations, logistics, and inventory coordination.",
    user_response:
      "I scheduled fifteen volunteers per shift, tracked inventory in a spreadsheet, and cut waste by reorganizing the storage area.",
    gap_context: { gap_shape: "experience", severity: "high", bullet_shape: "responsibility-heavy" },
    expected_behavior:
      "Should ACCEPT — concrete grounded facts (15 volunteers/shift, spreadsheet inventory, storage reorg). No invented waste-reduction percentage.",
  },
  {
    input_id: "syn-chess-thin-response",
    source: "synthetic",
    original_bullet: "Member of the chess club",
    resume_text: SYN_RESUME_CHESS,
    job_description: "Data analyst intern — quantitative analysis.",
    jd_context: "Quantitative / data analysis.",
    user_response: "I played chess sometimes with friends.",
    gap_context: { gap_shape: "domain", severity: "high", bullet_shape: "responsibility-heavy" },
    expected_behavior:
      "Edge case: thin/irrelevant response with no transferable specifics. Expect insufficient_evidence (empty drafts) — the prompt should refuse rather than invent.",
  },
]

// ============================================================================
// Build a minimal PhaseTwoBulletItem for generateBulletReframe. It reads
// item.original_bullet + item.jd_context; the rest are seed defaults.
// ============================================================================

function makeBulletItem(s: Scenario): PhaseTwoBulletItem {
  return {
    id: s.input_id,
    type: "bullet",
    label: `Reframe bullet: ${s.input_id}`,
    original_bullet: s.original_bullet,
    jd_context: s.jd_context,
    question_asked: null,
    user_response: s.user_response,
    draft: null,
    final_text: null,
    accepted: false,
    declined: false,
    skipped: false,
    manual_entry: false,
    decided_at: null,
  }
}

// ============================================================================
// Per-scenario result shape
// ============================================================================

type ScenarioResult = {
  input_id: string
  source: Scenario["source"]
  original_bullet: string
  user_response: string
  gap_context: Scenario["gap_context"]
  ai_draft: string | null
  validator_result: "accepted" | "rejected" | "error"
  validator_reason: string | null
  rejection_category: RejectionCategory | null
  ungrounded_entities: string[]
  timing_ms: number
  usage: { input_tokens: number; output_tokens: number } | null
  cost_usd: number | null
  error: string | null
}

async function runScenario(s: Scenario): Promise<ScenarioResult> {
  const item = makeBulletItem(s)
  const t0 = Date.now()
  try {
    const result = await generateBulletReframe({
      resumeText: s.resume_text,
      jobDescription: s.job_description,
      item,
      userResponse: s.user_response,
      // isRetry omitted → first-attempt temperature (0.7), matching the
      // production first call. See measurement-semantics note in header.
    })
    const timing_ms = Date.now() - t0
    const allowedSources = [s.original_bullet, s.user_response]
    const validation = isAcceptableAiResult(result.drafts, allowedSources)
    const cost_usd =
      result.usage.input_tokens * COST_PER_INPUT_TOKEN +
      result.usage.output_tokens * COST_PER_OUTPUT_TOKEN

    if (validation.ok) {
      return {
        input_id: s.input_id, source: s.source,
        original_bullet: s.original_bullet, user_response: s.user_response,
        gap_context: s.gap_context,
        ai_draft: result.drafts[0] ?? null,
        validator_result: "accepted", validator_reason: null,
        rejection_category: null, ungrounded_entities: [],
        timing_ms, usage: result.usage, cost_usd, error: null,
      }
    }
    const ungrounded = validation.ungrounded_entities ?? []
    return {
      input_id: s.input_id, source: s.source,
      original_bullet: s.original_bullet, user_response: s.user_response,
      gap_context: s.gap_context,
      ai_draft: result.drafts[0] ?? null,
      validator_result: "rejected", validator_reason: validation.reason,
      rejection_category: categorizeRejection(validation.reason, ungrounded),
      ungrounded_entities: ungrounded,
      timing_ms, usage: result.usage, cost_usd, error: null,
    }
  } catch (e) {
    return {
      input_id: s.input_id, source: s.source,
      original_bullet: s.original_bullet, user_response: s.user_response,
      gap_context: s.gap_context,
      ai_draft: null, validator_result: "error", validator_reason: null,
      rejection_category: null, ungrounded_entities: [],
      timing_ms: Date.now() - t0, usage: null, cost_usd: null,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const runAt = new Date().toISOString()
  console.log("=".repeat(74))
  console.log("Pattern B eval harness — LIVE Anthropic calls (Haiku 4.5)")
  console.log(`model: ${MODEL}   scenarios: ${SCENARIOS.length}   run_at: ${runAt}`)
  console.log("=".repeat(74))

  const results: ScenarioResult[] = []
  // Serial — keeps cost predictable and avoids rate-limit bursts.
  for (const s of SCENARIOS) {
    process.stdout.write(`  • ${s.input_id} … `)
    const r = await runScenario(s)
    results.push(r)
    const tag =
      r.validator_result === "accepted" ? "ACCEPT"
      : r.validator_result === "rejected" ? `REJECT (${r.rejection_category})`
      : `ERROR (${r.error})`
    console.log(`${tag}  [${r.timing_ms}ms]`)
  }

  // ── Aggregate ────────────────────────────────────────────────────────
  const ok = results.filter((r) => r.validator_result === "accepted")
  const rej = results.filter((r) => r.validator_result === "rejected")
  const err = results.filter((r) => r.validator_result === "error")
  const scored = ok.length + rej.length // exclude errors from the rate

  const rejection_breakdown: Record<string, number> = {}
  for (const r of rej) {
    const k = r.rejection_category ?? "uncategorized"
    rejection_breakdown[k] = (rejection_breakdown[k] ?? 0) + 1
  }

  const timings = results.filter((r) => r.usage !== null).map((r) => r.timing_ms)
  const avg_timing_ms =
    timings.length > 0 ? Math.round(timings.reduce((a, b) => a + b, 0) / timings.length) : 0
  const total_cost_usd = results.reduce((a, r) => a + (r.cost_usd ?? 0), 0)
  const accept_rate = scored > 0 ? +(ok.length / scored).toFixed(3) : 0

  // ── Console summary ──────────────────────────────────────────────────
  console.log("\n" + "─".repeat(74))
  console.log("SUMMARY")
  console.log("─".repeat(74))
  console.log(`scored scenarios : ${scored}  (errors excluded: ${err.length})`)
  console.log(`accepted         : ${ok.length}  (${(accept_rate * 100).toFixed(1)}%)`)
  console.log(`rejected         : ${rej.length}  (${scored > 0 ? ((rej.length / scored) * 100).toFixed(1) : "0"}%)`)
  console.log(`rejection breakdown:`)
  for (const [k, v] of Object.entries(rejection_breakdown)) console.log(`    ${k}: ${v}`)
  if (Object.keys(rejection_breakdown).length === 0) console.log("    (none)")
  console.log(`avg timing       : ${avg_timing_ms}ms`)
  console.log(`total cost        : $${total_cost_usd.toFixed(4)}`)
  if (err.length > 0) {
    console.log(`\nERRORS (${err.length}):`)
    for (const r of err) console.log(`    ${r.input_id}: ${r.error}`)
  }

  // Per-rejection detail (key data for Q2's tune/defer gate)
  if (rej.length > 0) {
    console.log("\n" + "─".repeat(74))
    console.log("REJECTION DETAIL (for Q2 tuning decision)")
    console.log("─".repeat(74))
    for (const r of rej) {
      console.log(`\n[${r.input_id}] ${r.rejection_category} (${r.validator_reason})`)
      console.log(`  bullet : ${r.original_bullet}`)
      console.log(`  draft  : ${r.ai_draft ?? "(none — insufficient evidence)"}`)
      if (r.ungrounded_entities.length > 0)
        console.log(`  ungrounded: ${JSON.stringify(r.ungrounded_entities)}`)
    }
  }

  // ── JSON snapshot ──────────────────────────────────────────────────────
  const snapshot = {
    run_at: runAt,
    model: MODEL,
    measurement: "single-first-attempt-per-scenario (temp 0.7); validator allowed-sources = [original_bullet, user_response]",
    scenario_count: SCENARIOS.length,
    results: {
      accepted: ok.length,
      rejected: rej.length,
      errors: err.length,
      accept_rate,
      rejection_breakdown,
      avg_timing_ms,
      total_cost_usd: +total_cost_usd.toFixed(4),
    },
    per_scenario: results,
  }
  const snapshotPath =
    "tests/positioning-v2/phase2/snapshots/pattern-b-eval-baseline-2026-05-27.json"
  mkdirSync(dirname(snapshotPath), { recursive: true })
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8")
  console.log(`\nSnapshot written: ${snapshotPath}`)

  // Exit non-zero only if EVERY scenario errored (signals a broken setup,
  // not a measurement outcome). Otherwise exit 0 — this is measurement.
  if (scored === 0) {
    console.error("\nAll scenarios errored — harness setup likely broken.")
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("Harness crashed:", e)
  process.exit(1)
})
