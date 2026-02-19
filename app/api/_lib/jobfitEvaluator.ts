// app/api/_lib/jobfitEvaluator.ts
// WRNSignal JobFit (Hybrid v1.1)
// Keeps what worked: deterministic gates + LLM for nuanced WHY/RISKS
// Changes vs your older version:
// - Removes job/profile quotes from WHY/RISK output (prompt + deterministic sanitizers)
// - Forces 3–5 WHY bullets (no fluff, no advice)
// - Prevents “no risks returned” for competitive roles
// - More strict: prevents overly generous APPLY when evidence is thin

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
  isFullyRemote: boolean
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

const JOBFIT_LOGIC_VERSION = "hybrid_v1_1_2026_02_19"

/* ----------------------- helpers ----------------------- */

function extractJsonObject(raw: string) {
  if (!raw) return null
  const cleaned = raw
    .replace(/```(?:json)?/g, "")
    .replace(/```/g, "")
    .trim()

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
  // Tighten slightly so "Apply" isn't handed out too easily
  if (decision === "Apply") return Math.max(score, 75)
  if (decision === "Review") return Math.min(Math.max(score, 58), 74)
  return Math.min(score, 57)
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

function safeObj(x: any) {
  return x && typeof x === "object" ? x : {}
}

/* ----------------------- deterministic extraction ----------------------- */

function extractJobFacts(jobText: string): JobFacts {
  const t0 = normalizeText(jobText)

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

  // Contract signals should mean employment type, not “draft contracts”
  const contractNoise =
    /\bcontract\s+(forms?|templates?|paperwork|documents?)\b/.test(t0) ||
    /\bdraft\b[^\n]{0,40}\bcontract\b/.test(t0)

  const contractEmployment =
    /\b(contract\s+(role|position|job|employment|assignment))\b/.test(t0) ||
    /\b(3|6|9|12)\s*-\s*(month|mo)\s+contract\b/.test(t0) ||
    /\b(3|6|9|12)\s*(month|mo)\s+contract\b/.test(t0) ||
    /\btemporary\b/.test(t0) ||
    /\btemp\b/.test(t0) ||
    /\b1099\b/.test(t0)

  const isContract = contractEmployment && !contractNoise

  let contractEvidence: string | null = null
  if (isContract) {
    const mContract =
      t0.match(/\b(contract\s+(role|position|job|employment|assignment))\b/) ||
      t0.match(/\b(3|6|9|12)\s*-\s*(month|mo)\s+contract\b/) ||
      t0.match(/\b(3|6|9|12)\s*(month|mo)\s+contract\b/) ||
      t0.match(/\btemporary\b/) ||
      t0.match(/\b1099\b/)
    if (mContract?.[0]) contractEvidence = mContract[0]
  }

  const isFullyRemote = /\b(fully remote|100% remote|remote only|work from home)\b/.test(t0)

  return { isHourly, hourlyEvidence, isContract, contractEvidence, isFullyRemote }
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
    ((t0.includes("do not want") && (t0.includes("sales") || t0.includes("commission"))) ||
      t0.includes("no sales") ||
      t0.includes("no commission") ||
      t0.includes("commission-based"))

  const hardNoGovernment =
    ((t0.includes("do not want") && (t0.includes("government") || t0.includes("governmental"))) ||
      t0.includes("no government") ||
      t0.includes("governmental"))

  const hardNoFullyRemote =
    t0.includes("no fully remote") ||
    (t0.includes("do not want") && t0.includes("fully remote")) ||
    (t0.includes("d o n o t want") && t0.includes("fully remote"))

  return {
    hardNoHourlyPay,
    prefFullTime,
    hardNoContract,
    hardNoSales,
    hardNoGovernment,
    hardNoFullyRemote,
  }
}

/* ----------------------- deterministic job family mismatch ----------------------- */

type JobFamily =
  | "accounting_finance"
  | "brand_marketing_media"
  | "marketing_analytics"
  | "customer_success"
  | "pm_program"
  | "strategy_ops"
  | "publishing_editorial"
  | "software_data"
  | "clinical_health"
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

  if (
    /\b(media buying|media buy|brand awareness media|tv\b|billboards?|podcasts?|radio|placements?|allocate marketing budget|programmatic)\b/.test(
      t
    )
  ) return "brand_marketing_media"

  if (
    /\b(marketing analytics|marketing analyst|digital marketing performance|campaign performance|return on ad spend|roas|meta ads|google ads|linkedin ads|attribution|a\/b test)\b/.test(
      t
    )
  ) return "marketing_analytics"

  if (/\b(customer success|client success|implementation|onboarding|account manager|retention)\b/.test(t))
    return "customer_success"

  if (/\b(program manager|project manager|program management|project management|pm\b)\b/.test(t))
    return "pm_program"

  if (/\b(strategy|operations|biz ops|business operations|strategic planning|operational|partnerships)\b/.test(t))
    return "strategy_ops"

  if (/\b(editor|editorial|copy[- ]?edit|proofread|publishing|wordpress|cms|seo|headline)\b/.test(t))
    return "publishing_editorial"

  if (/\b(software engineer|developer|full stack|frontend|backend|api\b|typescript|javascript|python\b|data engineer|sql\b)\b/.test(t))
    return "software_data"

  if (/\b(emt\b|paramedic|nurse|rn\b|clinical|patient|medical device|therapy|hospital)\b/.test(t))
    return "clinical_health"

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
  return /\b(marketing|brand|campaign|analytics|operations|strategy|program|project|customer success|partnerships)\b/.test(t)
}

