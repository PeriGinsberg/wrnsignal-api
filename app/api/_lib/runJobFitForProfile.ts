// app/api/_lib/runJobFitForProfile.ts
//
// Shared JobFit pipeline used by /api/jobfit and /api/coach/recommend-job.
// The goal of this module is to eliminate drift between the client-side and
// coach-side JobFit paths — previously the coach path silently omitted
// client_profiles.resume_text from scoring input and skipped the V5 AI
// bullet renderer entirely.
//
// This module exposes:
//   - `assembleProfileForScoring`: loads client_profiles (+ optional persona)
//     and produces the combined profileText + profileOverrides that feed the
//     scoring engine. Split out so callers that cache on fingerprint (i.e.
//     /api/jobfit) can compute the fingerprint BEFORE running the full
//     pipeline without duplicating the load.
//   - `computeJobFitFingerprint`: deterministic fingerprint of job × profile
//     × logic-version. Formerly inline in /api/jobfit/route.ts; lifted here
//     so coach-path cache keys (when added later) stay in sync.
//   - `runJobFitForProfile`: the full pipeline — assemble → runJobFit →
//     V5 bullets → enforceClientFacingRules. This is the primary export
//     and the single source of truth for JobFit output shape.
//
// PERSONA SEMANTICS (standardized here):
//   personaId must be explicitly passed. When it is absent, the function
//   scores against client_profiles.resume_text as the base resume. It does
//   NOT auto-pick the most recent persona — that behavior used to exist
//   only on the coach path and has been removed for consistency. Coach
//   UIs that relied on implicit persona selection must now select a
//   persona explicitly before sourcing.
//
// V5 SEMANTICS:
//   The AI bullet generator runs by default. On error, the pipeline
//   silently falls back to V4 deterministic bullets and surfaces the
//   V5 error in the returned `debug` block — matching the prior
//   behavior of /api/jobfit.

import crypto from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import { runJobFit } from "./jobfitEvaluator"
import { mapClientProfileToOverrides } from "./jobfitProfileAdapter"
import { enforceClientFacingRules } from "../jobfit/enforceClientFacingRules"
import type { StructuredProfileSignals } from "../jobfit/signals"

const MISSING = "__MISSING__"

// Same version-resolution chain used previously in /api/jobfit/route.ts —
// pinned per-deploy via Vercel's commit SHA so every deploy invalidates
// the jobfit_runs cache automatically.
export const JOBFIT_LOGIC_VERSION =
  process.env.JOBFIT_LOGIC_VERSION ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  "local-dev"

// ── Types ─────────────────────────────────────────────────────────────

type ClientProfileRow = {
  id: string
  profile_text: string | null
  resume_text: string | null
  profile_structured: Record<string, any> | null
  target_roles: string | null
  target_locations: string | null
  profile_version: number | null
}

type PersonaRow = {
  id: string
  profile_id: string
  resume_text: string | null
  persona_version: number | null
  structured_data: Record<string, any> | null
  name: string | null
}

export type AssembledProfile = {
  profileId: string
  clientProfile: ClientProfileRow
  persona: PersonaRow | null
  effectiveProfileText: string
  profileOverrides: Partial<StructuredProfileSignals>
  profileVersionAtRun: number | null
  personaVersionAtRun: number | null
}

export type RunJobFitForProfileResult = {
  // Core engine output
  decision: any
  score: number
  icon: string
  bullets: string[]
  risk_flags: string[]
  next_step: string
  why_codes: any
  risk_codes: any
  job_signals: any
  profile_signals: any
  gate_triggered: any
  score_breakdown: any
  location_constraint: any

  // V5 outputs (undefined when V5 fell back to V4)
  why?: string[]
  risk?: string[]
  why_structured?: any
  risk_structured?: any
  cover_letter_strategy?: any

  // Cache key + version
  fingerprint_hash: string
  fingerprint_code: string
  jobfit_logic_version: string

  // Versioning for audit trail
  profileVersionAtRun: number | null
  personaVersionAtRun: number | null

  // Persona metadata (coach route needs name for recommendation row)
  personaId: string | null
  personaName: string | null

  debug: Record<string, unknown>
}

// ── Fingerprint ───────────────────────────────────────────────────────

function normalize(value: any): any {
  if (typeof value === "string") {
    const cleaned = value.trim()
    if (!cleaned) return MISSING
    return cleaned.toLowerCase().replace(/\s+/g, " ")
  }
  if (Array.isArray(value)) return value.map(normalize).sort()
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc: any, k) => {
        const v = value[k]
        if (v !== null && v !== undefined) acc[k] = normalize(v)
        return acc
      }, {})
  }
  return value
}

