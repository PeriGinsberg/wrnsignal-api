// scripts/verify-phase2-itempopulator.mjs
//
// End-to-end smoke for the itemPopulator orchestrator wired into POST
// /api/positioning/v2/phase2/start. Final commit of Stage 2b (Phase 2
// Resume Reframing Workflow — populator wiring). Repeatable verification
// against the deployed staging environment using a self-seeded disposable
// Case B fixture, so it does not interfere with the hand-seeded demo
// fixture phase2_run 9d5ebb75-...
//
// What this verifies:
//   - /start returns 200 for a Case B positioning_run
//   - state.items is shaped per FRD §6.2: headline first, bullets, then
//     gaps, with position-based IDs (headline-1, bullet-N, gap-N)
//   - Each item has correct seed decision fields (accepted/declined/
//     skipped/manual_entry all false; decided_at null; draft/user_response/
//     final_text null where applicable)
//   - Verbatim invariant (ARCHITECTURAL): every bullet item's
//     original_bullet appears character-for-character in the persona's
//     resume_text. resumeComposer locate-and-replace (FRD §6.10) depends
//     on this.
//
// FRD: docs/Features/positioning-phase2-frd.md §6.2, §6.5.1, §6.10
//
// NOTE: FRD §6.5 describes "resume an existing phase2_run" semantics for
// repeat POST /start calls, but the current route implementation returns
// 409 `in_progress_phase2_run_exists` instead. This script avoids that
// by seeding a fresh disposable positioning_run rather than testing
// against existing ones. The FRD-implementation divergence on resume-vs-
// create is a separate scope question, not addressed in Stage 2b.
//
// ============================================================================
// PREREQUISITES
// ============================================================================
//
// 1. Staging URL: https://wrnsignal-api-staging.vercel.app reads from dev
//    Supabase (zydrqckpwidipwbhrfgd). Override via
//    PHASE2_ITEMPOPULATOR_BASE_URL.
// 2. seed-peri-test100.ts has been run on dev (fixture
//    peri+test100@workforcereadynow.com exists with persona f283397c-…
//    owned by profile f8ec230d-…). This script re-uses that persona
//    read-only.
// 3. .env.development.local has all 4 standard Supabase vars:
//    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//    NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
//
// ============================================================================
// USAGE
// ============================================================================
//
//   # Default — staging:
//   node scripts/verify-phase2-itempopulator.mjs
//
//   # Localhost dev server:
//   PHASE2_ITEMPOPULATOR_BASE_URL=http://localhost:3000 \
//     node scripts/verify-phase2-itempopulator.mjs
//
// ============================================================================
// AUTH STRATEGY (matches scripts/verify-phase2-draft.mjs)
// ============================================================================
//
// The fixture user peri+test100 was seeded WITHOUT a password (magic-link
// only). signInWithPassword would fail. Auth path:
//   1. sbAdmin.auth.admin.generateLink({ type: 'magiclink', email })
//   2. sbAnon.auth.verifyOtp({ type: 'magiclink', token_hash })
//   → mints a real session whose access_token is used as Bearer.
//
// Each run invalidates any prior outstanding magic-link tokens for
// peri+test100. Acceptable for a test account.
//
// ============================================================================
// PROD-REFUSAL ALLOWLIST
// ============================================================================
//
// Refuses any BASE_URL that does NOT contain one of: "localhost",
// "staging", "preview", "-git-". Refuses bare "wrnsignal-api.vercel.app"
// (prod). False-refusal preferred over false-allow.
//
// ============================================================================
// CLEANUP INVARIANT
// ============================================================================
//
// Script wraps in try/finally. The finally block deletes (in order):
//   1. phase2_runs WHERE positioning_run_id = <seeded>
//   2. positioning_runs_v2 WHERE id = <seeded>
//   3. jobfit_runs WHERE id = <seeded>
//
// signal_applications: not seeded (positioning_runs_v2.signal_application_id
// is nullable; seed leaves it null).
//
// client_personas: not deleted — the script re-uses Catherine's existing
// persona f283397c-… which is read-only on the /start path.
//
// Cleanup runs even if assertions fail. If the script crashes before the
// finally block, manual sweep recovery:
//   SELECT id FROM positioning_runs_v2 WHERE job_company LIKE '%[verify-itempopulator-%';
//   SELECT id FROM jobfit_runs WHERE fingerprint_hash LIKE 'verify-itempopulator-%';

import { readFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

// ────────────────────────────────────────────────────────────────────────
// Env + clients (matches scripts/verify-phase2-draft.mjs pattern)
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
const FIXTURE_PROFILE_ID = "f8ec230d-c2af-485d-8d48-17cb77470d5c"
const FIXTURE_PERSONA_ID = "f283397c-f26d-43bc-9095-0f77c7d9cea9"

const BASE_URL =
  process.env.PHASE2_ITEMPOPULATOR_BASE_URL ??
  "https://wrnsignal-api-staging.vercel.app"
const ENDPOINT = "/api/positioning/v2/phase2/start"

const TS = Date.now()
const FIXTURE_MARKER = `[verify-itempopulator-${TS}]`

// Case A / Case C negative-path fixtures — not seeded in Stage 2b.
// TODO(v0.2): seed disposable Case A and Case C positioning_runs for
// negative-path coverage; expand assertions here to verify the route
// returns 400 `case_not_supported` for each.
const CASE_A_POSITIONING_RUN_ID = null
const CASE_C_POSITIONING_RUN_ID = null

const NON_PROD_MARKERS = ["localhost", "staging", "preview", "-git-"]

// ────────────────────────────────────────────────────────────────────────
// Prod-refusal guard
// ────────────────────────────────────────────────────────────────────────

if (!NON_PROD_MARKERS.some((m) => BASE_URL.includes(m))) {
  console.error(`\n✗ REFUSED: BASE_URL "${BASE_URL}" does not contain any non-prod marker.`)
  console.error(`  Required: one of [${NON_PROD_MARKERS.join(", ")}]`)
  process.exit(1)
}

// ────────────────────────────────────────────────────────────────────────
// Result tracking
// ────────────────────────────────────────────────────────────────────────

const failures = []
function pass(m) {
  console.log(`  ✓ ${m}`)
}
function fail(m, d) {
  failures.push(m)
  console.log(`  ✗ ${m}${d !== undefined ? ` — ${d}` : ""}`)
}

// ────────────────────────────────────────────────────────────────────────
// HTTP + auth helpers
// ────────────────────────────────────────────────────────────────────────

async function signInViaMagicLink(email) {
  const { data: linkData, error: linkErr } =
    await sbAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    })
  if (linkErr || !linkData?.properties?.hashed_token) {
    throw new Error(
      `generateLink for ${email}: ${linkErr?.message ?? "no hashed_token returned"}`,
    )
  }
  const { data: sessionData, error: verifyErr } =
    await sbAnon.auth.verifyOtp({
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

async function postStart(token, body) {
  const res = await fetch(`${BASE_URL}${ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { _raw: text }
  }
  return { status: res.status, body: json }
}

// ────────────────────────────────────────────────────────────────────────
// Fixture builders
// ────────────────────────────────────────────────────────────────────────

const UNIQUE_GAP_KEY = `verify_itempopulator_gap_${TS}`
const UNIQUE_GAP_LABEL = `verify itempopulator unique gap label ${TS}`

/**
 * Build result_json for the seeded jobfit_run.
 *
 * The why_structured.lead is constructed from a SWOT-style sentence
 * known to be present in Catherine's persona resume_text (see fixture
 * surface in Commit 1). action contains "retitle" so the reframe filter
 * passes. requirement_units[0] has a unique synthetic key + label so
 * it's guaranteed NOT to be represented in any resume and will emit a
 * gap candidate.
 */
function buildResultJson() {
  return {
    decision: "Review",
    score: 60,
    job_signals: {
      jobTitle: `Verify ItemPopulator Test Role ${FIXTURE_MARKER}`,
      jobFamily: "HR",
      companyName: `VerifyTestCorp ${FIXTURE_MARKER}`,
      requirement_units: [
        {
          id: `req-core-${TS}`,
          key: UNIQUE_GAP_KEY,
          kind: "function",
          label: UNIQUE_GAP_LABEL,
          snippet: `JD snippet for the unique requirement ${FIXTURE_MARKER}`,
          strength: 8,
          functionTag: "test",
          requiredness: "core",
        },
        {
          id: `req-supporting-${TS}`,
          key: `verify_itempopulator_supporting_${TS}`,
          kind: "execution",
          label: `verify itempopulator supporting label ${TS}`,
          snippet: `JD snippet for supporting requirement ${FIXTURE_MARKER}`,
          strength: 6,
          functionTag: "test",
          requiredness: "supporting",
        },
      ],
    },
    why_structured: [
      {
        keyword: "ANALYSIS AND REPORTING EXECUTION",
        lead: "You performed industry, audience, and SWOT analyses for a boutique retail brand and presented findings through a professional client deck and written report.",
        connection:
          "This analytical rigor mirrors the data-driven decision-making the target role expects.",
        action: `Please retitle this project bullet to emphasize "data analysis" and "strategic reporting" ${FIXTURE_MARKER}.`,
      },
      {
        keyword: "COLLABORATIVE TEAM OPERATIONS",
        lead: "You coordinated sponsorship, networking, and professional development events as one of 24 students selected from 300+ applicants for BPAD.",
        connection:
          "Track record managing events and stakeholder coordination shows operations under pressure.",
        action: `Mention in your optional letter that you're drawn to understanding how modern media companies coordinate ${FIXTURE_MARKER}.`,
      },
      {
        keyword: "CLIENT COMMUNICATION AND STRATEGY",
        lead: "You collaborated on a brand communications audit including stakeholder interviews, brand immersion, and strategy development aligned with audience insights.",
        connection:
          "The people operations and workforce initiatives require this blend of research, stakeholder engagement, and strategic alignment.",
        action: `Frame this project as "stakeholder research and strategy development" in your cover letter ${FIXTURE_MARKER}.`,
      },
    ],
    risk_structured: [
      {
        keyword: `VERIFY_ITEMPOPULATOR_RISK_${TS}`,
        gap: `Synthetic risk gap for ${FIXTURE_MARKER}`,
        reframe: `Synthetic risk reframe for ${FIXTURE_MARKER}`,
        severity: "medium",
      },
    ],
    risk_codes: [],
    profile_signals: {
      targetFamilies: ["Other"],
    },
  }
}