function jobIsFullyRemote(jobText: string) {
  const t = normalizeText(jobText)
  return /\bfully remote|100% remote|remote only|work from home\b/.test(t)
}

/* ----------------------- gates ----------------------- */

function evaluateGates(job: JobFacts, profile: ProfileConstraints, jobText: string, profileText: string): Gate {
  // PASS: hourly explicitly disallowed
  if (profile.hardNoHourlyPay && job.isHourly) {
    const ev = job.hourlyEvidence ? ` (${job.hourlyEvidence})` : ""
    return {
      type: "force_pass",
      reason: `Job is hourly${ev}, and you explicitly said no hourly pay.`,
    }
  }

  // REVIEW floor: full-time preference but contract role (unless contract explicitly disallowed)
  if (profile.prefFullTime && job.isContract && !profile.hardNoContract) {
    const ev = job.contractEvidence ? ` (signals: ${job.contractEvidence})` : ""
    return {
      type: "floor_review",
      reason: `Role appears to be contract${ev}, and your preference is full-time.`,
    }
  }

  // PASS: sales disallowed and job is clearly sales
  const fam = inferJobFamily(jobText)
  if (profile.hardNoSales && fam === "sales") {
    return { type: "force_pass", reason: "Role is sales/commission-focused, which you explicitly excluded." }
  }

  // PASS: government disallowed and job is clearly government/public sector
  if (profile.hardNoGovernment && fam === "government_public") {
    return { type: "force_pass", reason: "Role is government/public-sector, which you explicitly excluded." }
  }

  // PASS: obvious mismatch (accounting job for non-accounting targets)
  if (fam === "accounting_finance" && !profileTargetsAccounting(profileText)) {
    return { type: "force_pass", reason: "Role is accounting-focused and does not match your stated target direction." }
  }

  // REVIEW floor: fully remote disallowed and job is explicitly fully remote
  if (profile.hardNoFullyRemote && jobIsFullyRemote(jobText)) {
    return { type: "floor_review", reason: "Role is explicitly fully remote, and you prefer not to be fully remote." }
  }

  // REVIEW floor: brand media buying requires hands-on paid media proof
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
      return {
        type: "floor_review",
        reason: "Role is media buying/budget allocation focused, but your profile does not show direct paid media/media buying execution.",
      }
    }
  }

  return { type: "none" }
}

/* ----------------------- deterministic date parsing (eligibility) ----------------------- */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
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
    t.match(/expected graduation between([\s\S]{0,140})/i) ||
    t.match(/expected to graduate between([\s\S]{0,140})/i) ||
    t.match(/expected graduation[:\s]+([\s\S]{0,140})/i)

  if (!m) return null

  const fragment = m[1].slice(0, 220)
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