export function computeJobFitFingerprint(params: {
  jobText: string
  clientProfileId: string
  effectiveProfileText: string
  profileOverrides: Partial<StructuredProfileSignals> | null
}): { fingerprint_hash: string; fingerprint_code: string } {
  const payload = {
    job: { text: params.jobText || MISSING },
    profile: {
      id: params.clientProfileId || MISSING,
      text: params.effectiveProfileText || MISSING,
      overrides: params.profileOverrides || MISSING,
    },
    system: { jobfit_logic_version: JOBFIT_LOGIC_VERSION },
  }
  const canonical = JSON.stringify(normalize(payload))
  const fingerprint_hash = crypto.createHash("sha256").update(canonical).digest("hex")
  const fingerprint_code =
    "JF-" + parseInt(fingerprint_hash.slice(0, 10), 16).toString(36).toUpperCase()
  return { fingerprint_hash, fingerprint_code }
}

// ── Profile assembly ──────────────────────────────────────────────────

const PROFILE_SELECT =
  "id,profile_text,resume_text,profile_structured,target_roles,target_locations,profile_version"

/**
 * Loads client_profiles (+ optional persona) and assembles the combined
 * profileText and profileOverrides that feed JobFit scoring.
 *
 * Persona resolution:
 *   - If personaId is provided, the row is fetched and its profile_id is
 *     verified against clientProfileId. Mismatch throws.
 *   - If personaId is provided but the persona has empty resume_text, we
 *     fall through to client_profiles.resume_text rather than scoring
 *     against an empty resume.
 *   - If personaId is absent, client_profiles.resume_text is used. No
 *     auto-picking of latest persona.
 */
export async function assembleProfileForScoring(params: {
  clientProfileId: string
  personaId?: string | null
  supabase: SupabaseClient
}): Promise<AssembledProfile> {
  const { clientProfileId, personaId, supabase } = params

  if (!clientProfileId) {
    throw new Error("assembleProfileForScoring: clientProfileId is required")
  }

  const { data: clientProfileRaw, error: cpErr } = await supabase
    .from("client_profiles")
    .select(PROFILE_SELECT)
    .eq("id", clientProfileId)
    .maybeSingle<ClientProfileRow>()

  if (cpErr) {
    throw new Error(`assembleProfileForScoring: client_profiles lookup failed: ${cpErr.message}`)
  }
  if (!clientProfileRaw) {
    throw new Error(`assembleProfileForScoring: client profile not found: ${clientProfileId}`)
  }
  const clientProfile = clientProfileRaw

  let persona: PersonaRow | null = null
  let personaResumeText = ""
  let personaVersionAtRun: number | null = null

  if (personaId) {
    const { data: personaRaw, error: personaErr } = await supabase
      .from("client_personas")
      .select("id,profile_id,resume_text,persona_version,structured_data,name")
      .eq("id", personaId)
      .maybeSingle<PersonaRow>()

    if (personaErr) {
      throw new Error(`assembleProfileForScoring: persona lookup failed: ${personaErr.message}`)
    }
    if (!personaRaw) {
      throw new Error(`assembleProfileForScoring: persona not found: ${personaId}`)
    }
    if (personaRaw.profile_id !== clientProfileId) {
      throw new Error("assembleProfileForScoring: persona does not belong to this profile")
    }
    persona = personaRaw
    personaResumeText = String(persona.resume_text || "").trim()
    personaVersionAtRun = persona.persona_version ?? 1
  }

  const profileHeader = String(clientProfile.profile_text || "").trim()
  const baseResume = String(clientProfile.resume_text || "").trim()
  const activeResume = personaResumeText || baseResume

  let effectiveProfileText: string
  if (profileHeader && activeResume && !profileHeader.includes(activeResume.slice(0, 80))) {
    effectiveProfileText = profileHeader + "\n\nResume:\n" + activeResume
  } else {
    effectiveProfileText = activeResume || profileHeader
  }

  // profileOverrides inference reads the profile header (intake form text),
  // not the resume body. Matches /api/jobfit's prior behavior exactly: the
  // header contains "hard constraints", "target roles", etc. — the resume
  // is noise for family/city/constraint inference.
  const profileOverrides = mapClientProfileToOverrides({
    profileText: profileHeader || effectiveProfileText,
    profileStructured: clientProfile.profile_structured,
    targetRoles: clientProfile.target_roles,
    preferredLocations: clientProfile.target_locations,
  })

  // profileVersionAtRun is only populated when a persona was explicitly
  // used — preserves /api/jobfit's historical audit semantics where
  // jobfit_runs.profile_version_at_run was null for non-persona runs.
  const profileVersionAtRun = personaId ? clientProfile.profile_version ?? 1 : null

  return {
    profileId: clientProfileId,
    clientProfile,
    persona,
    effectiveProfileText,
    profileOverrides,
    profileVersionAtRun,
    personaVersionAtRun,
  }
}

// ── Full pipeline ─────────────────────────────────────────────────────

/**
 * Runs the full JobFit pipeline and returns a result object shaped like
 * /api/jobfit's response (minus route-specific wrapping like `reused`).
 *
 * Steps:
 *   1. Assemble profile (unless `preassembled` is passed — allowed so
 *      callers that already loaded it for cache-key computation can skip
 *      the duplicate Supabase round-trip).
 *   2. Compute fingerprint.
 *   3. runJobFit({ profileText, jobText, profileOverrides, userJobTitle, userCompanyName }).
 *   4. Invoke V5 AI bullet generator. On V5 error, fall back silently to
 *      V4 deterministic bullets and surface the V5 error in debug.
 *   5. Apply post-run userJobTitle/userCompanyName override to job_signals
 *      (defensive — runJobFit already does this, but kept for parity with
 *      /api/jobfit's historical behavior).
 *   6. enforceClientFacingRules (zeros out WHYs on force_pass gate).
 */