async function seedJobfitRun(resultJson) {
  const { data, error } = await sbAdmin
    .from("jobfit_runs")
    .insert({
      client_profile_id: FIXTURE_PROFILE_ID,
      persona_id: FIXTURE_PERSONA_ID,
      application_id: null,
      job_url: `https://example.test/${TS}/itempopulator`,
      job_description: `${FIXTURE_MARKER} disposable JD body for itemPopulator verify`,
      fingerprint_hash: `verify-itempopulator-${TS}`,
      fingerprint_code: `verify|itempopulator|${TS}`,
      verdict: resultJson.decision,
      result_json: resultJson,
    })
    .select("id")
    .single()
  if (error || !data?.id) {
    throw new Error(`seedJobfitRun: ${error?.message ?? "no id returned"}`)
  }
  return data.id
}

async function seedPositioningRun(jobfitRunId) {
  const nowIso = new Date().toISOString()
  const { data, error } = await sbAdmin
    .from("positioning_runs_v2")
    .insert({
      profile_id: FIXTURE_PROFILE_ID,
      persona_id: FIXTURE_PERSONA_ID,
      jobfit_run_id: jobfitRunId,
      signal_application_id: null,
      job_title: `Verify ItemPopulator Role ${FIXTURE_MARKER}`,
      job_company: `VerifyTestCorp ${FIXTURE_MARKER}`,
      job_url: null,
      job_description: `${FIXTURE_MARKER} disposable JD body for itemPopulator verify`,
      case_assigned: "B",
      case_reasoning:
        `Seeded by verify-phase2-itempopulator.mjs ${FIXTURE_MARKER}`,
      current_phase: 1,
      phase_data: {
        phase_1: {
          case_assigned_at: nowIso,
          visits: [],
        },
      },
      status: "in_progress",
      fingerprint_hash: `verify-itempopulator-${TS}`,
      fingerprint_code: `verify|itempopulator|${TS}`,
    })
    .select("id")
    .single()
  if (error || !data?.id) {
    throw new Error(`seedPositioningRun: ${error?.message ?? "no id returned"}`)
  }
  return data.id
}