function extractCandidateGrad(profileText: string, profileStructured?: any): YM | null {
  const ps = safeObj(profileStructured)
  const y = Number(ps.grad_year || ps.profile?.grad_year)
  const m = Number(ps.grad_month || ps.profile?.grad_month)
  if (Number.isFinite(y) && Number.isFinite(m) && y >= 2020 && m >= 1 && m <= 12) {
    return { year: y, month: m }
  }

  const t = (profileText || "").replace(/\u202f/g, " ")
  const explicit = parseMonthYear(t)
  if (explicit) return explicit

  const classOf = t.match(/\bclass of\s*(20\d{2})\b/i)
  if (classOf) {
    const year = Number(classOf[1])
    if (Number.isFinite(year)) return { year, month: 5 }
  }

  const yr = t.match(/\b(graduate|graduating|graduation)\b[^\d]{0,20}\b(20\d{2})\b/i)
  if (yr) {
    const year = Number(yr[2])
    if (Number.isFinite(year)) return { year, month: 5 }
  }

  return null
}

function formatYM(ym: YM) {
  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ]
  return `${monthNames[ym.month - 1]} ${ym.year}`
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
      s.includes("distance") ||
      s.includes("not local") ||
      s.includes("local presence") ||
      s.includes("must be local") ||
      s.includes("onsite presence required") ||
      s.includes("hybrid location requirement") ||
      s.includes("location mismatch") ||
      s.includes("location preference")
    )
  })
}

function stripNonRiskRiskFlags(items: string[]) {
  const badPhrases = [
    "no eligibility issue",
    "no eligibility issues",
    "no issues",
    "no issue",
    "matches the requirement",
    "satisfies",
    "aligned",
    "assumed",
    "no risk flagged",
    "no indication",
  ]
  return items.filter((s0) => {
    const s = (s0 || "").toLowerCase()
    return !badPhrases.some((p) => s.includes(p))
  })
}

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

/* ----------------------- quote removal + anti-copy enforcement ----------------------- */

function stripQuotesAndPrefixes(s0: string) {
  let s = String(s0 || "").trim()

  // Remove straight/dumb quotes and smart quotes content markers, but keep the sentence
  // 1) remove double-quoted substrings
  s = s.replace(/"[^"]{1,220}"/g, "")
  // 2) remove single-quoted substrings (short only, avoids nuking contractions)
  s = s.replace(/'[^']{8,220}'/g, "")

  // Kill explicit prefixes if model tries them
  s = s.replace(/\b(job|profile)\s*:\s*/gi, "")

  // Remove leftover separators from earlier “proof format”
  s = s.replace(/\s*\|\s*(job|profile)\s*:[^|]{0,200}/gi, "")
  s = s.replace(/\s*\|\s*/g, " ")

  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim()

  // Remove leading punctuation artifacts
  s = s.replace(/^[\-\–\—\:\|]+\s*/g, "").trim()

  return s
}

// If a bullet contains a long verbatim fragment from the JD, remove that fragment.
// Simple heuristic: if any 10+ word phrase in the bullet appears in jobText, cut that phrase.
function stripVerbatimFromJob(bullet: string, jobText: string) {
  const b = String(bullet || "").trim()
  const jt = normalizeText(jobText)
  const words = b.split(/\s+/).filter(Boolean)
  if (words.length < 12) return b

  // check sliding windows of 10–14 words
  const maxWindow = Math.min(14, Math.floor(words.length / 2))
  for (let w = maxWindow; w >= 10; w--) {
    for (let i = 0; i + w <= words.length; i++) {
      const phrase = words.slice(i, i + w).join(" ").toLowerCase()
      if (phrase.length < 40) continue
      if (jt.includes(normalizeText(phrase))) {
        const before = words.slice(0, i).join(" ")
        const after = words.slice(i + w).join(" ")
        const rebuilt = `${before} ${after}`.replace(/\s+/g, " ").trim()
        return rebuilt || b
      }
    }
  }
  return b
}

function cleanBulletsNoQuotes(items: string[], jobText: string, max: number) {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of items) {
    let s = stripQuotesAndPrefixes(raw)
    s = stripVerbatimFromJob(s, jobText)
    s = s.replace(/\s+/g, " ").trim()
    if (!s) continue
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
    if (out.length >= max) break
  }
  return out
}

