// app/api/_lib/jobfitEvaluator.ts
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

/* ----------------------- deterministic extraction ----------------------- */

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
  const mHr =
    t0.match(/\$\s*\d+(\.\d+)?\s*\/\s*hr\b/) ||
    t0.match(/\$\s*\d+(\.\d+)?\s*\/\s*hour\b/)
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
    t0.match(/\bduration\b/) ||
    t0.match(/\b1099\b/) ||
    t0.match(/\bw2\b/)
  if (mContract?.[0]) contractEvidence = mContract[0]

  return { isHourly, hourlyEvidence, isContract, contractEvidence }
}

function extractProfileConstraints(profileText: string): ProfileConstraints {
  const t0 = normalizeText(profileText)

  const hardNoHourlyPay =
    t0.includes("no hourly") ||
    t0.includes("no hourly pay") ||
    (t0.includes("do not want") && t0.includes("hourly")) ||
    (t0.includes("hard exclusion") && t0.includes("hourly")) ||
    (t0.includes("d o n o t want") && t0.includes("hourly"))

  const prefFullTime =
    t0.includes("full time") ||
    t0.includes("full-time") ||
    t0.includes("fulltime") ||
    (t0.includes("job type preference") && t0.includes("full"))

  const hardNoContract =
    t0.includes("no contract") ||
    t0.includes("do not want contract") ||
    t0.includes("no temp") ||
    t0.includes("no temporary")

  return { hardNoHourlyPay, prefFullTime, hardNoContract }
}

/* ----------------------- deterministic job family + requirements ----------------------- */

type JobFamily =
  | "accounting_finance_ops"
  | "sales"
  | "brand_marketing_media_buying"
  | "pm_program"
  | "customer_success"
  | "strategy_ops"
  | "unknown"

function inferJobFamily(jobText: string): JobFamily {
  const t = normalizeText(jobText)

  if (
    /\b(accounts?\s+receivable|accounts?\s+payable|staff accountant|accountant|bookkeeper|double entry|general ledger|gl\b|reconciliation|balance sheet)\b/.test(
      t
    )
  ) return "accounting_finance_ops"

  if (/\b(media buying|media buy|brand awareness media|tv\b|billboards?|podcasts?|radio|placements?|allocate marketing budget)\b/.test(t)) {
    return "brand_marketing_media_buying"
  }

  if (/\b(customer success|client success|client engagement|implementation|onboarding|account manager)\b/.test(t)) {
    return "customer_success"
  }

  if (/\b(program manager|project manager|program management|project management|pm\b)\b/.test(t)) {
    return "pm_program"
  }

  if (/\b(strategy|operations|biz ops|business operations|strategic planning|operational)\b/.test(t)) {
    return "strategy_ops"
  }

  if (/\b(sales|business development|quota|commission|pipeline|lead gen|cold call)\b/.test(t)) {
    return "sales"
  }

  return "unknown"
}

function profileMentionsFamily(profileText: string, family: JobFamily): boolean {
  const t = normalizeText(profileText)

  const rx: Record<JobFamily, RegExp> = {
    accounting_finance_ops: /\b(accounting|accountant|ar\b|ap\b|bookkeeping|controller|general ledger|reconciliation)\b/,
    brand_marketing_media_buying: /\b(media buying|media buy|paid media|media planning|media strategy|programmatic|attribution|marketing measurement|brand media)\b/,
    customer_success: /\b(customer success|client success|client engagement|implementation|onboarding|account management)\b/,
    pm_program: /\b(program|project|program management|project management|pm\b)\b/,
    strategy_ops: /\b(strategy|operations|biz ops|business operations|strategic partnerships|planning)\b/,
    sales: /\b(sales|business development|quota|commission|pipeline)\b/,
    unknown: /$^/,
  }

  return family !== "unknown" && rx[family].test(t)
}

function jobRequiresMediaBuying(jobText: string) {
  const t = normalizeText(jobText)
  return (
    t.includes("media buy") ||
    t.includes("media buying") ||
    t.includes("brand awareness media") ||
    t.includes("allocate marketing budget") ||
    t.includes("placements") ||
    t.includes("billboard") ||
    t.includes("podcast") ||
    t.includes("radio") ||
    t.includes("tv") ||
    t.includes("buy our brand awareness")
  )
}

function profileHasMediaBuying(profileText: string) {
  const t = normalizeText(profileText)
  return (
    t.includes("media buying") ||
    t.includes("media buy") ||
    t.includes("paid media") ||
    t.includes("programmatic") ||
    t.includes("performance marketing") ||
    t.includes("attribution") ||
    t.includes("marketing measurement") ||
    t.includes("media planning") ||
    t.includes("media strategy")
  )
}

