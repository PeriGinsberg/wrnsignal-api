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
  hardNoSales: boolean
  hardNoGovernment: boolean
  hardNoFullyRemote: boolean
}

type YM = { year: number; month: number } // month 1-12

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
  if (s === "apply" || s === "approve") return "Apply"
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

function normalizeText(t: string) {
  return (t || "")
    .replace(/\u202f/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/* ----------------------- deterministic extraction ----------------------- */

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

  const hardNoSales =
    t0.includes("do not want") && (t0.includes("sales") || t0.includes("commission")) ||
    t0.includes("no sales") ||
    t0.includes("no commission") ||
    t0.includes("commission-based")

  const hardNoGovernment =
    t0.includes("do not want") && (t0.includes("government") || t0.includes("governmental")) ||
    t0.includes("no government") ||
    t0.includes("governmental")

  const hardNoFullyRemote =
    t0.includes("no fully remote") ||
    (t0.includes("do not want") && t0.includes("fully remote")) ||
    (t0.includes("d o n o t want") && t0.includes("fully remote"))

  return { hardNoHourlyPay, prefFullTime, hardNoContract, hardNoSales, hardNoGovernment, hardNoFullyRemote }
}

/* ----------------------- deterministic job family mismatch ----------------------- */

type JobFamily =
  | "accounting_finance"
  | "brand_marketing_media"
  | "marketing_analytics"
  | "customer_success"
  | "pm_program"
  | "strategy_ops"
  | "sales"
  | "government_public"
  | "unknown"

function inferJobFamily(jobText: string): JobFamily {
  const t = normalizeText(jobText)

  if (
    /\b(accounts?\s+receivable|accounts?\s+payable|staff accountant|accountant|bookkeeper|double entry|general ledger|reconciliation|balance sheet|ar\b|ap\b)\b/.test(
      t
    )
  ) return "accounting_finance"

  if (/\b(media buying|media buy|brand awareness media|tv\b|billboards?|podcasts?|radio|placements?|allocate marketing budget)\b/.test(t))
    return "brand_marketing_media"

  if (
    /\b(marketing analytics|marketing analyst|junior marketing analyst|digital marketing performance|campaign performance|return on ad spend|roas|meta ads|google ads|linkedin ads)\b/.test(
      t
    )
  ) return "marketing_analytics"

  if (/\b(customer success|client success|client engagement|implementation|onboarding|account manager)\b/.test(t))
    return "customer_success"

  if (/\b(program manager|project manager|program management|project management|pm\b)\b/.test(t))
    return "pm_program"

  if (/\b(strategy|operations|biz ops|business operations|strategic planning|operational|strategic partnerships)\b/.test(t))
    return "strategy_ops"

  if (/\b(sales|business development|quota|commission|pipeline|lead gen|cold call)\b/.test(t))
    return "sales"

  if (/\b(government|public sector|municipal|state agency|federal)\b/.test(t))
    return "government_public"

  return "unknown"
}

function profileTargetsAccounting(profileText: string) {
  const t = normalizeText(profileText)
  return /\b(accounting|accountant|ar\b|ap\b|bookkeeping|controller|general ledger|reconciliation)\b/.test(t)
}

function profileTargetsMarketingOrOps(profileText: string) {
  const t = normalizeText(profileText)
  return (
    /\b(marketing|brand strategy|marketing strategy|campaign|analytics|operations|strategy|program|project|client success|customer success|partnerships)\b/.test(
      t
    )
  )
}

function jobIsFullyRemote(jobText: string) {
  const t = normalizeText(jobText)
  return /\bfully remote|100% remote|remote only|work from home\b/.test(t)
}

/* ----------------------- gates: PASS for obvious mismatch, REVIEW for real constraints ----------------------- */

function evaluateGates(job: JobFacts, profile: ProfileConstraints, jobText: string, profileText: string): Gate {
  // PASS: hourly is explicitly disallowed
  if (profile.hardNoHourlyPay && job.isHourly) {
    const ev = job.hourlyEvidence ? ` (${job.hourlyEvidence})` : ""
    return { type: "force_pass", reason: `Job is hourly${ev}, and the candidate explicitly said no hourly pay.` }
  }

  // REVIEW floor: full-time preference but contract role (unless contract explicitly disallowed)
  if (profile.prefFullTime && job.isContract && !profile.hardNoContract) {
    const ev = job.contractEvidence ? ` (signals: ${job.contractEvidence})` : ""
    return { type: "floor_review", reason: `Role appears to be contract${ev}, and the candidate preference is full-time.` }
  }

  // PASS: sales/commission disallowed and job is clearly sales/commission
  const fam = inferJobFamily(jobText)
  if (profile.hardNoSales && fam === "sales") {
    return { type: "force_pass", reason: "Role appears to be sales/commission-focused, which the candidate explicitly excluded." }
  }

  // PASS: government disallowed and job is clearly government/public sector
  if (profile.hardNoGovernment && fam === "government_public") {
    return { type: "force_pass", reason: "Role appears to be government/public sector, which the candidate explicitly excluded." }
  }

  // PASS: obvious function mismatch (accounting job for non-accounting targets)
  if (fam === "accounting_finance" && !profileTargetsAccounting(profileText)) {
    return { type: "force_pass", reason: "Role is accounting-focused, which does not match the candidate’s stated target roles." }
  }

  // REVIEW floor: fully remote is disallowed and job is explicitly fully remote
  if (profile.hardNoFullyRemote && jobIsFullyRemote(jobText)) {
    return { type: "floor_review", reason: "Role is explicitly fully remote, and the candidate prefers not to be fully remote for their first job." }
  }

  // REVIEW floor: brand media buying roles require hands-on media buying; if not shown, require review (not pass)
  if (fam === "brand_marketing_media") {
    const t = normalizeText(profileText)
    const hasPaidMedia =
      t.includes("media buying") ||
      t.includes("paid media") ||
      t.includes("programmatic") ||
      t.includes("media planning") ||
      t.includes("media strategy") ||
      t.includes("google ads") ||
      t.includes("meta ads")
    if (!hasPaidMedia) {
      return { type: "floor_review", reason: "Role is media buying/budget allocation focused, but the profile does not show direct paid media or media buying experience." }
    }
  }

  return { type: "none" }
}

/* ----------------------- content hygiene filters ----------------------- */

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
    "so this is fine",
  ]

  return items.filter((s0) => {
    const s = (s0 || "").toLowerCase()
    return !badPhrases.some((p) => s.includes(p))
  })
}