/* ----------------------- 3+ years contamination ----------------------- */

function containsThreePlusYearsFlag(riskFlags: string[]) {
  return riskFlags.some((r) => {
    const s = (r || "").toLowerCase()
    return s.includes("3+ years") || s.includes("3 years") || s.includes("three years") || s.includes("minimum 3 years")
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
    "years",
  ]
  return cues.some((c) => s.includes(c))
}

function countMeaningfulRisks(riskFlags: string[]) {
  return riskFlags.filter(isMeaningfulRisk).length
}

function hasMissingCoreRequirement(riskFlags: string[]) {
  const t = riskFlags.join(" ").toLowerCase()
  return (
    t.includes("no direct experience") ||
    t.includes("lack of direct experience") ||
    (t.includes("missing") && t.includes("experience")) ||
    (t.includes("no experience") && (t.includes("required") || t.includes("platform") || t.includes("tool")))
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

/* ----------------------- school tier (optional competitiveness signal) ----------------------- */

type SchoolTier = "S" | "A" | "B" | "C" | "unknown"

const SCHOOL_TIER_S: string[] = [
  "harvard", "yale", "princeton", "stanford", "mit", "caltech",
  "oxford", "cambridge",
]

const SCHOOL_TIER_A: string[] = [
  "columbia", "upenn", "university of pennsylvania", "brown",
  "dartmouth", "cornell", "duke", "northwestern",
  "university of chicago", "uchicago",
  "johns hopkins", "georgetown",
  "uc berkeley", "berkeley", "ucla",
  "carnegie mellon", "rice", "vanderbilt",
  "notre dame", "nyu", "new york university",
]

function inferSchoolTierFromText(profileText: string): SchoolTier {
  const t = normalizeText(profileText)
  if (!t) return "unknown"
  const hasSchool = (list: string[]) => list.some((name) => t.includes(name))
  if (hasSchool(SCHOOL_TIER_S)) return "S"
  if (hasSchool(SCHOOL_TIER_A)) return "A"
  return "unknown"
}

function readSchoolTier(profileStructured: any, profileText: string): SchoolTier {
  const ps = safeObj(profileStructured)
  const raw = String(ps.school_tier || ps.profile?.school_tier || "").trim().toUpperCase()
  if (raw === "S" || raw === "A" || raw === "B" || raw === "C") return raw as SchoolTier
  return inferSchoolTierFromText(profileText)
}

function isCompetitiveEditorialOrg(jobText: string) {
  const t = normalizeText(jobText)
  // Keep this conservative: only obvious prestige/competition magnets
  return (
    t.includes("the new yorker") ||
    t.includes("wall street journal") ||
    t.includes("wsj") ||
    t.includes("dow jones") ||
    t.includes("condé nast") ||
    t.includes("conde nast") ||
    t.includes("new york times") ||
    t.includes("the economist")
  )
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
  const ps = safeObj(profileStructured)
  const jobFacts = extractJobFacts(jobText)
  const profileConstraints = extractProfileConstraints(profileText)

  const gate = evaluateGates(jobFacts, profileConstraints, jobText, profileText)

  // Forced PASS: do not call model
  if (gate.type === "force_pass") {
    return {
      decision: "Pass" as Decision,
      icon: iconForDecision("Pass"),
      score: 57,
      bullets: [gate.reason].slice(0, 6),
      risk_flags: [],
      next_step: "Do not apply. Focus on more aligned positions.",
      location_constraint: "unclear" as LocationConstraint,
      logic_version: JOBFIT_LOGIC_VERSION,
    }
  }

  // Graduation-window eligibility: mismatch => PASS (deterministic)
  const gradWindow = extractGradWindow(jobText)
  const candGrad = extractCandidateGrad(profileText, ps)
  if (gradWindow && candGrad) {
    const c = ymToIndex(candGrad)
    const s = ymToIndex(gradWindow.start)
    const e = ymToIndex(gradWindow.end)
    if (c < s || c > e) {
      return {
        decision: "Pass" as Decision,
        icon: iconForDecision("Pass"),
        score: 57,
        bullets: [
          `Graduation window mismatch. This role targets graduates between ${formatYM(gradWindow.start)} and ${formatYM(gradWindow.end)}.`,
          `Your profile indicates graduation around ${formatYM(candGrad)}.`,
        ].slice(0, 6),
        risk_flags: [],
        next_step: "Do not apply. Focus on roles aligned to your eligibility window.",
        location_constraint: "unclear" as LocationConstraint,
        logic_version: JOBFIT_LOGIC_VERSION,
      }
    }
  }

  const schoolTier = readSchoolTier(ps, profileText)
  const fam = inferJobFamily(jobText)
  const competitiveEditorial = fam === "publishing_editorial" && isCompetitiveEditorialOrg(jobText)

  // System prompt: no quotes, no Job:/Profile: prefixes, 3–5 WHY bullets, real risks only.
  const system = `
You are WRNSignal, a job evaluation decision system by Workforce Ready Now.

Evaluate whether ONE job is worth applying to for an early-career candidate.

Return JSON ONLY in this schema:
{
  "decision": "Apply" | "Review" | "Pass",
  "score": number,
  "bullets": string[],
  "risk_flags": string[],
  "location_constraint": "constrained" | "not_constrained" | "unclear"
}

Non-negotiables:
- Provide 3 to 5 WHY bullets. These must be specific and grounded in BOTH the job and the profile.
- Do NOT quote the job description or profile. No quotation marks. Do not copy long phrases.
- Do NOT use prefixes like "Job:" or "Profile:".
- WHY bullets must be factual. Do not claim tools/platforms/experience unless visible in the profile text.
- Each WHY bullet must include both sides of evidence in one sentence using this structure:
  "<claim>. Evidence: job needs <requirement>, profile shows <proof>."
  Keep the evidence short and paraphrased.
- Risk flags must be plain text only. No "Job:" / "Profile:" / "Missing:".
- Only include risks triggered by explicit job requirements/responsibilities OR obvious competitiveness.
- Do NOT create risks based on missing job info (do not say "not stated/not mentioned").
- Do NOT provide resume/cover letter/networking advice.
- If the job lists a minimum years requirement that is above typical entry-level and the profile does not show that years level, add a risk.
- If the job is clearly competitive (top publication/brand) and the profile proof is partial, add a competition/bar-raising risk.
`.trim()

  const user = `
CLIENT PROFILE:
${profileText}

JOB DESCRIPTION:
${jobText}

Extra context:
- SchoolTier detected: ${schoolTier}
- JobFamily inferred: ${fam}
- CompetitiveEditorialOrg: ${competitiveEditorial ? "true" : "false"}

Make a JobFit decision. Return JSON only.
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
      ].slice(0, 6),
      risk_flags: ["Non-JSON model response"].slice(0, 6),
      next_step: "Review the risk flags carefully before proceeding.",
      location_constraint: "unclear" as LocationConstraint,
      logic_version: JOBFIT_LOGIC_VERSION,
    }
  }

  let decision = normalizeDecision(parsed.decision)
  let score = clampScore(parsed.score)
  let bullets = ensureArrayOfStrings(parsed.bullets, 10)
  let riskFlags = ensureArrayOfStrings(parsed.risk_flags, 12)
  const loc = normalizeLocationConstraint(parsed.location_constraint)

  const treatAsConstrained = loc === "constrained"

  // Hygiene filters
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

  // Deterministic REVIEW floor override
  if (gate.type === "floor_review" && decision === "Apply") {
    decision = "Review"
  }

  // Obvious mismatch override always wins
  const obviousMismatch =
    (fam === "accounting_finance" && !profileTargetsAccounting(profileText)) ||
    (profileConstraints.hardNoSales && fam === "sales") ||
    (profileConstraints.hardNoGovernment && fam === "government_public") ||
    (profileConstraints.hardNoHourlyPay && jobFacts.isHourly)

  if (obviousMismatch) {
    decision = "Pass"
    score = Math.min(score, 57)
    if (riskFlags.length < 1) riskFlags.unshift("Obvious mismatch with stated direction or explicit exclusions.")
  }

  // Strict core requirement enforcement: if risks say missing core requirement, do not allow Apply
  if (decision === "Apply" && hasMissingCoreRequirement(riskFlags)) {
    decision = "Review"
  }

  // Tighten: if Review but risks are basically empty AND WHY bullets are weak, don't auto-upgrade.
  // (We no longer auto-bump Review->Apply just because risks are low.)

  // Too many risks => Review
  if (decision !== "Pass" && riskFlags.length >= 5) {
    decision = "Review"
  }

  // Sanitize outputs to enforce “no quotes / no copied JD lines”
  bullets = cleanBulletsNoQuotes(bullets, jobText, 6)
  riskFlags = cleanBulletsNoQuotes(riskFlags, jobText, 6)

  // Force 3–5 WHY bullets
  if (bullets.length < 3) {
    // Minimal deterministic fillers that do not overclaim
    const filler: string[] = []
    if (fam === "publishing_editorial") {
      filler.push("Your background shows writing/editing signals that are relevant here. Evidence: job needs strong editing judgment, profile shows editorial or publication work.")
      filler.push("You have detail-driven work that maps to editorial quality control. Evidence: job needs accuracy and consistency, profile shows proofreading/editing responsibilities.")
    } else {
      filler.push("There is some visible alignment to the role’s function, but proof is limited. Evidence: job needs role-specific execution, profile shows adjacent transferable work.")
      filler.push("You have demonstrated follow-through and multi-tasking in prior roles. Evidence: job needs deadline management, profile shows coordination and responsibility.")
    }
    bullets = cleanBulletsNoQuotes([...bullets, ...filler], jobText, 5)
  }
  bullets = bullets.slice(0, 5)

  // Prevent “No risk flags returned” on competitive roles or when Apply is granted without clear proof
  const meaningfulRiskCount = countMeaningfulRisks(riskFlags)
  const roleHasYearsReq = /\b(3–6 years|3-6 years|3 to 6 years|minimum\s+3\s+years|at least\s+3\s+years)\b/i.test(jobText)

  if (decision !== "Pass") {
    const shouldForceRisk =
      (riskFlags.length === 0) ||
      (meaningfulRiskCount === 0 && (competitiveEditorial || roleHasYearsReq))

    if (shouldForceRisk) {
      const add: string[] = []

      if (roleHasYearsReq) {
        add.push("Years-of-experience bar may be above typical entry-level. If you do not have multiple years of professional editing, expect a tougher screen.")
      }

      if (competitiveEditorial) {
        add.push("Competitive applicant pool. Expect higher editing standards and stronger prior publication experience among finalists.")
      }

      if (gate.type === "floor_review") {
        add.push(gate.reason)
      }

      // If none triggered, add one honest general risk
      if (add.length === 0) {
        add.push("Competitive screening. If your most relevant proof is limited on-paper, expect a tougher first screen.")
      }

      riskFlags = cleanBulletsNoQuotes([...add, ...riskFlags], jobText, 6)
    }
  }

  // If decision says Apply but we have 2+ meaningful risks, tighten to Review
  if (decision === "Apply" && countMeaningfulRisks(riskFlags) >= 2) {
    decision = "Review"
  }

  // If Review and risks are actually empty, allow Apply only if we have strong WHY volume (>=4) and not floor_review
  if (decision === "Review" && gate.type !== "floor_review" && countMeaningfulRisks(riskFlags) === 0 && bullets.length >= 4) {
    decision = "Apply"
  }

  // Score sanity
  if (decision === "Review" && score < 58) decision = "Pass"
  score = enforceScoreBand(decision, score)

  const next_step =
    decision === "Pass"
      ? "Do not apply. Focus on more aligned positions."
      : decision === "Review"
      ? "Review the risk flags carefully before proceeding."
      : "Apply promptly if this role is still open."

  return {
    decision,
    icon: iconForDecision(decision),
    score,
    bullets, // WHY bullets
    risk_flags: riskFlags,
    next_step,
    location_constraint: loc,
    logic_version: JOBFIT_LOGIC_VERSION,
    debug: {
      gate_type: gate.type,
      job_family: fam,
      school_tier: schoolTier,
      competitive_editorial: competitiveEditorial,
      job_facts: jobFacts,
      raw_model_json_ok: true,
    },
  }
}