// lib/interviewPrep/source.ts
//
// Turning a jobfit_run row into the material the prep prompt is allowed to see.
//
// THE FINDING THIS FILE EXISTS FOR. `jobfit_run_id != NULL` does NOT mean the
// analysis is there. Measured on dev 2026-08-05, the table holds two different
// shapes:
//
//   real run    26 top-level keys — why_codes, risk_codes, job_signals (37
//               keys, including requirement_units), bullets, score_breakdown
//   stub        3 keys — decision, score, job_signals{jobTitle, companyName}
//
// The stubs are seeded rows. A generator that trusted `jobfit_run_id` would
// hand the model a role title and nothing else and get back three blocks of
// confident invention, which is the exact failure the whole grounding
// discipline exists to prevent. So this returns NULL when the material is not
// there, and the caller treats that identically to having no run at all.
//
// Everything here is pure. No network, no database, no clock.

/** Ids are assigned by POSITION in the frozen result_json, so they are stable
 *  for a given run and mean the same thing on every regeneration. */
export type PrepSource = {
  role: {
    jobTitle: string | null
    companyName: string | null
    jobFamily: string | null
    yearsRequired: number | null
    decision: string | null
    score: number | null
  }
  jobDescription: string | null
  requirements: Array<{ id: string; label: string; snippet: string; requiredness: string }>
  strengths: Array<{ id: string; job_fact: string; profile_fact: string; match_strength: string; evidence_id: string }>
  risks: Array<{ id: string; job_fact: string; profile_fact: string; risk: string; severity: string; evidence_id: string }>
  /** The ONLY claims about the candidate the model may make. */
  evidence: Array<{ id: string; text: string }>
}

/** Longer than any real posting we have seen; a guard against a pathological row. */
export const MAX_JD_CHARS = 6000

/**
 * Below this the posting cannot carry real requirements and the questions will
 * be generic. Calibrated against measured lengths: the one real dev run had 645
 * chars of JD and the seeded rows 253-266, while a full posting runs several
 * thousand. This is one half of the thin-JD signal; the model's own `jd_depth`
 * is the other, and either one trips the notice.
 */
export const THIN_JD_CHARS = 1200

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")

/**
 * Build the prompt's material from a run row, or null when there is not enough
 * to be honest with.
 *
 * The bar is at least one strength with a real profile_fact behind it. Without
 * that there is no evidence set, so every drafted answer would fail the
 * grounding check anyway and the user would be shown an empty surface after
 * paying for a generation.
 */