function evaluateGates(job: JobFacts, profile: ProfileConstraints, jobText: string, profileText: string): Gate {
  // Rule 0: Hourly exclusion => PASS
  if (profile.hardNoHourlyPay && job.isHourly) {
    const ev = job.hourlyEvidence ? ` (${job.hourlyEvidence})` : ""
    return {
      type: "force_pass",
      reason: `Job is hourly${ev}, and the candidate explicitly said no hourly pay.`,
    }
  }

  // Rule 1: Full-time preference + contract => REVIEW floor (unless contract is explicitly excluded elsewhere)
  if (profile.prefFullTime && job.isContract && !profile.hardNoContract) {
    const ev = job.contractEvidence ? ` (signals: ${job.contractEvidence})` : ""
    return {
      type: "floor_review",
      reason: `Role appears to be contract${ev}, and the candidate preference is full-time. This requires review.`,
    }
  }

  // Rule 2: Media buying required but not evidenced => REVIEW floor
  if (jobRequiresMediaBuying(jobText) && !profileHasMediaBuying(profileText)) {
    return {
      type: "floor_review",
      reason:
        "Role is media buying and channel budget focused, but the profile does not show direct media buying or paid media experience. This requires review.",
    }
  }

  // Rule 3: Obvious function mismatch (hard) for accounting-family roles when profile does not target it
  const fam = inferJobFamily(jobText)
  if (fam === "accounting_finance_ops" && !profileMentionsFamily(profileText, "accounting_finance_ops")) {
    return {
      type: "force_pass",
      reason: "Role is accounting-focused, which does not match the candidate’s stated target roles.",
    }
  }

  return { type: "none" }
}

/* ----------------------- content hygiene filters ----------------------- */

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
      s.includes("within commuting distance") ||
      s.includes("location specifics") ||
      (s.includes("location") && s.includes("should be confirmed")) ||
      s.includes("flexible arrangements") ||
      s.includes("hybrid arrangement") ||
      s.includes("in-office requirement should be confirmed")
    )
  })
}

function stripTimelineLanguage(items: string[]) {
  return items.filter((s0) => {
    const s = (s0 || "").toLowerCase()
    return !(
      (s.includes("timeline") && s.includes("align")) ||
      (s.includes("graduation") && s.includes("align")) ||
      (s.includes("graduation date") && s.includes("align")) ||
      (s.includes("program requirements") && s.includes("align")) ||
      (s.includes("timeline") && (s.includes("confirm") || s.includes("confirmed"))) ||
      (s.includes("start") && (s.includes("confirm") || s.includes("confirmed"))) ||
      s.includes("start date should be confirmed") ||
      s.includes("availability should be confirmed")
    )
  })
}

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

/* ----------------------- 3+ years contamination ----------------------- */

function containsThreePlusYearsFlag(riskFlags: string[]) {
  return riskFlags.some((r) => {
    const s = (r || "").toLowerCase()
    return (
      s.includes("3+ years") ||
      s.includes("3 years") ||
      s.includes("three years") ||
      s.includes("minimum 3 years")
    )
  })
}

