// scripts/verify-phase2-draft.mjs
//
// End-to-end smoke for POST /api/positioning/v2/phase2/{id}/draft.
// Final commit of Stage 2c (Phase 2 Resume Reframing Workflow). Repeatable
// verification that the full /draft path works against real Claude Haiku:
//   - JWT auth via Bearer header
//   - Anthropic API call via aiClient (real Claude, real tokens)
//   - groundingValidator three-rule check
//   - State mutation persisted to phase2_runs.state JSONB
//   - Token-accurate cost increment to phase2_runs.ai_cost_cents
//
// FRD: docs/Features/positioning-phase2-frd.md §6.6 (/draft endpoint),
//      §6.7 (AI integration), §6.8 (grounding), §6.12 (cost cap)
//
// ============================================================================
// PREREQUISITES
// ============================================================================
//
// 1. Local: `npm run dev` running (default localhost:3000)
//    OR staging URL: set PHASE2_DRAFT_BASE_URL=https://wrnsignal-api-staging.vercel.app
// 2. seed-peri-test100.ts has been run on dev — creates the magic-link-only
//    fixture user peri+test100@workforcereadynow.com
// 3. A phase2_run owned by peri+test100 exists in 'in_progress' status with
//    at least one undecided headline-type item (run /start + populator first)
// 4. .env.development.local has all 4 standard Supabase vars:
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//    NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
//
// ============================================================================
// USAGE
// ============================================================================
//
//   # Default (localhost), interactive cost confirmation:
//   node scripts/verify-phase2-draft.mjs <phase2_run_uuid>
//
//   # Against staging:
//   PHASE2_DRAFT_BASE_URL=https://wrnsignal-api-staging.vercel.app \
//     node scripts/verify-phase2-draft.mjs <phase2_run_uuid>
//
//   # CI / non-interactive (skip cost confirmation prompt):
//   node scripts/verify-phase2-draft.mjs <phase2_run_uuid> --no-confirm
//
// ============================================================================
// AUTH STRATEGY (Option A — generateLink + verifyOtp)
// ============================================================================
//
// The fixture user peri+test100 was seeded WITHOUT a password (magic-link
// only — see scripts/seed-peri-test100.ts). signInWithPassword would fail.
// Instead this script uses the documented service-role pattern:
//
//   1. sbAdmin.auth.admin.generateLink({ type: 'magiclink', email })
//      → returns { properties: { hashed_token, ... } }. NO email sent
//      (confirmed by existing usage at app/api/coach/create-client/route.ts
//      which generates the link, then dispatches via its own delivery).
//   2. sbAnon.auth.verifyOtp({ type: 'magiclink', token_hash })
//      → mints a real session with access_token (the JWT we use as Bearer).
//
// SIDE EFFECT: each run invalidates any prior outstanding magic-link tokens
// for peri+test100. Acceptable for a test account; do not run while a real
// human is trying to log in as this user.
//
// ============================================================================
// PROD-REFUSAL ALLOWLIST
// ============================================================================
//
// To prevent accidentally running against production, this script refuses
// any BASE_URL that does NOT contain at least one of these markers:
//   "localhost", "staging", "preview", "-git-" (Vercel preview branch pattern)
// In particular, refuses bare "wrnsignal-api.vercel.app" (prod).
// False-refusal of a legitimate URL is preferred over false-allow of prod.
//
// ============================================================================
// CLEANUP
// ============================================================================
//
// This script does NOT clean up — the fixture phase2_run is left mutated
// (ai_cost_cents incremented, possibly state.items[idx].draft_options
// populated). To re-run against the same fixture, reset via SQL Editor:
//
//   UPDATE phase2_runs
//   SET ai_cost_cents = 0,
//       state = jsonb_set(
//         state,
//         '{items}',
//         (
//           SELECT jsonb_agg(
//             CASE
//               WHEN i->>'type' = 'headline'
//                 THEN jsonb_set(i, '{draft_options}', '[]'::jsonb)
//               ELSE i
//             END
//           )
//           FROM jsonb_array_elements(state->'items') i
//         )
//       )
//   WHERE id = '<phase2_run_uuid>';
//
// Or simpler: run /start with a fresh jobfit_run to create a new phase2_run
// and use that ID.

import { readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { createClient } from "@supabase/supabase-js"

// ────────────────────────────────────────────────────────────────────────
// Env loading (matches scripts/verify-positioning-v2-start.mjs pattern)
// ────────────────────────────────────────────────────────────────────────

const env = Object.fromEntries(
  readFileSync(".env.development.local", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=")
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const required = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
]
for (const k of required) {
  if (!env[k]) {
    console.error(`Missing required env var in .env.development.local: ${k}`)
    process.exit(1)
  }
}

const sbAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const sbAnon = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

const FIXTURE_EMAIL = "peri+test100@workforcereadynow.com"
const BASE_URL =
  process.env.PHASE2_DRAFT_BASE_URL ?? "http://localhost:3000"

// Allowlist of substrings that mark non-prod URLs. URL must contain at
// least one. Falses-refuse legitimate URLs rather than false-allow prod.
const NON_PROD_MARKERS = ["localhost", "staging", "preview", "-git-"]

// ────────────────────────────────────────────────────────────────────────
// CLI arg parsing
// ────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const phase2RunId = args.find((a) => !a.startsWith("--"))
const noConfirm = args.includes("--no-confirm")

if (!phase2RunId) {
  console.error("Usage: node scripts/verify-phase2-draft.mjs <phase2_run_uuid> [--no-confirm]")
  console.error("       PHASE2_DRAFT_BASE_URL=<url> overrides the default http://localhost:3000")
  process.exit(1)
}

// ────────────────────────────────────────────────────────────────────────
// Prod-refusal guard
// ────────────────────────────────────────────────────────────────────────

if (!NON_PROD_MARKERS.some((m) => BASE_URL.includes(m))) {
  console.error(`\n✗ REFUSED: BASE_URL "${BASE_URL}" does not contain any non-prod marker.`)
  console.error(`  Required: one of [${NON_PROD_MARKERS.join(", ")}]`)
  console.error(`  To run against prod, edit NON_PROD_MARKERS in this script (don't).`)
  process.exit(1)
}

// ────────────────────────────────────────────────────────────────────────
// Result tracking
// ────────────────────────────────────────────────────────────────────────

const failures = []
function pass(m) { console.log(`  ✓ ${m}`) }
function fail(m, d) {
  failures.push(m)
  console.log(`  ✗ ${m}${d !== undefined ? ` — ${d}` : ""}`)
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function signInViaMagicLink(email) {
  const { data: linkData, error: linkErr } = await sbAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(
      `generateLink for ${email}: ${linkErr?.message ?? "no hashed_token returned"}`,
    )
  }
  const { data: sessionData, error: verifyErr } = await sbAnon.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  })
  if (verifyErr || !sessionData?.session) {
    throw new Error(
      `verifyOtp for ${email}: ${verifyErr?.message ?? "no session returned"}`,
    )
  }
  return sessionData.session.access_token
}

async function postDraft(token, runId, itemId) {
  const res = await fetch(
    `${BASE_URL}/api/positioning/v2/phase2/${runId}/draft`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ item_id: itemId }),
    },
  )
  const text = await res.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { _raw: text }
  }
  return { status: res.status, body }
}