// remove invented "job doesn't mention / not stated" risks
function stripMissingJobInfoRisks(items: string[]) {
  const bad = [
    "job: location not stated",
    "job: not stated",
    "job: not specified",
    "job: not mentioned",
    "job: unclear",
    "not stated in the job",
    "not specified in the job",
    "not mentioned in the job",
    "unclear from the job",
    "job does not mention",
    "job doesn't mention",
    "location not stated",
    "location not specified",
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

/* ----------------------- deterministic date parsing (eligibility) ----------------------- */

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
    "remote",
  ]

  return cues.some((c) => s.includes(c))
}

function countMeaningfulRisks(riskFlags: string[]) {
  return riskFlags.filter(isMeaningfulRisk).length
}

// If a risk explicitly says core requirement is missing, do not allow Apply
function hasMissingCoreRequirement(riskFlags: string[]) {
  const t = riskFlags.join(" ").toLowerCase()
  return (
    t.includes("no direct experience") ||
    t.includes("lack of direct experience") ||
    t.includes("missing") && t.includes("experience") ||
    t.includes("no experience") && (t.includes("required") || t.includes("platform"))
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

/* ----------------------- main ----------------------- */

export async function runJobFit({
  profileText,
  jobText,
  profileStructured,
}: {
  profileText: string
  jobText: string
  profileStructured?: any
}) {
  const jobFacts = extractJobFacts(jobText)
  const profileConstraints = extractProfileConstraints(profileText)
  const gate = evaluateGates(jobFacts, profileConstraints, jobText, profileText)
const JOBFIT_LOGIC_VERSION = "rules_v1_2026_02_19"


  // Forced PASS: do not call model
  if (gate.type === "force_pass") {
    return {
      decision: "Pass" as Decision,
      icon: iconForDecision("Pass"),
      score: 59,
      bullets: [gate.reason].slice(0, 8),
      risk_flags: [],
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
- WHY bullets must be specific and grounded in both the job and the profile.
- WHY bullets must include proof in this format: "<claim> | Job: <short quote/phrase> | Profile: <short proof>"
- RISK flags must be plain text only (no "Job:" / "Profile:" / "Missing:"), and must reflect real constraints or gaps.
- Only include risks triggered by explicit job requirements or responsibilities.
- Do NOT create risks based on missing job info (do not say "job not stated/not mentioned").
- Do NOT provide resume/cover letter/networking advice.
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

  let decision = normalizeDecision(parsed.decision)
  let score = clampScore(parsed.score)

  let bullets = ensureArrayOfStrings(parsed.bullets, 12)
  let riskFlags = ensureArrayOfStrings(parsed.risk_flags, 12)

  const loc = normalizeLocationConstraint(parsed.location_constraint)
  const treatAsConstrained = loc === "constrained"

  // Hygiene
  if (!treatAsConstrained) {
    bullets = stripLocationLanguage(bullets)
    riskFlags = stripLocationLanguage(riskFlags)
  }

  bullets = stripAdviceLanguage(bullets)
  riskFlags = stripAdviceLanguage(riskFlags)

  riskFlags = stripNonRiskRiskFlags(riskFlags)
  riskFlags = stripMissingJobInfoRisks(riskFlags)

  // Remove hallucinated "3+ years" risks if JD doesn't mention it
  if (containsThreePlusYearsFlag(riskFlags) && !jdMentionsThreePlusYears(jobText)) {
    riskFlags = riskFlags.filter((r) => !containsThreePlusYearsFlag([r]))
  }

  // Graduation-window eligibility: mismatch => PASS
  const gradWindow = extractGradWindow(jobText)
  const candGrad = extractCandidateGrad(profileText)

  if (gradWindow) {
    if (!candGrad) {
      riskFlags.unshift("Graduation window unclear (candidate graduation date not found).")
    } else {
      const candIdx = ymToIndex(candGrad)
      const startIdx = ymToIndex(gradWindow.start)
      const endIdx = ymToIndex(gradWindow.end)

      const outside = candIdx < startIdx || candIdx > endIdx

      if (outside) {
        decision = "Pass"
        score = Math.min(score, 59)
        riskFlags.unshift(
          `Graduation window mismatch (job requires ${formatYM(gradWindow.start)}–${formatYM(
            gradWindow.end
          )}; candidate appears to graduate ${formatYM(candGrad)}).`
        )
      }
    }
  }

  // Apply REVIEW floor if deterministic gate requires it
  if (gate.type === "floor_review" && decision === "Apply") {
    decision = "Review"
  }

  // Obvious mismatch override: PASS always wins even if model "proves" it
  const fam = inferJobFamily(jobText)
  const obviousMismatch =
    (fam === "accounting_finance" && !profileTargetsAccounting(profileText)) ||
    (profileConstraints.hardNoSales && fam === "sales") ||
    (profileConstraints.hardNoGovernment && fam === "government_public") ||
    (profileConstraints.hardNoHourlyPay && jobFacts.isHourly)

  if (obviousMismatch) {
    decision = "Pass"
    score = Math.min(score, 59)
    if (riskFlags.length < 1) riskFlags.unshift("Obvious mismatch with candidate targets or explicit exclusions.")
  }

  // Score sanity
  if (decision === "Review" && score < 60) decision = "Pass"

  // If model says Apply but risks indicate missing core requirement, force Review
  if (decision === "Apply" && hasMissingCoreRequirement(riskFlags)) {
    decision = "Review"
  }

  // If Review and risks are minimal, allow Apply (strength outweighs constraints)
  const meaningfulRiskCount = countMeaningfulRisks(riskFlags)
  if (decision === "Review" && gate.type !== "floor_review" && meaningfulRiskCount <= 1 && riskFlags.length <= 2) {
    decision = "Apply"
  }

  // Too many risks => Review
  if (decision !== "Pass" && riskFlags.length >= 5) {
    decision = "Review"
  }

  // Final score banding
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