export async function runJobFitForProfile(params: {
  clientProfileId: string
  personaId?: string | null
  jobText: string
  jobTitle: string
  companyName: string
  jobUrl?: string | null
  mode?: string
  force?: boolean
  debug?: boolean
  userId?: string
  supabase: SupabaseClient
  preassembled?: AssembledProfile
}): Promise<RunJobFitForProfileResult> {
  const {
    clientProfileId,
    personaId = null,
    jobText,
    jobTitle,
    companyName,
    mode,
    debug: debugFlag,
    userId,
    supabase,
  } = params

  if (!jobText) throw new Error("runJobFitForProfile: jobText is required")
  if (!jobTitle) throw new Error("runJobFitForProfile: jobTitle is required")
  if (!companyName) throw new Error("runJobFitForProfile: companyName is required")

  const assembled =
    params.preassembled ??
    (await assembleProfileForScoring({
      clientProfileId,
      personaId,
      supabase,
    }))

  const { fingerprint_hash, fingerprint_code } = computeJobFitFingerprint({
    jobText,
    clientProfileId,
    effectiveProfileText: assembled.effectiveProfileText,
    profileOverrides: assembled.profileOverrides,
  })

  // ── Run scoring engine ────────────────────────────────────────────
  const raw = (await runJobFit({
    profileText: assembled.effectiveProfileText,
    jobText,
    profileOverrides: assembled.profileOverrides,
    userJobTitle: jobTitle || undefined,
    userCompanyName: companyName || undefined,
    // These extra fields are cast-through to match /api/jobfit's historical
    // call shape. runJobFit's actual signature ignores them, but some
    // downstream debug telemetry may read them off `args` via `as any`.
    userId,
    mode,
    debug: debugFlag,
  } as any)) as any

  // ── V5 AI bullet generator ────────────────────────────────────────
  let cover_letter_strategy: any = undefined
  try {
    const { generateBulletsV5 } = await import("../jobfit/bulletGeneratorV5")
    const v5 = await generateBulletsV5({
      ...raw,
      profile_text: assembled.effectiveProfileText,
      job_text: jobText,
    })
    raw.why = v5.why
    raw.risk = v5.risk
    raw.bullets = v5.why
    raw.risk_bullets = v5.risk
    raw.why_structured = v5.why_structured
    raw.risk_structured = v5.risk_structured
    raw.debug = {
      ...(raw.debug || {}),
      ...v5.renderer_debug,
    }
    cover_letter_strategy = v5.cover_letter_strategy
    console.log("[runJobFitForProfile] V5 bullet generator success", {
      why_count: v5.why_structured.length,
      risk_count: v5.risk_structured.length,
      latency_ms: v5.renderer_debug.latency_ms,
    })
  } catch (err: any) {
    const v5ErrorMessage = err?.message || String(err)
    console.error("[runJobFitForProfile] V5 bullet generator failed, falling back to V4:", v5ErrorMessage)
    raw.debug = {
      ...(raw.debug || {}),
      v5_error: v5ErrorMessage,
      v5_fell_back_to_v4: true,
    }
  }

  // ── Post-run user-provided title/company override ─────────────────
  // runJobFit's extractor already sets these on job_signals when passed as
  // args, but the explicit post-write guards against any code path where
  // the extractor output leaks through — kept for strict parity with
  // /api/jobfit's historical behavior.
  if (jobTitle || companyName) {
    if (!raw.job_signals) raw.job_signals = {}
    if (jobTitle) raw.job_signals.jobTitle = jobTitle
    if (companyName) raw.job_signals.companyName = companyName
  }

  const cleaned = enforceClientFacingRules(raw) as any

  return {
    decision: cleaned.decision,
    score: cleaned.score,
    icon: cleaned.icon,
    bullets: cleaned.bullets,
    risk_flags: cleaned.risk_flags,
    next_step: cleaned.next_step,
    why_codes: cleaned.why_codes,
    risk_codes: cleaned.risk_codes,
    job_signals: cleaned.job_signals,
    profile_signals: cleaned.profile_signals,
    gate_triggered: cleaned.gate_triggered,
    score_breakdown: cleaned.score_breakdown,
    location_constraint: cleaned.location_constraint,

    why: cleaned.why,
    risk: cleaned.risk,
    why_structured: cleaned.why_structured,
    risk_structured: cleaned.risk_structured,
    cover_letter_strategy,

    fingerprint_hash,
    fingerprint_code,
    jobfit_logic_version: JOBFIT_LOGIC_VERSION,

    profileVersionAtRun: assembled.profileVersionAtRun,
    personaVersionAtRun: assembled.personaVersionAtRun,

    personaId: assembled.persona?.id || null,
    personaName: assembled.persona?.name || null,

    debug: cleaned.debug || {},
  }
}