async function readPhase2Run(id) {
  const { data, error } = await sbAdmin
    .from("phase2_runs")
    .select("id, profile_id, status, ai_cost_cents, state")
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error(`readPhase2Run ${id}: ${error.message}`)
  if (!data) throw new Error(`phase2_run ${id} not found`)
  return data
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Dev project: ${env.SUPABASE_URL}`)
  console.log(`Base URL:    ${BASE_URL}`)
  console.log(`phase2_run:  ${phase2RunId}\n`)

  // ── Step 1: Read fixture + validate state ──────────────────────────────
  console.log("=== Step 1: Read fixture phase2_run ===")
  const initialRun = await readPhase2Run(phase2RunId)
  pass(`phase2_run loaded: status=${initialRun.status}, ai_cost_cents=${initialRun.ai_cost_cents}`)

  if (initialRun.status !== "in_progress") {
    fail(`fixture status must be 'in_progress'`, `got '${initialRun.status}'`)
    process.exit(1)
  }
  if (!Array.isArray(initialRun.state?.items) || initialRun.state.items.length === 0) {
    fail("fixture state.items must be non-empty array")
    process.exit(1)
  }

  // ── Step 2: Find an undecided headline item ────────────────────────────
  const targetItem = initialRun.state.items.find(
    (it) =>
      it.type === "headline" &&
      !it.accepted &&
      !it.declined &&
      !it.skipped,
  )
  if (!targetItem) {
    fail("no undecided headline item found in fixture state.items")
    console.error("  Need at least one item with type='headline' and accepted/declined/skipped all false.")
    process.exit(1)
  }
  pass(`target item: id=${targetItem.id} type=headline original="${targetItem.original.slice(0, 60)}…"`)

  // ── Step 3: Verify ownership ───────────────────────────────────────────
  console.log("\n=== Step 2: Verify fixture is owned by peri+test100 ===")
  const { data: profile, error: profErr } = await sbAdmin
    .from("client_profiles")
    .select("user_id, email")
    .eq("id", initialRun.profile_id)
    .maybeSingle()
  if (profErr || !profile) {
    fail("could not look up owning profile", profErr?.message)
    process.exit(1)
  }
  if (profile.email !== FIXTURE_EMAIL) {
    fail(`fixture must be owned by ${FIXTURE_EMAIL}`, `got '${profile.email}'`)
    process.exit(1)
  }
  pass(`owner verified: ${FIXTURE_EMAIL}`)

  // ── Step 4: Cost confirmation prompt ───────────────────────────────────
  if (!noConfirm) {
    console.log("\n=== Cost confirmation ===")
    console.log(`This will call the real Claude API and cost approximately $0.01.`)
    console.log(`Target: ${BASE_URL}`)
    console.log(`Phase 2 run: ${phase2RunId}`)
    const answer = await prompt("Continue? (y/N): ")
    if (answer.toLowerCase() !== "y") {
      console.log("Declined. Exiting cleanly.")
      process.exit(0)
    }
  }

  // ── Step 5: Sign in via magic-link → JWT ───────────────────────────────
  console.log("\n=== Step 3: Sign in as peri+test100 (generateLink + verifyOtp) ===")
  const token = await signInViaMagicLink(FIXTURE_EMAIL)
  pass(`JWT minted (${token.slice(0, 20)}…)`)

  // ── Step 6: POST /draft ────────────────────────────────────────────────
  console.log("\n=== Step 4: POST /draft ===")
  const startTime = Date.now()
  const res = await postDraft(token, phase2RunId, targetItem.id)
  const latencyMs = Date.now() - startTime
  console.log(`  status: ${res.status}, latencyMs: ${latencyMs}`)

  // ── Step 7: Assert response shape ──────────────────────────────────────
  if (res.status === 200) {
    pass(`200 OK`)
    if (!Array.isArray(res.body.drafts) || res.body.drafts.length < 1) {
      fail("200 response: drafts array missing or empty", JSON.stringify(res.body).slice(0, 200))
    } else {
      pass(`drafts array present (${res.body.drafts.length} options)`)
      console.log(`    first draft: "${String(res.body.drafts[0]).slice(0, 80)}…"`)
    }
    if (res.body.item_id !== targetItem.id) {
      fail("item_id echo mismatch", `expected ${targetItem.id}, got ${res.body.item_id}`)
    } else {
      pass(`item_id echoed correctly`)
    }
    if (typeof res.body.generated_at !== "string") {
      fail("generated_at missing or not a string", typeof res.body.generated_at)
    } else {
      pass(`generated_at present`)
    }
  } else if (res.status === 422) {
    pass(`422 grounding_failed (acceptable outcome — Claude refused or validator rejected)`)
    if (res.body.error !== "grounding_failed") {
      fail("422 response: error envelope wrong", JSON.stringify(res.body).slice(0, 200))
    } else {
      pass(`error envelope: grounding_failed`)
    }
  } else {
    fail(`unexpected status ${res.status}`, JSON.stringify(res.body).slice(0, 300))
    process.exit(1)
  }

  // ── Step 8: Re-read phase2_run + assert mutations ──────────────────────
  console.log("\n=== Step 5: Re-read phase2_run + assert DB mutations ===")
  const finalRun = await readPhase2Run(phase2RunId)

  const costDelta = finalRun.ai_cost_cents - initialRun.ai_cost_cents
  if (costDelta >= 1) {
    pass(`ai_cost_cents incremented by ${costDelta} (was ${initialRun.ai_cost_cents}, now ${finalRun.ai_cost_cents})`)
  } else {
    fail(`ai_cost_cents did not increment as expected`, `delta=${costDelta}`)
  }

  const finalItem = finalRun.state.items.find((it) => it.id === targetItem.id)
  if (!finalItem) {
    fail(`target item disappeared from state after /draft`)
  } else if (res.status === 200) {
    if (!Array.isArray(finalItem.draft_options) || finalItem.draft_options.length < 1) {
      fail(`200 path: state.items[i].draft_options should be populated`, JSON.stringify(finalItem.draft_options))
    } else {
      pass(`state.items[i].draft_options populated (${finalItem.draft_options.length} options)`)
    }
  } else {
    // 422 path: draft_options should be unchanged (still empty)
    const initialItem = initialRun.state.items.find((it) => it.id === targetItem.id)
    if (
      JSON.stringify(finalItem.draft_options) !==
      JSON.stringify(initialItem.draft_options)
    ) {
      fail(`422 path: state.items[i].draft_options should be unchanged`, `before=${JSON.stringify(initialItem.draft_options)} after=${JSON.stringify(finalItem.draft_options)}`)
    } else {
      pass(`422 path: state.items[i].draft_options unchanged (as expected)`)
    }
  }

  // ── Result ─────────────────────────────────────────────────────────────
  console.log(`\n=== RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} ===`)
  console.log(`  status=${res.status}  latencyMs=${latencyMs}  costDelta=${costDelta}c`)
  if (failures.length) {
    console.log("Failures:")
    for (const f of failures) console.log(`  - ${f}`)
    process.exit(1)
  }
  console.log("All assertions passed.")
}

main().catch((e) => {
  console.error(`\n✗ Fatal: ${e instanceof Error ? e.message : String(e)}`)
  if (e instanceof Error && e.stack) {
    console.error(e.stack.split("\n").slice(0, 5).join("\n"))
  }
  process.exit(1)
})