async function readPersonaResumeText(personaId) {
  const { data, error } = await sbAdmin
    .from("client_personas")
    .select("resume_text")
    .eq("id", personaId)
    .maybeSingle()
  if (error) {
    throw new Error(`readPersonaResumeText: ${error.message}`)
  }
  if (!data) {
    throw new Error(`persona ${personaId} not found`)
  }
  return data.resume_text ?? ""
}

// ────────────────────────────────────────────────────────────────────────
// Cleanup
// ────────────────────────────────────────────────────────────────────────

async function cleanup(seededPositioningRunId, seededJobfitRunId) {
  console.log("\n=== CLEANUP ===")

  if (seededPositioningRunId) {
    const { count: phase2Count, error: phase2Err } = await sbAdmin
      .from("phase2_runs")
      .delete({ count: "exact" })
      .eq("positioning_run_id", seededPositioningRunId)
    if (phase2Err) {
      console.log(`  ✗ delete phase2_runs: ${phase2Err.message}`)
    } else {
      console.log(`  ✓ deleted phase2_runs rows: ${phase2Count ?? 0}`)
    }

    const { count: posCount, error: posErr } = await sbAdmin
      .from("positioning_runs_v2")
      .delete({ count: "exact" })
      .eq("id", seededPositioningRunId)
    if (posErr) {
      console.log(`  ✗ delete positioning_runs_v2: ${posErr.message}`)
    } else {
      console.log(`  ✓ deleted positioning_runs_v2 rows: ${posCount ?? 0}`)
    }
  }

  if (seededJobfitRunId) {
    const { count: jfCount, error: jfErr } = await sbAdmin
      .from("jobfit_runs")
      .delete({ count: "exact" })
      .eq("id", seededJobfitRunId)
    if (jfErr) {
      console.log(`  ✗ delete jobfit_runs: ${jfErr.message}`)
    } else {
      console.log(`  ✓ deleted jobfit_runs rows: ${jfCount ?? 0}`)
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("[verify-phase2-itempopulator] starting against", BASE_URL)
  console.log(`  Dev project: ${env.SUPABASE_URL}`)
  console.log(`  Fixture marker: ${FIXTURE_MARKER}`)

  let seededJobfitRunId = null
  let seededPositioningRunId = null

  try {
    // ── Step 1: Seed disposable Case B fixture ────────────────────────────
    console.log("\n=== SEED ===")
    const resultJson = buildResultJson()
    seededJobfitRunId = await seedJobfitRun(resultJson)
    pass(`seeded jobfit_run id=${seededJobfitRunId}`)
    seededPositioningRunId = await seedPositioningRun(seededJobfitRunId)
    pass(`seeded positioning_run id=${seededPositioningRunId} case=B`)

    // ── Step 2: Read persona resume_text up-front for verbatim check ──────
    const resumeText = await readPersonaResumeText(FIXTURE_PERSONA_ID)
    pass(`fetched persona resume_text (length=${resumeText.length})`)
    if (resumeText.length === 0) {
      fail("persona resume_text is empty — /start will 400 persona_resume_text_empty")
      throw new Error("aborting; persona resume_text is empty")
    }

    // ── Step 3: Sign in as peri+test100 ───────────────────────────────────
    console.log("\n=== AUTH ===")
    const token = await signInViaMagicLink(FIXTURE_EMAIL)
    pass(`JWT minted (${token.slice(0, 20)}…)`)

    // ── Step 4: HAPPY PATH — POST /start ──────────────────────────────────
    console.log("\n=== HAPPY PATH (Case B / seeded fixture) ===")
    const startTime = Date.now()
    const res = await postStart(token, {
      positioning_run_id: seededPositioningRunId,
    })
    const latencyMs = Date.now() - startTime
    console.log(`  status=${res.status} latencyMs=${latencyMs}`)

    if (res.status !== 200) {
      fail(`expected 200, got ${res.status}`, JSON.stringify(res.body).slice(0, 300))
      // Continue to verify error envelope but skip item-shape assertions
    } else {
      pass(`POST /start → 200`)
    }

    // ── Step 5: Response envelope assertions ──────────────────────────────
    const body = res.body ?? {}
    if (typeof body.phase2_run_id === "string" && /^[0-9a-f-]{36}$/i.test(body.phase2_run_id)) {
      pass(`body.phase2_run_id is a UUID (${body.phase2_run_id})`)
    } else {
      fail("body.phase2_run_id missing or not a UUID", String(body.phase2_run_id))
    }

    const items = body.state?.items
    if (Array.isArray(items)) {
      pass(`body.state.items is an array (length=${items.length})`)
    } else {
      fail("body.state.items is not an array", JSON.stringify(body.state).slice(0, 200))
    }

    const safeItems = Array.isArray(items) ? items : []

    if (safeItems.length >= 1) {
      pass(`items.length >= 1 (seeded fixture must produce items)`)
    } else {
      fail("items.length < 1", `length=${safeItems.length}`)
    }

    // ── Step 6: Per-item shape ────────────────────────────────────────────
    console.log("\n=== ITEM SHAPE ===")
    const validTypes = new Set(["headline", "bullet", "gap"])
    let allTypesValid = true
    let allIdsValid = true
    let allSeedFlagsCorrect = true
    for (const it of safeItems) {
      if (!validTypes.has(it.type)) {
        allTypesValid = false
        console.log(`    bad type on ${it.id}: ${it.type}`)
      }
      if (typeof it.id !== "string" || it.id.length === 0) {
        allIdsValid = false
      }
      // Seed decision fields must all be false / null
      if (
        it.accepted !== false ||
        it.declined !== false ||
        it.skipped !== false ||
        it.manual_entry !== false ||
        it.decided_at !== null ||
        it.final_text !== null
      ) {
        allSeedFlagsCorrect = false
        console.log(
          `    bad seed flags on ${it.id}: accepted=${it.accepted} declined=${it.declined} skipped=${it.skipped} manual_entry=${it.manual_entry} decided_at=${it.decided_at} final_text=${it.final_text}`,
        )
      }
    }
    if (allTypesValid) pass("every item.type ∈ {headline, bullet, gap}")
    else fail("at least one item.type is invalid")
    if (allIdsValid) pass("every item.id is a non-empty string")
    else fail("at least one item.id is invalid")
    if (allSeedFlagsCorrect) pass("every item has seed decision fields (all false / null)")
    else fail("at least one item has incorrect seed decision fields")

    // ── Step 7: Position-based ID scheme ──────────────────────────────────
    let positionIdsValid = true
    let bulletCounter = 0
    let gapCounter = 0
    for (const it of safeItems) {
      if (it.type === "headline") {
        if (it.id !== "headline-1") {
          positionIdsValid = false
          console.log(`    headline expected id=headline-1, got ${it.id}`)
        }
      } else if (it.type === "bullet") {
        bulletCounter++
        const expected = `bullet-${bulletCounter}`
        if (it.id !== expected) {
          positionIdsValid = false
          console.log(`    bullet expected id=${expected}, got ${it.id}`)
        }
      } else if (it.type === "gap") {
        gapCounter++
        const expected = `gap-${gapCounter}`
        if (it.id !== expected) {
          positionIdsValid = false
          console.log(`    gap expected id=${expected}, got ${it.id}`)
        }
      }
    }
    if (positionIdsValid) pass(`position-based IDs correct (headline-1, bullet-1..${bulletCounter}, gap-1..${gapCounter})`)
    else fail("position-based ID scheme violated")

    // ── Step 8: Ordering invariant (headline → bullets → gaps) ────────────
    let orderingValid = true
    let lastBucket = 0 // 0=headline, 1=bullet, 2=gap
    for (const it of safeItems) {
      const bucket = it.type === "headline" ? 0 : it.type === "bullet" ? 1 : 2
      if (bucket < lastBucket) {
        orderingValid = false
        console.log(`    ordering violated at ${it.id} (type=${it.type})`)
        break
      }
      lastBucket = bucket
    }
    if (orderingValid) pass("ordering: headline → bullets → gaps preserved")
    else fail("ordering invariant violated")

    // ── Step 9: Type counts (seeded fixture should produce ≥1 of each) ────
    const headlineCount = safeItems.filter((i) => i.type === "headline").length
    const bulletCount = safeItems.filter((i) => i.type === "bullet").length
    const gapCount = safeItems.filter((i) => i.type === "gap").length
    console.log(`\n=== TYPE COUNTS ===`)
    console.log(`  headline=${headlineCount} bullet=${bulletCount} gap=${gapCount}`)
    if (headlineCount === 1) pass("exactly 1 headline item (seeded jobTitle present)")
    else fail(`expected exactly 1 headline, got ${headlineCount}`)
    if (bulletCount >= 1) pass(`≥1 bullet item (reframe-flavored why anchored)`)
    else fail("expected ≥1 bullet (seeded fixture should anchor at least 1 reframe-flavored why)")
    if (gapCount >= 1) pass(`≥1 gap item (synthetic core requirement unrepresented)`)
    else fail("expected ≥1 gap (seeded fixture has 1 core requirement with unique unrep'd key)")

    // ── Step 10: Verbatim invariant (ARCHITECTURAL) ───────────────────────
    console.log("\n=== VERBATIM INVARIANT ===")
    const bulletItems = safeItems.filter((i) => i.type === "bullet")
    if (bulletItems.length === 0) {
      console.log("  (no bullet items — skipping verbatim check)")
    } else {
      let allVerbatim = true
      for (const b of bulletItems) {
        if (typeof b.original_bullet !== "string" || b.original_bullet.length === 0) {
          allVerbatim = false
          fail(`${b.id}: original_bullet missing or not a string`)
          continue
        }
        if (resumeText.includes(b.original_bullet)) {
          pass(`${b.id}: original_bullet found char-for-char in resume_text`)
        } else {
          allVerbatim = false
          fail(
            `${b.id}: original_bullet NOT found in resume_text`,
            `"${b.original_bullet.slice(0, 80)}…"`,
          )
        }
      }
      if (allVerbatim) pass("verbatim invariant holds for every bullet item")
    }

    // ── Step 11: Gap item content sanity (synthetic unique key flows) ─────
    const gapItems = safeItems.filter((i) => i.type === "gap")
    const seededGap = gapItems.find((g) => g.label === `Address ${UNIQUE_GAP_KEY}`)
    if (seededGap) {
      pass(`synthetic gap surfaces with label "Address ${UNIQUE_GAP_KEY}"`)
      if (seededGap.gap_description === UNIQUE_GAP_LABEL) {
        pass(`gap.gap_description = requirement.label`)
      } else {
        fail(`gap.gap_description mismatch`, seededGap.gap_description?.slice(0, 80))
      }
      if (typeof seededGap.question_asked === "string" &&
          seededGap.question_asked.startsWith("The job asks for: ") &&
          /if you genuinely don't have this experience, that's fine/i.test(seededGap.question_asked)) {
        pass(`gap.question_asked uses Pattern C template with load-bearing exit clause`)
      } else {
        fail(`gap.question_asked malformed`, seededGap.question_asked?.slice(0, 80))
      }
      // A2 multi-outcome composition fields — populator emits safe defaults.
      // /decide (C1) sets compositional_outcome + target_bullet_text on
      // accept; aiClient (A3) populates suggested_bullets_for_reword.
      if (seededGap.compositional_outcome === null) {
        pass(`gap.compositional_outcome === null (A2 default, undecided)`)
      } else {
        fail(`gap.compositional_outcome should be null on populator emit`,
             String(seededGap.compositional_outcome))
      }
      if (seededGap.target_bullet_text === null) {
        pass(`gap.target_bullet_text === null (A2 default, no reword target until C1)`)
      } else {
        fail(`gap.target_bullet_text should be null on populator emit`,
             String(seededGap.target_bullet_text))
      }
      // G1: gap_shape is populated by classifyGapShape at populator time.
      // Acceptance: field is a string in the 7-value union. The seeded
      // synthetic gap's label is generic ("verify itempopulator unique
      // gap label ...") so the heuristic should fall to PASS 6 and
      // either land on the Claude classification result OR "experience"
      // (the safe default). Either outcome is legal; this just asserts
      // the field is present and from the legal set.
      const validGapShapes = new Set([
        "experience",
        "skill",
        "certification",
        "tool",
        "language",
        "coursework",
        "unknown",
      ])
      if (typeof seededGap.gap_shape !== "string") {
        fail(
          "gap.gap_shape must be a string",
          JSON.stringify(seededGap.gap_shape),
        )
      } else if (!validGapShapes.has(seededGap.gap_shape)) {
        fail(
          "gap.gap_shape must be one of the 7-value union",
          seededGap.gap_shape,
        )
      } else {
        pass(`gap.gap_shape === '${seededGap.gap_shape}' (G1 classifier output, legal value)`)
      }
      // A3: suggested_bullets_for_reword is populated by aiClient.suggestBulletsForGap
      // at populator time against the real Anthropic API on staging.
      // Acceptance criteria (FRD §6.10 + A3 verbatim invariant):
      //   - field is an Array (always)
      //   - length is 0..3 (capped at MAX_SUGGESTED_BULLETS)
      //   - every entry is a verbatim substring of persona.resume_text
      //     (resumeComposer locate-and-replace dependency)
      // Empty array is acceptable — the seeded fixture's Kubernetes
      // requirement may genuinely have no relevant bullets in Catherine's
      // marketing/design resume. Logged informational rather than failed.
      if (!Array.isArray(seededGap.suggested_bullets_for_reword)) {
        fail(`gap.suggested_bullets_for_reword must be an Array`,
             JSON.stringify(seededGap.suggested_bullets_for_reword))
      } else {
        const suggestions = seededGap.suggested_bullets_for_reword
        if (suggestions.length === 0) {
          pass(`gap.suggested_bullets_for_reword is [] (Claude found no relevant bullets for the Kubernetes-flavored synthetic gap against Catherine's marketing resume — acceptable degradation per A3 spec)`)
        } else if (suggestions.length > 3) {
          fail(`gap.suggested_bullets_for_reword should cap at 3`,
               `length=${suggestions.length}`)
        } else {
          pass(`gap.suggested_bullets_for_reword.length === ${suggestions.length} (0..3, capped)`)
          let allVerbatim = true
          for (let i = 0; i < suggestions.length; i++) {
            const s = suggestions[i]
            if (typeof s !== "string" || !resumeText.includes(s)) {
              allVerbatim = false
              console.log(`       FAIL: suggestion[${i}] not verbatim in resume_text: ${JSON.stringify(s).slice(0, 100)}`)
            }
          }
          if (allVerbatim) {
            pass(`every suggestion is a verbatim substring of persona.resume_text (A3 invariant)`)
          } else {
            fail(`A3 verbatim invariant breached on live staging data`)
          }
        }
      }
    } else {
      fail("seeded synthetic gap not found among gap items", gapItems.map((g) => g.label).join("|"))
    }

    // ── Step 12: Bullet question template ──────────────────────────────────
    if (bulletItems.length > 0) {
      const b = bulletItems[0]
      if (typeof b.question_asked === "string" &&
          b.question_asked.startsWith("You wrote: \"") &&
          /2-4 sentences/i.test(b.question_asked)) {
        pass(`bullet.question_asked uses Pattern B template`)
      } else {
        fail(`bullet.question_asked malformed`, b.question_asked?.slice(0, 80))
      }
    }

    // ── Step 13: NEGATIVE PATH — Case A (skipped) ─────────────────────────
    console.log("\n=== NEGATIVE PATH — Case A ===")
    if (CASE_A_POSITIONING_RUN_ID === null) {
      console.log("  SKIP — Case A fixture not seeded on staging (TODO: seed for v0.2 verification)")
    }

    // ── Step 14: NEGATIVE PATH — Case C (skipped) ─────────────────────────
    console.log("\n=== NEGATIVE PATH — Case C ===")
    if (CASE_C_POSITIONING_RUN_ID === null) {
      console.log("  SKIP — Case C fixture not seeded on staging (TODO: seed for v0.2 verification)")
    }
  } finally {
    // Cleanup runs even on assertion failure or thrown error.
    await cleanup(seededPositioningRunId, seededJobfitRunId)
  }

  // ── Result ──────────────────────────────────────────────────────────────
  console.log(`\n=== RESULT: ${failures.length === 0 ? "PASS" : "FAIL"} ===`)
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
