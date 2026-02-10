import OpenAI from "openai"

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

type Decision = "Apply" | "Review" | "Pass"
type LocationConstraint = "constrained" | "not_constrained" | "unclear"

type Gate =
  | { type: "force_pass"; reason: string }
  | { type: "floor_review"; reason: string }
  | { type: "none" }

type JobFacts = {
  isHourly: boolean
  hourlyEvidence?: string | null
  isContract: boolean
  contractEvidence?: string | null
}

type ProfileConstraints = {
  hardNoHourlyPay: boolean
  prefFullTime: boolean
  hardNoContract: boolean
}

/* ----------------------- helpers ----------------------- */

function extractJsonObject(raw: string) {
  if (!raw) return null

  const cleaned = raw.replace(/```(?:json)?/g, "").replace(/```/g, "").trim()

  try {
    return JSON.parse(cleaned)
  } catch {}

  const first = cleaned.indexOf("{")
  const last = cleaned.lastIndexOf("}")
  if (first === -1 || last === -1 || last <= first) return null

  const candidate = cleaned.slice(first, last + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

function clampScore(n: any) {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(100, Math.round(x)))
}

function normalizeDecision(d: any): Decision {
  const s = String(d || "").trim().toLowerCase()
  if (s === "apply") return "Apply"
  if (s === "review" || s === "review carefully") return "Review"
  if (s === "pass") return "Pass"
  return "Review"
}

function iconForDecision(decision: Decision) {
  if (decision === "Apply") return "✅"
  if (decision === "Review") return "⚠️"
  return "⛔"
}

function enforceScoreBand(decision: Decision, score: number) {
  if (decision === "Apply") return Math.max(score, 75)
  if (decision === "Review") return Math.min(Math.max(score, 60), 74)
  return Math.min(score, 59)
}

function ensureArrayOfStrings(x: any, max: number) {
  if (!Array.isArray(x)) return []
  return x
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .slice(0, max)
}

/* ----------------------- deterministic gates (NEW) ----------------------- */

function normalizeText(t: string) {
  return (t || "")
    .replace(/\u202f/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function extractJobFacts(jobText: string): JobFacts {
  const t0 = normalizeText(jobText)

  // Hourly signals
  const isHourly =
    /\$\s*\d+(\.\d+)?\s*\/\s*hr\b/.test(t0) ||
    /\$\s*\d+(\.\d+)?\s*\/\s*hour\b/.test(t0) ||
    /\b(per\s+hour|hourly)\b/.test(t0) ||
    /\b\d+(\.\d+)?\s*\/\s*hr\b/.test(t0)

  let hourlyEvidence: string | null = null
  const mHr = t0.match(/\$\s*\d+(\.\d+)?\s*\/\s*hr\b/) || t0.match(/\$\s*\d+(\.\d+)?\s*\/\s*hour\b/)
  if (mHr?.[0]) hourlyEvidence = mHr[0]

  // Contract signals
  const isContract =
    /\bcontract\b/.test(t0) ||
    /\b3\s*month\b/.test(t0) ||
    /\b6\s*month\b/.test(t0) ||
    /\btemporary\b/.test(t0) ||
    /\btemp\b/.test(t0) ||
    /\bduration\b/.test(t0) ||
    /\b1099\b/.test(t0) ||
    /\bw2\b/.test(t0)

  let contractEvidence: string | null = null
  const mContract =
    t0.match(/\bcontract\b/) ||
    t0.match(/\b3\s*month\b/) ||
    t0.match(/\b6\s*month\b/) ||
    t0.match(/\btemporary\b/) ||
    t0.match(/\bduration\b/)
  if (mContract?.[0]) contractEvidence = mContract[0]

  return { isHourly, hourlyEvidence, isContract, contractEvidence }
}

function extractProfileConstraints(profileText: string): ProfileConstraints {
  const t0 = normalizeText(profileText)

  // Hard exclusions
  const hardNoHourlyPay =
    t0.includes("no hourly") ||
    t0.includes("no hourly pay") ||
    (t0.includes("do not want") && t0.includes("hourly")) ||
    (t0.includes("hard exclusion") && t0.includes("hourly"))

  // Preference: full time (not necessarily a hard exclusion)
  const prefFullTime =
    t0.includes("full time") ||
    t0.includes("full-time") ||
    t0.includes("fulltime") ||
    t0.includes("job type preference") && t0.includes("full")

  // Explicit contract exclusion only if clearly stated
  const hardNoContract =
    t0.includes("no contract") ||
    t0.includes("do not want contract") ||
    t0.includes("no temp") ||
    t0.includes("no temporary")

  return { hardNoHourlyPay, prefFullTime, hardNoContract }
}

function evaluateGates(job: JobFacts, profile: ProfileConstraints): Gate {
  // Rule 1: Hard exclusion NO HOURLY PAY => automatic PASS
  if (profile.hardNoHourlyPay && job.isHourly) {
    const ev = job.hourlyEvidence ? ` (${job.hourlyEvidence})` : ""
    return {
      type: "force_pass",
      reason: `Job is hourly${ev}, and the candidate explicitly said no hourly pay.`,
    }
  }

  // Rule 2: Full-time preference + contract job => REVIEW floor unless contract is explicitly excluded (then PASS could be handled elsewhere)
  if (profile.prefFullTime && job.isContract && !profile.hardNoContract) {
    const ev = job.contractEvidence ? ` (signals: ${job.contractEvidence})` : ""
    return {
      type: "floor_review",
      reason: `Role appears to be contract${ev}, and the candidate preference is full-time. This requires review.`,
    }
  }

  return { type: "none" }
}

/* ----------------------- content hygiene filters ----------------------- */

// location/commute scrub (your rule)
function stripLocationLanguage(items: string[]) {
  return items.filter((s0) => {
    const s = (s0 || "").toLowerCase()
    return !(
      s.includes("commute") ||
      s.includes("commuting") ||
      s.includes("reasonable commuting distance") ||
      s.includes("miles away") ||
      s.includes("mile away") ||
      s.includes("distance") ||
      s.includes("not local") ||
      s.includes("local presence") ||
      s.includes("must be local") ||
      s.includes("onsite presence required") ||
      s.includes("hybrid location requirement") ||
      s.includes("location mismatch") ||
      s.includes("location preference mismatch") ||
      s.includes("location preference") ||
      s.includes("within commuting distance")
    )
  })
}

// remove “timeline aligns / graduation aligns” hallucination phrasing
function stripTimelineLanguage(items: string[]) {
  return items.filter((s0) => {
    const s = (s0 || "").toLowerCase()
    return !(
      (s.includes("timeline") && s.includes("align")) ||
      (s.includes("graduation") && s.includes("align")) ||
      (s.includes("graduation date") && s.includes("align")) ||
      (s.includes("program requirements") && s.includes("align"))
    )
  })
}

// remove “non-risk” risk flags that are actually validations/checkmarks
function stripNonRiskRiskFlags(items: string[]) {
  const badPhrases = [
    "no eligibility issue",
    "no eligibility issues",
    "no issues",
    "no issue",
    "matches the program requirement",
    "matches the requirement",
    "satisfying this",
    "satisfies this",
    "satisfies the requirement",
    "aligned",
    "assumed",
    "no risk flagged",
    "no indication",
    "so aligned",
    "cleared due to",
    "does not involve sales",
    "so this is fine",
  ]

  return items.filter((s0) => {
    const s = (s0 || "").toLowerCase()
    return !badPhrases.some((p) => s.includes(p))
  })
}

// remove coaching/advice leakage (your system rules)
function stripAdviceLanguage(items: string[]) {
  const bad = [
    "highlight",
    "tailor",
    "your application",
    "application materials",
    "resume",
    "cover letter",
    "networking",
    "reach out",
    "informational interview",
    "branding",
    "pitch yourself",
  ]

  return items.filter((s0) => {
    const s = (s0 || "").toLowerCase()
    return !bad.some((b) => s.includes(b))
  })
}



/* ----------------------- location constraint ----------------------- */

function normalizeLocationConstraint(x: any): LocationConstraint {
  const s = String(x || "").trim().toLowerCase()
  if (s === "constrained") return "constrained"
  if (s === "not_constrained" || s === "not constrained") return "not_constrained"
  if (s === "unclear") return "unclear"
  return "unclear"
}

/* ----------------------- hard-pass signals ----------------------- */

function hasHardPassSignals(riskFlags: string[], bullets: string[]) {
  const all = [...riskFlags, ...bullets].map((x) => (x || "").toLowerCase())

  const noRelevantSales =
    all.some((x) => x.includes("no relevant") && x.includes("sales")) ||
    all.some((x) => x.includes("no relevant sales experience"))

  const missingNetworkTarget =
    all.some((x) => x.includes("network")) &&
    all.some((x) => x.includes("absence") || x.includes("missing") || x.includes("required"))

  const functionMismatch =
    all.some((x) => x.includes("function mismatch")) ||
    all.some((x) => x.includes("not aligned") && (x.includes("role") || x.includes("position")))

  const clearlySenior =
    all.some((x) => x.includes("5+ years")) ||
    all.some((x) => x.includes("senior-level scope")) ||
    all.some((x) => x.includes("mba required"))

  const signals = [noRelevantSales, missingNetworkTarget, functionMismatch, clearlySenior].filter(Boolean).length
  return signals >= 2
}

/* ----------------------- deterministic date parsing (eligibility) ----------------------- */

type YM = { year: number; month: number } // month 1-12

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

function ymToIndex(ym: YM) {
  return ym.year * 12 + (ym.month - 1)
}

function parseMonthYear(s: string): YM | null {
  const t = (s || "").trim().toLowerCase()
  const m = t.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[^\d]{0,10}\b(20\d{2})\b/
  )
  if (!m) return null

  const month = MONTHS[m[1]]
  const year = Number(m[2])
  if (!month || !Number.isFinite(year)) return null
  return { year, month }
}

function extractGradWindow(jobText: string): { start: YM; end: YM } | null {
  const t = (jobText || "").replace(/\u202f/g, " ")
  const m =
    t.match(/expected graduation between([\s\S]{0,120})/i) ||
    t.match(/expected to graduate between([\s\S]{0,120})/i)
  if (!m) return null

  const fragment = m[1].slice(0, 180)

  const pairs = fragment.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b[^\d]{0,10}\b(20\d{2})\b/gi
  )
  if (!pairs || pairs.length < 2) return null

  const start = parseMonthYear(pairs[0])
  const end = parseMonthYear(pairs[1])
  if (!start || !end) return null

  if (ymToIndex(start) > ymToIndex(end)) return { start: end, end: start }
  return { start, end }
}

function extractCandidateGrad(profileText: string): YM | null {
  const t = (profileText || "").replace(/\u202f/g, " ")

  const explicit = parseMonthYear(t)
  if (explicit) return explicit

  const classOf = t.match(/\bclass of\s*(20\d{2})\b/i)
  if (classOf) {
    const year = Number(classOf[1])
    if (Number.isFinite(year)) return { year, month: 5 }
  }

  const y = t.match(/\b(graduate|graduating|graduation)\b[^\d]{0,20}\b(20\d{2})\b/i)
  if (y) {
    const year = Number(y[2])
    if (Number.isFinite(year)) return { year, month: 5 }
  }

  return null
}

function formatYM(ym: YM) {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ]
  return `${monthNames[ym.month - 1]} ${ym.year}`
}