export function buildPrepSource(run: {
  result_json: unknown
  job_description?: string | null
} | null | undefined): PrepSource | null {
  const j = (run?.result_json ?? null) as any
  if (!j || typeof j !== "object") return null

  const signals = (j.job_signals ?? {}) as any

  // Evidence is deduped across strengths and risks, because the same resume
  // line legitimately appears on both sides — it is the proof of one thing and
  // the thin spot in another.
  const evidence: Array<{ id: string; text: string }> = []
  const evidenceIdByText = new Map<string, string>()
  const evidenceIdFor = (text: string): string => {
    const existing = evidenceIdByText.get(text)
    if (existing) return existing
    const id = `e${evidence.length + 1}`
    evidenceIdByText.set(text, id)
    evidence.push({ id, text })
    return id
  }

  const strengths: PrepSource["strengths"] = []
  for (const w of Array.isArray(j.why_codes) ? j.why_codes : []) {
    const profile_fact = str(w?.profile_fact)
    const job_fact = str(w?.job_fact)
    // A strength with no resume line behind it cannot ground an answer, so it
    // is not offered to the model at all rather than offered and then policed.
    if (!profile_fact || !job_fact) continue
    strengths.push({
      id: `w${strengths.length + 1}`,
      job_fact,
      profile_fact,
      match_strength: str(w?.match_strength) || "direct",
      evidence_id: evidenceIdFor(profile_fact),
    })
  }

  if (strengths.length === 0) return null

  const risks: PrepSource["risks"] = []
  for (const r of Array.isArray(j.risk_codes) ? j.risk_codes : []) {
    const risk = str(r?.risk)
    if (!risk) continue
    const profile_fact = str(r?.profile_fact)
    risks.push({
      id: `r${risks.length + 1}`,
      job_fact: str(r?.job_fact),
      profile_fact,
      risk,
      severity: str(r?.severity) || "medium",
      // A risk may have no profile_fact (a JD-side gate with nothing on the
      // candidate side). It still gets an evidence id only when it has text.
      evidence_id: profile_fact ? evidenceIdFor(profile_fact) : "",
    })
  }

  // CORE FIRST, THEN SUPPORTING. `requiredness` and `strength` are the engine's
  // own ranking, and this orders by them rather than re-deriving importance,
  // which would be a second opinion nobody asked for.
  //
  // This used to keep ONLY core, and that was miscalibrated against the actual
  // distribution. Measured across 144 usable dev runs: 308 core units and 439
  // supporting, but only 103 runs carry any core at all. The other 41 have
  // supporting units exclusively, so a core-only filter threw away the entire
  // requirements block for 28% of runs and the prep lost its most concrete
  // questions.
  //
  // Supporting is a TIER, not a downgrade to guesswork. All 439 carry both a
  // label and a verbatim snippet from the posting, the same extraction as core:
  //
  //   analysis, reporting, and measurement work
  //     <- "- 0-2 years of experience in FP&A, accounting, or financial analysis"
  //
  // With both tiers and this cap, every usable run yields at least one
  // requirement and 118 of 144 yield three or more. Runs that already had core
  // still lead with core, so nothing regresses.
  //
  // A CLOSED SET, not "anything with a requiredness". The engine's type is
  // `requiredness: "core" | "supporting"` (signals.ts) and nothing else is
  // reachable, so an unrecognised tier means the shape changed and it should be
  // dropped rather than silently ranked last and shown to a user.
  const RANK: Record<string, number> = { core: 0, supporting: 1 }
  const units = Array.isArray(signals.requirement_units) ? signals.requirement_units : []
  const requirements = units
    .filter((u: any) => RANK[str(u?.requiredness)] !== undefined && (str(u?.label) || str(u?.snippet)))
    .sort((a: any, b: any) =>
      RANK[str(a?.requiredness)] - RANK[str(b?.requiredness)]
      || (Number(b?.strength) || 0) - (Number(a?.strength) || 0))
    .slice(0, 5)
    .map((u: any) => ({
      id: str(u?.id) || str(u?.key),
      label: str(u?.label),
      snippet: str(u?.snippet),
      requiredness: str(u?.requiredness),
    }))
    .filter((u: { id: string }) => Boolean(u.id))

  const jd = str(run?.job_description)

  return {
    role: {
      jobTitle: str(signals.jobTitle) || null,
      companyName: str(signals.companyName) || null,
      jobFamily: str(signals.jobFamily) || null,
      yearsRequired: typeof signals.yearsRequired === "number" ? signals.yearsRequired : null,
      decision: str(j.decision) || null,
      score: typeof j.score === "number" ? j.score : null,
    },
    jobDescription: jd ? jd.slice(0, MAX_JD_CHARS) : null,
    requirements,
    strengths,
    risks,
    evidence,
  }
}

/**
 * How much posting there was to work from. THREE states, not a boolean.
 *
 *   absent  no posting saved at all. jobfit_runs.job_description was added on
 *           2026-04-10, so every run before that date has none. Measured: 0 on
 *           dev, but a real and permanent slice of production.
 *   thin    a posting too short to carry real requirements.
 *   ok      enough to build from.
 *
 * absent and thin were one flag and that was wrong: calling a posting that was
 * never saved "short" is a false statement about the user's own data, and it
 * points them at the wrong fix. The engine still extracted requirement_units,
 * strengths and risks at scan time, so a run with no stored posting is still
 * worth generating from. It just cannot be described as short.
 */
export type JdState = "absent" | "thin" | "ok"

export function jdState(jobDescription: string | null): JdState {
  if (!jobDescription) return "absent"
  return jobDescription.length < THIN_JD_CHARS ? "thin" : "ok"
}