function jdMentionsThreePlusYears(jobText: string) {
  const t = (jobText || "").toLowerCase()
  return (
    t.includes("3+ years") ||
    t.includes("three years") ||
    t.includes("minimum 3 years") ||
    /\b3\+\s*year/.test(t) ||
    /\b3\s*years?\b/.test(t)
  )
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
    all.some((x) => x.includes("not aligned") && (x.includes("role") || x.includes("position"))) ||
    all.some((x) => x.includes("does not match") && (x.includes("target roles") || x.includes("role targets"))) ||
    all.some((x) => x.includes("not a match") && x.includes("target roles"))

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

/* ----------------------- meaningful risk enforcement ----------------------- */

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

function hasMissingCoreExperience(riskFlags: string[]) {
  const t = riskFlags.join(" ").toLowerCase()
  return (
    t.includes("no direct experience") ||
    t.includes("lack of explicit direct experience") ||
    t.includes("lack of direct experience") ||
    t.includes("no specific mention") ||
    (t.includes("lack of") && t.includes("experience")) ||
    (t.includes("missing") && t.includes("experience"))
  )
}

/* ----------------------- evidence enforcement ----------------------- */

function requireEvidence(items: string[]) {
  return items.filter((s) => {
    const t = (s || "").toLowerCase()
    const hasJob = t.includes("job:")
    const hasProfileOrMissing = t.includes("profile:") || t.includes("missing:")
    return hasJob && hasProfileOrMissing
  })
}

/* ----------------------- main ----------------------- */

export async function runJobFit({
  profileText,
  jobText,
}: {
  profileText: string
  jobText: string
}) {
  // Deterministic gates
  const jobFacts = extractJobFacts(jobText)
  const profileConstraints = extractProfileConstraints(profileText)
  const gate = evaluateGates(jobFacts, profileConstraints, jobText, profileText)

  // Forced PASS: do not call model
  if (gate.type === "force_pass") {
    const bullets = [gate.reason]
    const risk_flags: string[] = []

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

Non-negotiables:
- Every bullet and risk flag must be grounded in BOTH the job and the profile. No vibes.
- Use this format in every line:
  - Bullets: "<claim> | Job: <short quote or phrase> | Profile: <short quote or phrase>"
  - Risks: "<risk> | Job: <short quote or phrase> | Missing: <what is not shown in profile>"
- risk_flags must be actual risks or unknowns. Do not write "no issue" statements.
- Do NOT provide resume/cover letter/networking advice.
- Do not invent constraints not present in the job text.

Policy:
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

  let bullets = ensureArrayOfStrings(parsed.bullets, 12)
  let riskFlags = ensureArrayOfStrings(parsed.risk_flags, 16)

  const loc = normalizeLocationConstraint(parsed.location_constraint)
  const treatAsConstrained = loc === "constrained"

  // Hygiene
  if (!treatAsConstrained) {
    bullets = stripLocationLanguage(bullets)
    riskFlags = stripLocationLanguage(riskFlags)
  }

  bullets = stripAdviceLanguage(bullets)
  riskFlags = stripAdviceLanguage(riskFlags)

  bullets = stripTimelineLanguage(bullets)
  riskFlags = stripTimelineLanguage(riskFlags)

  riskFlags = stripNonRiskRiskFlags(riskFlags)

  // Evidence enforcement (drops vibe lines)
  bullets = requireEvidence(bullets)
  riskFlags = requireEvidence(riskFlags)

  // Remove hallucinated "3+ years" flags when JD does not mention it
  if (containsThreePlusYearsFlag(riskFlags) && !jdMentionsThreePlusYears(jobText)) {
    riskFlags = riskFlags.filter((r) => !containsThreePlusYearsFlag([r]))
  }

  // Graduation-window eligibility (kept)
  const gradWindow = extractGradWindow(jobText)
  const candGrad = extractCandidateGrad(profileText)

  if (gradWindow) {
    if (!candGrad) {
      riskFlags.unshift(
        `graduation window unclear | Job: expected graduation window | Missing: candidate graduation date not found`
      )
    } else {
      const candIdx = ymToIndex(candGrad)
      const startIdx = ymToIndex(gradWindow.start)
      const endIdx = ymToIndex(gradWindow.end)

      const outside = candIdx < startIdx || candIdx > endIdx

      if (outside) {
        bullets = stripTimelineLanguage(bullets)
        riskFlags.unshift(
          `graduation window mismatch | Job: ${formatYM(gradWindow.start)}–${formatYM(
            gradWindow.end
          )} | Missing: candidate appears to graduate ${formatYM(candGrad)}`
        )
        decision = "Pass"
        score = Math.min(score, 59)
      }
    }
  }

  // Legacy explicit exclusion enforcement
  const hasExplicitExclusion = riskFlags.some((r) => r.toLowerCase().includes("explicit exclusion"))
  if (hasExplicitExclusion) decision = "Pass"

  // Review cannot be below 60
  if (decision === "Review" && score < 60) decision = "Pass"

  // Hard-pass signals
  if (!hasExplicitExclusion && decision !== "Apply" && hasHardPassSignals(riskFlags, bullets)) {
    decision = "Pass"
  }

  // Meaningful risks
  const meaningfulRiskCount = countMeaningfulRisks(riskFlags)
  const hasReviewFloor = gate.type === "floor_review"

  // Do not allow Apply if risks indicate missing core experience
  if (decision === "Apply" && hasMissingCoreExperience(riskFlags)) {
    decision = "Review"
  }

  // Review -> Apply auto-upgrades only when no floors exist
  if (!hasExplicitExclusion && !hasReviewFloor && decision === "Review" && meaningfulRiskCount <= 1) {
    decision = "Apply"
  }
  if (!hasExplicitExclusion && !hasReviewFloor && decision === "Review" && score >= 75 && meaningfulRiskCount <= 2) {
    decision = "Apply"
  }

  // Too many risks means Review
  if (decision !== "Pass" && riskFlags.length >= 5) {
    decision = "Review"
  }

  // Apply the REVIEW floor last
  if (gate.type === "floor_review" && decision === "Apply") {
    decision = "Review"
  }

  // Ensure the floor reason is visible
  if (gate.type === "floor_review") {
    const alreadyMentioned =
      bullets.some((b) => b.toLowerCase().includes("contract") || b.toLowerCase().includes("media buy")) ||
      riskFlags.some((r) => r.toLowerCase().includes("contract") || r.toLowerCase().includes("media buy"))
    if (!alreadyMentioned) {
      riskFlags.unshift(`${gate.reason} | Job: requirement detected | Missing: confirm fit in profile`)
    }
  }

  // Final banding
  score = enforceScoreBand(decision, score)

  // Final trims
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