/* ----------------------- “meaningful risk” enforcement ----------------------- */

function isMeaningfulRisk(r: string) {
  const s = (r || "").toLowerCase()

  if (
    s.includes("no issue") ||
    s.includes("no issues") ||
    s.includes("no eligibility") ||
    s.includes("matches") ||
    s.includes("satisfies") ||
    s.includes("aligned") ||
    s.includes("assumed")
  ) return false

  const cues = [
    "unclear",
    "missing",
    "gap",
    "limited",
    "concern",
    "risk",
    "lack",
    "mismatch",
    "outside",
    "requires",
    "preferred",
    "competitive",
    "contract",
    "hourly",
  ]

  return cues.some((c) => s.includes(c))
}

function countMeaningfulRisks(riskFlags: string[]) {
  return riskFlags.filter(isMeaningfulRisk).length
}

/* ----------------------- main (rewritten with NEW rules) ----------------------- */

export async function runJobFit({
  profileText,
  jobText,
}: {
  profileText: string
  jobText: string
}) {
  // NEW: deterministic gating layer
  const jobFacts = extractJobFacts(jobText)
  const profileConstraints = extractProfileConstraints(profileText)
  const gate = evaluateGates(jobFacts, profileConstraints)

  // If forced PASS, do not call the model at all
  if (gate.type === "force_pass") {
    const bullets = [gate.reason]
    const risk_flags: string[] = []

    // Also surface the contract mismatch as a risk flag if present (optional but useful)
    if (jobFacts.isContract && profileConstraints.prefFullTime && !profileConstraints.hardNoContract) {
      risk_flags.push("Role appears to be contract while the candidate preference is full-time.")
    }

    return {
      decision: "Pass" as Decision,
      icon: iconForDecision("Pass"),
      score: 59,
      bullets: bullets.slice(0, 8),
      risk_flags: risk_flags.slice(0, 6),
      next_step: "It is recommended that you do not apply and focus your attention on more aligned positions.",
      location_constraint: "unclear" as LocationConstraint,
    }
  }

  const system = `
You are WRNSignal, a job evaluation decision system by Workforce Ready Now.

Evaluate whether ONE job is worth applying to for an early-career candidate.

Return JSON only:
{
  "decision": "Apply" | "Review" | "Pass",
  "score": number,
  "bullets": string[],
  "risk_flags": string[],
  "location_constraint": "constrained" | "not_constrained" | "unclear"
}

Rules:
- Bullets and risk_flags must be specific and grounded in the provided profile and job.
- risk_flags must be actual risks/unknowns, not confirmations or “no issue” statements.
- Do NOT provide resume/cover letter/networking advice.
- location_constraint rules as previously described.

Important policy:
- Do not assume candidate accepts hourly or contract work unless clearly stated.
  `.trim()

  const user = `
CLIENT PROFILE:
${profileText}

JOB DESCRIPTION:
${jobText}

Make a JobFit decision.
Return JSON only.
  `.trim()

  const resp = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  })

  // @ts-ignore
  const raw = (resp as any).output_text || ""
  const parsed = extractJsonObject(raw)

  if (!parsed) {
    // If we had a REVIEW floor, keep it, even on parse failure
    const fallbackDecision: Decision = gate.type === "floor_review" ? "Review" : "Review"

    return {
      decision: fallbackDecision,
      icon: iconForDecision(fallbackDecision),
      score: enforceScoreBand(fallbackDecision, 60),
      bullets: [
        "Model did not return structured JSON.",
        gate.type === "floor_review" ? gate.reason : "Decision requires manual review.",
      ].slice(0, 8),
      risk_flags: ["Non-JSON model response"].slice(0, 6),
      next_step: "Review the risk flags carefully before proceeding.",
      location_constraint: "unclear" as LocationConstraint,
    }
  }

  // Parse fields
  let decision = normalizeDecision(parsed.decision)
  let score = clampScore(parsed.score)

  let bullets = ensureArrayOfStrings(parsed.bullets, 10)
  let riskFlags = ensureArrayOfStrings(parsed.risk_flags, 12)

  const loc = normalizeLocationConstraint(parsed.location_constraint)
  const treatAsConstrained = loc === "constrained"

  if (!treatAsConstrained) {
    bullets = stripLocationLanguage(bullets)
    riskFlags = stripLocationLanguage(riskFlags)
  }

  bullets = stripAdviceLanguage(bullets)
  riskFlags = stripAdviceLanguage(riskFlags)

  riskFlags = stripNonRiskRiskFlags(riskFlags)

  if (containsThreePlusYearsFlag(riskFlags) && !jdMentionsThreePlusYears(jobText)) {
    riskFlags = riskFlags.filter((r) => !containsThreePlusYearsFlag([r]))
  }

  // Deterministic graduation-window eligibility enforcement (kept)
  const gradWindow = extractGradWindow(jobText)
  const candGrad = extractCandidateGrad(profileText)

  if (gradWindow) {
    if (!candGrad) {
      riskFlags.unshift("graduation window unclear (candidate graduation date not found)")
    } else {
      const candIdx = ymToIndex(candGrad)
      const startIdx = ymToIndex(gradWindow.start)
      const endIdx = ymToIndex(gradWindow.end)

      const outside = candIdx < startIdx || candIdx > endIdx

      if (outside) {
        bullets = stripTimelineLanguage(bullets)
        riskFlags.unshift(
          `graduation window mismatch (job requires ${formatYM(gradWindow.start)}–${formatYM(
            gradWindow.end
          )}; candidate appears to graduate ${formatYM(candGrad)})`
        )

        decision = "Pass"
        score = Math.min(score, 59)
      }
    }
  }

  // Legacy explicit exclusion enforcement
  const hasExplicitExclusion = riskFlags.some((r) => r.toLowerCase().includes("explicit exclusion"))
  if (hasExplicitExclusion) decision = "Pass"

  // Score sanity: Review not allowed < 60
  if (decision === "Review" && score < 60) decision = "Pass"

  // 3+ years safety net: never allow Pass solely due to 3+ years
  if (decision === "Pass" && !hasExplicitExclusion && containsThreePlusYearsFlag(riskFlags)) {
    decision = "Review"
  }

  // Hard-pass signals
  if (!hasExplicitExclusion && decision !== "Apply" && hasHardPassSignals(riskFlags, bullets)) {
    decision = "Pass"
  }

  // Meaningful-risk enforcement
  const meaningfulRiskCount = countMeaningfulRisks(riskFlags)

  // NEW: do not allow Review -> Apply auto-upgrade if a REVIEW floor is active
  const hasReviewFloor = gate.type === "floor_review"

  if (!hasExplicitExclusion && !hasReviewFloor && decision === "Review" && meaningfulRiskCount <= 1) {
    decision = "Apply"
  }

  if (!hasExplicitExclusion && !hasReviewFloor && decision === "Review" && score >= 75 && meaningfulRiskCount <= 2) {
    decision = "Apply"
  }

  if (decision !== "Pass" && riskFlags.length >= 5) {
    decision = "Review"
  }

  // NEW: apply the REVIEW floor last, after other logic (unless already Pass)
  if (gate.type === "floor_review" && decision === "Apply") {
    decision = "Review"
  }

  // Ensure the floor reason is visible to the user
  if (gate.type === "floor_review") {
    const alreadyMentioned =
      bullets.some((b) => b.toLowerCase().includes("contract")) ||
      riskFlags.some((r) => r.toLowerCase().includes("contract"))
    if (!alreadyMentioned) {
      // Put it in risks by default, because bullets should stay "why it fits" plus the gate reason can be a risk.
      riskFlags.unshift(gate.reason)
    }
  }

  // Enforce score bands LAST
  score = enforceScoreBand(decision, score)

  // Final trims for UI
  bullets = bullets.slice(0, 8)
  riskFlags = riskFlags.slice(0, 6)

  const next_step =
    decision === "Pass"
      ? "It is recommended that you do not apply and focus your attention on more aligned positions."
      : decision === "Review"
      ? "Review the risk flags carefully before proceeding."
      : "Apply promptly if this role is still open."

  return {
    decision,
    icon: iconForDecision(decision),
    score,
    bullets,
    risk_flags: riskFlags,
    next_step,
    location_constraint: loc,
  }
}
