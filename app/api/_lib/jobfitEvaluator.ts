// app/api/_lib/jobfitEvaluator.ts
// Deterministic JobFit rules engine (no LLM decisioning)
//
// Principles
// - Decision-first (Priority Apply / Apply / Review / Pass)
// - No job quotes in bullets
// - No visa/work auth, driver's license, background check, drug test risks
// - Uses profileStructured when present (no new user inputs)
// - Human-readable risk flags only (no internal tokens)
// - Slightly aggressive: if you can't stand up to it, it's Review/Pass, not Apply
//
// Version
export const JOBFIT_LOGIC_VERSION = "rules_v1_2026_02_19"

// ----------------------- Types -----------------------

export type Decision = "Priority Apply" | "Apply" | "Review" | "Pass"
export type LocationConstraint = "constrained" | "not_constrained" | "unclear"
export type YM = { year: number; month: number } // month 1-12

export type JobFacts = {
  isHourly: boolean
  hourlyEvidence?: string | null
  isContract: boolean
  contractEvidence?: string | null
  isFullyRemote: boolean
}

export type ProfileConstraints = {
  hardNoHourlyPay: boolean
  prefFullTime: boolean
  hardNoContract: boolean
  hardNoSales: boolean
  hardNoGovernment: boolean
  hardNoFullyRemote: boolean
  veryOpenToNonObvious: boolean
}

export type EmployerTier = 1 | 2 | 3 | 4
export type SchoolTier = "S" | "A" | "B" | "C" | "unknown"
export type GpaBand = "3.8_plus" | "3.5_3.79" | "below_3.5" | "unknown"

export type JobSeniority = "internship" | "entry" | "early_career" | "experienced" | "unknown"

export type JobFunction =
  | "investment_banking_pe_mna"
  | "consulting_strategy"
  | "finance_accounting"
  | "commercial_real_estate"
  | "publishing_editorial"
  | "sales"
  | "marketing_analytics"
  | "brand_marketing"
  | "product_program_ops"
  | "customer_success"
  | "government_public"
  | "software_data"
  | "research"
  | "clinical_health"
  | "unknown"

export type AlignmentLevel = "direct" | "strong_adjacent" | "weak_adjacent" | "none"
export type TargetAlignment = "on_target" | "off_target" | "unclear"

export type SignalKey =
  // Finance
  | "modeling"
  | "valuation"
  | "fp_and_a"
  | "budgeting"
  | "forecasting"
  | "fin_statements"
  | "underwriting"
  | "credit_risk"
  | "treasury"
  | "audit"
  | "tax"
  | "ap_ar"
  | "bookkeeping"

  // Data and analytics
  | "excel"
  | "sql"
  | "dashboarding"
  | "reporting"
  | "data_analysis"
  | "data_engineering"
  | "data_modeling"
  | "data_quality"
  | "statistics"
  | "experimentation"
  | "market_research"
  | "research" // general research (non-publishing-specific)

  // Software and IT
  | "software_engineering"
  | "frontend"
  | "backend"
  | "full_stack"
  | "api_development"
  | "cloud_infra"
  | "devops"
  | "sre"
  | "security"
  | "it_support"
  | "networking_it"
  | "qa_testing"
  | "automation"
  | "ai_ml"

  // Product and project
  | "product_management"
  | "program_management"
  | "project_management"
  | "roadmapping"
  | "requirements"
  | "process_improvement"
  | "change_management"
  | "documentation"

  // Operations and supply chain
  | "ops"
  | "logistics"
  | "supply_chain"
  | "procurement"
  | "vendor_management"
  | "inventory"
  | "facilities"
  | "quality_assurance"
  | "manufacturing"
  | "compliance_ops"

  // Sales and customer
  | "sales"
  | "business_development"
  | "account_management"
  | "customer_success"
  | "support"
  | "crm"
  | "negotiation"
  | "partnerships"
  | "presentations"

  // Marketing and growth
  | "brand_marketing"
  | "content_marketing"
  | "copywriting"
  | "paid_media"
  | "seo"
  | "lifecycle_marketing"
  | "events_marketing"
  | "social_media"
  | "communications_pr"
  | "creative_direction"

  // Writing, editorial, publishing
  | "editing"
  | "proofreading"
  | "publishing_ops"
  | "cms"
  | "headline_writing"
  | "publishing_research"

  // HR and recruiting
  | "recruiting"
  | "hr_ops"
  | "people_ops"
  | "payroll_benefits"
  | "learning_development"

  // Legal and policy
  | "legal_contracts"
  | "legal_research"
  | "policy"

  // Healthcare and clinical
  | "clinical_care"
  | "patient_intake"
  | "medical_documentation"
  | "phlebotomy"
  | "emt"
  | "therapy"
  | "public_health"
  | "clinical_research"

  // Education and nonprofit
  | "teaching"
  | "curriculum"
  | "student_services"
  | "grant_writing"
  | "fundraising"
  | "community_outreach"

export type Signal = { key: SignalKey; label: string }

export type RunJobFitResult = {
  decision: Decision
  icon: string
  score: number
  bullets: string[]
  risk_flags: string[]
  next_step: string
  location_constraint: LocationConstraint
  logic_version: string
  debug?: any
}

// ----------------------- Basics -----------------------

function normalizeText(t: string) {
  return (t || "")
    .replace(/\u202f/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function iconForDecision(decision: Decision) {
  if (decision === "Priority Apply") return "🔥"
  if (decision === "Apply") return "✅"
  if (decision === "Review") return "⚠️"
  return "⛔"
}

function enforceScoreBand(decision: Decision, score: number) {
  const s = Math.round(score)
  if (decision === "Priority Apply") return clamp(s, 85, 95)
  if (decision === "Apply") return clamp(s, 70, 84)
  if (decision === "Review") return clamp(s, 50, 69)
  return clamp(s, 40, 49)
}

function uniqTop(items: string[], max: number) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of items || []) {
    const k = String(x || "").trim()
    if (!k) continue
    const key = k.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(k)
    if (out.length >= max) break
  }
  return out
}

function safeObj(x: any) {
  return x && typeof x === "object" ? x : {}
}

function joinWithAnd(items: string[]) {
  const a = (items || []).map((x) => String(x || "").trim()).filter(Boolean)
  if (a.length <= 1) return a[0] || ""
  if (a.length === 2) return `${a[0]} and ${a[1]}`
  return `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`
}

function cleanSignalLabel(label: string) {
  return String(label || "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function buildVisibilityBullet() {
  return "SIGNAL evaluates what is visible. If you have the experience but it is not clearly shown, the market will treat it as missing."
}

function buildNextStep(decision: Decision) {
  if (decision === "Pass") return "Do not apply."
  if (decision === "Review") return "Only apply if you accept the risks."
  if (decision === "Apply") return "Apply. Then move to networking."
  return "Priority apply. Then move to networking."
}

// ----------------------- Extract job facts -----------------------

export function extractJobFacts(jobText: string): JobFacts {
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

  // Contract should mean employment type, not "contract forms"
  const contractNoise =
    /\bcontract\s+(forms?|templates?|paperwork|documents?)\b/.test(t0) ||
    /\bdraft\b[^\n]{0,40}\bcontract\b/.test(t0) ||
    /\bdeal\s+memos?\b/.test(t0)

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

export function inferJobSeniority(jobText: string): JobSeniority {
  const t = normalizeText(jobText)
  if (/\b(intern|internship|summer analyst|co-op|co op)\b/.test(t)) return "internship"
  if (/\b(0-?1|0-?2)\s+years\b/.test(t) || /\b(entry level|new grad|graduate program)\b/.test(t)) return "entry"
  if (/\b(1-?3|2-?4)\s+years\b/.test(t)) return "early_career"
  if (/\b(3\+|4\+|5\+)\s+years\b/.test(t) || /\bminimum\s+(3|4|5)\s+years\b/.test(t)) return "experienced"
  return "unknown"
}

export function inferEmployerTier(jobText: string): EmployerTier {
  const t = normalizeText(jobText)

  const tier1Signals = [
    /\binvestment banking\b/,
    /\bprivate equity\b/,
    /\bm&a\b/,
    /\bleveraged finance\b/,
    /\blbo\b/,
    /\bmanagement consulting\b/,
    /\bstrategy\s+consult(ing|ant)\b/,
    /\bgoldman\b|\bmorgan stanley\b|\bjpmorgan\b|\bciti\b|\bbofa\b|\bbarclays\b|\bevercore\b|\blazard\b|\bcenterview\b/,
    /\bmckinsey\b|\bbain\b|\bbcg\b|\bdeloitte consulting\b|\bstrategy&\b/,
  ]

  const tier2Signals = [
    /\brotational\b/,
    /\bleadership development\b/,
    /\bformal training\b/,
    /\bnew grad program\b/,
    /\baccelerated development\b/,
  ]

  if (tier1Signals.some((r) => r.test(t))) return 1
  if (tier2Signals.some((r) => r.test(t))) return 2
  return 3
}

export function inferJobFunction(jobText: string): JobFunction {
  const t = normalizeText(jobText)

  if (/\b(investment banking|private equity|m&a|mergers|acquisitions|lbo|leveraged buyout|capital markets)\b/.test(t))
    return "investment_banking_pe_mna"

  if (/\b(management consulting|strategy consulting|consultant|case interview|client engagements?)\b/.test(t))
    return "consulting_strategy"

  if (/\b(commercial real estate|cre\b|multifamily|industrial|office leasing|real estate underwriting|dscr|noi|cap rate)\b/.test(t))
    return "commercial_real_estate"

  if (/\b(accounting|accountant|ar\b|ap\b|general ledger|reconciliation|financial statements|cpa)\b/.test(t))
    return "finance_accounting"

  // Publishing/editorial must win early
  if (
    /\b(editorial assistant|editorial|executive editor|acquisitions editor|editor\b|publishing|imprint|literary agent|book proposals?|submissions?|manuscripts?)\b/.test(t) ||
    /\b(copy[- ]?edit|copyedit|proofread|proofreading|line edit|incopy|cms|wordpress|headline|display copy)\b/.test(t)
  ) return "publishing_editorial"

  if (/\b(sales|business development|quota|commission|pipeline|lead gen|cold call)\b/.test(t))
    return "sales"

  if (/\b(marketing analytics|marketing analyst|roas|meta ads|google ads|campaign performance|attribution|sql\b|a\/b test)\b/.test(t))
    return "marketing_analytics"

  if (/\b(brand marketing|brand strategy|brand manager|content marketing|social media|creative strategy|communications)\b/.test(t))
    return "brand_marketing"

  if (/\b(program manager|project manager|operations|biz ops|business operations|process improvement|program management)\b/.test(t))
    return "product_program_ops"

  if (/\b(customer success|client success|implementation|onboarding|account manager)\b/.test(t))
    return "customer_success"

  if (/\b(government|public sector|municipal|state agency|federal)\b/.test(t))
    return "government_public"

  if (/\b(software engineer|developer|full stack|frontend|backend|api\b|javascript|typescript|python\b|data engineer|machine learning)\b/.test(t))
    return "software_data"

  if (/\b(research assistant|literature review|irb\b|lab\b|publication)\b/.test(t))
    return "research"

  if (/\b(clinical|patient|medical device|emt\b|paramedic|nurse|rn\b|physician|therapy|pt\b|occupational)\b/.test(t))
    return "clinical_health"

  return "unknown"
}

// ----------------------- Profile constraints -----------------------

export function extractProfileConstraints(profileText: string): ProfileConstraints {
  const t0 = normalizeText(profileText)

  const hardNoHourlyPay =
    t0.includes("no hourly") ||
    t0.includes("no hourly pay") ||
    (t0.includes("do not want") && t0.includes("hourly")) ||
    (t0.includes("hard exclusion") && t0.includes("hourly"))

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
    (t0.includes("do not want") && (t0.includes("sales") || t0.includes("commission"))) ||
    t0.includes("no sales") ||
    t0.includes("no commission") ||
    t0.includes("commission-based")

  const hardNoGovernment =
    (t0.includes("do not want") && (t0.includes("government") || t0.includes("governmental"))) ||
    t0.includes("no government") ||
    t0.includes("governmental")

  const hardNoFullyRemote =
    t0.includes("no fully remote") ||
    (t0.includes("do not want") && t0.includes("fully remote"))

  const veryOpenToNonObvious =
    t0.includes("very open") ||
    t0.includes("open to non-obvious") ||
    t0.includes("open to non obvious") ||
    t0.includes("non-obvious entry") ||
    t0.includes("non obvious entry")

  return {
    hardNoHourlyPay,
    prefFullTime,
    hardNoContract,
    hardNoSales,
    hardNoGovernment,
    hardNoFullyRemote,
    veryOpenToNonObvious,
  }
}

// ----------------------- Structured profile readers -----------------------

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

export function readSchoolTier(profileStructured: any, profileText: string): SchoolTier {
  const ps = safeObj(profileStructured)
  const raw = String(ps.school_tier || ps.profile?.school_tier || "").trim().toUpperCase()
  if (raw === "S" || raw === "A" || raw === "B" || raw === "C") return raw
  return inferSchoolTierFromText(profileText)
}

export function readGpaBand(profileStructured: any): GpaBand {
  const ps = safeObj(profileStructured)
  const raw = String(ps.gpa_band || ps.profile?.gpa_band || "").trim().toLowerCase()
  if (raw === "3.8_plus" || raw === "3.5_3.79" || raw === "below_3.5") return raw
  return "unknown"
}

export function readGpa(profileStructured: any): number | null {
  const ps = safeObj(profileStructured)
  const g = Number(ps.gpa || ps.profile?.gpa)
  return Number.isFinite(g) ? g : null
}

export function readTargets(profileStructured: any, profileText: string): string[] {
  const ps = safeObj(profileStructured)
  const list =
    (Array.isArray(ps.target_roles_list) ? ps.target_roles_list : null) ||
    (Array.isArray(ps.profile?.target_roles_list) ? ps.profile.target_roles_list : null) ||
    []

  const fromStructured = list.map((x: any) => String(x || "").trim()).filter(Boolean)
  if (fromStructured.length > 0) return fromStructured.slice(0, 25)

  const t = normalizeText(profileText)
  const hits: string[] = []
  if (t.includes("investment banking")) hits.push("investment banking")
  if (t.includes("private equity")) hits.push("private equity")
  if (t.includes("consulting")) hits.push("consulting")
  if (t.includes("commercial real estate")) hits.push("commercial real estate")
  if (t.includes("publishing") || t.includes("editorial")) hits.push("publishing / editorial")
  if (t.includes("marketing")) hits.push("marketing")
  if (t.includes("sales")) hits.push("sales")
  if (t.includes("finance")) hits.push("finance")
  if (t.includes("product")) hits.push("product")
  if (t.includes("operations")) hits.push("operations")
  if (t.includes("customer success")) hits.push("customer success")
  if (t.includes("government")) hits.push("government")
  if (t.includes("software") || t.includes("engineer") || t.includes("developer")) hits.push("software")
  if (t.includes("data")) hits.push("data")
  if (t.includes("research")) hits.push("research")
  if (t.includes("clinical") || t.includes("medical") || t.includes("emt")) hits.push("clinical")
  return uniqTop(hits, 12)
}

export function mapTargetsToFunctions(targets: string[]): JobFunction[] {
  const t = (targets || []).map((x) => normalizeText(x))
  const out: JobFunction[] = []

  for (const s of t) {
    if (/\b(investment banking|private equity|m&a|ib\b|pe\b)\b/.test(s)) out.push("investment_banking_pe_mna")
    else if (/\b(consulting|strategy)\b/.test(s)) out.push("consulting_strategy")
    else if (/\b(commercial real estate|real estate)\b/.test(s)) out.push("commercial_real_estate")
    else if (/\b(accounting|finance)\b/.test(s)) out.push("finance_accounting")
    else if (/\b(publishing|editorial|books?)\b/.test(s)) out.push("publishing_editorial")
    else if (/\b(sales|business development)\b/.test(s)) out.push("sales")
    else if (/\b(marketing analytics|analytics)\b/.test(s)) out.push("marketing_analytics")
    else if (/\b(brand|content|social)\b/.test(s)) out.push("brand_marketing")
    else if (/\b(product|program|operations|ops)\b/.test(s)) out.push("product_program_ops")
    else if (/\b(customer success|client success)\b/.test(s)) out.push("customer_success")
    else if (/\b(government|public)\b/.test(s)) out.push("government_public")
    else if (/\b(software|engineering|data)\b/.test(s)) out.push("software_data")
    else if (/\b(research)\b/.test(s)) out.push("research")
    else if (/\b(clinical|medical|health)\b/.test(s)) out.push("clinical_health")
  }

  const seen = new Set<string>()
  const dedup: JobFunction[] = []
  for (const f of out) {
    if (seen.has(f)) continue
    seen.add(f)
    dedup.push(f)
  }
  return dedup.slice(0, 12)
}

export function inferTargetAlignment(primary: JobFunction, targets: JobFunction[]): TargetAlignment {
  if (!targets || targets.length === 0) return "unclear"
  if (targets.includes(primary)) return "on_target"
  return "off_target"
}

// ----------------------- Eligibility (grad window) -----------------------

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

export function extractGradWindow(jobText: string): { start: YM; end: YM } | null {
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

export function extractCandidateGrad(profileText: string, profileStructured: any): YM | null {
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

// ----------------------- Suppress noisy risks -----------------------

function suppressRiskText(s0: string) {
  const s = normalizeText(s0)
  if (s.includes("visa") || s.includes("work authorization") || s.includes("sponsorship")) return true
  if (s.includes("authorized to work") || s.includes("employment authorization")) return true
  if (s.includes("driver") && s.includes("license")) return true
  if (s.includes("background check") || s.includes("drug test")) return true
  if (s.includes("valid license") && s.includes("driver")) return true
  if (s.includes("not stated") || s.includes("not specified") || s.includes("not mentioned") || s.includes("unclear from the job")) return true
  return false
}

// ----------------------- Hard requirements gate -----------------------

type RequirementHit = { key: string; label: string }

export function detectHardRequirements(jobText: string): RequirementHit[] {
  const t = normalizeText(jobText)
  const reqs: RequirementHit[] = []

  const patterns: Array<[RegExp, RequirementHit]> = [
    [/\b(series\s*7)\b/, { key: "req_series_7", label: "Series 7 license required" }],
    [/\b(series\s*63)\b/, { key: "req_series_63", label: "Series 63 license required" }],
    [/\b(cpa)\b/, { key: "req_cpa", label: "CPA required" }],
    [/\b(pmp)\b/, { key: "req_pmp", label: "PMP certification required" }],
    [/\b(security clearance|ts\/sc|top secret)\b/, { key: "req_clearance", label: "Security clearance required" }],
    [/\b(rn)\b/, { key: "req_rn", label: "RN license required" }],
    [/\b(emt)\b/, { key: "req_emt", label: "EMT certification required" }],
  ]

  for (const [re, hit] of patterns) if (re.test(t)) reqs.push(hit)

  const seen = new Set<string>()
  const out: RequirementHit[] = []
  for (const r of reqs) {
    if (seen.has(r.key)) continue
    seen.add(r.key)
    out.push(r)
  }
  return out.slice(0, 10)
}

export function profileMentionsRequirement(profileText: string, req: RequirementHit) {
  const t = normalizeText(profileText)
  if (req.key === "req_series_7") return /\bseries\s*7\b/.test(t)
  if (req.key === "req_series_63") return /\bseries\s*63\b/.test(t)
  if (req.key === "req_cpa") return /\bcpa\b/.test(t)
  if (req.key === "req_pmp") return /\bpmp\b/.test(t)
  if (req.key === "req_clearance") return /\bsecurity clearance|ts\/sc|top secret\b/.test(t)
  if (req.key === "req_rn") return /\brn\b/.test(t)
  if (req.key === "req_emt") return /\bemt\b/.test(t)
  return false
}

// ----------------------- Alignment + depth -----------------------

const DIRECT_KEYWORDS: Record<JobFunction, RegExp[]> = {
  investment_banking_pe_mna: [/\b(investment banking|ib\b|m&a|mergers|acquisitions|lbo|leveraged buyout|pitchbook|financial modeling|valuation|dcf)\b/],
  consulting_strategy: [/\b(consulting|consultant|case interview|workstream|deck|analysis|client deliverables)\b/],
  finance_accounting: [/\b(financial analysis|fp&a|budget|forecast|accounting|reconciliation|general ledger|journal entries|ar\b|ap\b)\b/],
  commercial_real_estate: [/\b(commercial real estate|real estate underwriting|noi|cap rate|dscr|multifamily|industrial|office|leasing)\b/],
  publishing_editorial: [
    /\b(editorial assistant|editorial|executive editor|editor\b|publishing|imprint|manuscripts?|submissions?|proposals?|literary agent)\b/,
    /\b(copy edit|copyediting|proofread|proofreading|line edit|fact[- ]?check)\b/,
    /\b(headlines?|display copy|seo|content-management system|cms|wordpress|incopy)\b/,
  ],
  sales: [/\b(sales|business development|quota|pipeline|crm\b|lead gen|cold call|outbound|closing)\b/],
  marketing_analytics: [/\b(sql\b|google analytics|roas|attribution|a\/b test|performance marketing|campaign performance|meta ads|google ads)\b/],
  brand_marketing: [/\b(brand|content|social media|creative strategy|communications|copywriting|storytelling)\b/],
  product_program_ops: [/\b(program management|project management|operations|process improvement|roadmap|requirements|stakeholders?)\b/],
  customer_success: [/\b(customer success|client success|onboarding|implementation|account management|retention)\b/],
  government_public: [/\b(government|public sector|municipal|state agency|federal)\b/],
  software_data: [/\b(software|engineer|developer|typescript|javascript|python\b|api\b|database|sql\b|data pipeline|machine learning)\b/],
  research: [/\b(research assistant|lab\b|irb\b|publication|literature review|data collection|analysis)\b/],
  clinical_health: [/\b(emt\b|patient|clinical|medical device|therapy|rn\b|hospital)\b/],
  unknown: [],
}

const STRONG_ADJACENCY: Record<JobFunction, JobFunction[]> = {
  investment_banking_pe_mna: ["finance_accounting", "commercial_real_estate", "consulting_strategy"],
  consulting_strategy: ["product_program_ops", "finance_accounting", "marketing_analytics"],
  finance_accounting: ["investment_banking_pe_mna", "commercial_real_estate", "product_program_ops"],
  commercial_real_estate: ["finance_accounting", "investment_banking_pe_mna"],
  publishing_editorial: ["brand_marketing", "research", "product_program_ops"],
  sales: ["customer_success", "brand_marketing"],
  marketing_analytics: ["brand_marketing", "product_program_ops"],
  brand_marketing: ["marketing_analytics", "customer_success"],
  product_program_ops: ["consulting_strategy", "marketing_analytics", "finance_accounting"],
  customer_success: ["sales", "brand_marketing", "product_program_ops"],
  government_public: ["unknown"],
  software_data: ["research"],
  research: ["software_data", "clinical_health"],
  clinical_health: ["research"],
  unknown: ["unknown"],
}

function countKeywordHits(text: string, patterns: RegExp[]) {
  const t = normalizeText(text)
  let hits = 0
  for (const re of patterns || []) if (re.test(t)) hits += 1
  return hits
}

export function inferAlignmentLevel(profileText: string, primary: JobFunction): { level: AlignmentLevel; evidenceScore: number } {
  if (primary === "unknown") return { level: "weak_adjacent", evidenceScore: 0 }

  const directHits = countKeywordHits(profileText, DIRECT_KEYWORDS[primary] || [])
  if (directHits >= 1) return { level: "direct", evidenceScore: 2 + directHits }

  const strongAdj = STRONG_ADJACENCY[primary] || []
  let bestAdjHits = 0
  for (const adj of strongAdj) {
    const hits = countKeywordHits(profileText, DIRECT_KEYWORDS[adj] || [])
    if (hits > bestAdjHits) bestAdjHits = hits
  }

  if (bestAdjHits >= 1) return { level: "strong_adjacent", evidenceScore: 1 + bestAdjHits }

  const t = normalizeText(profileText)
  const weakSignals =
    (t.includes("project") ? 1 : 0) +
    (t.includes("leadership") ? 1 : 0) +
    (t.includes("analysis") ? 1 : 0) +
    (t.includes("intern") ? 1 : 0)

  if (weakSignals >= 2) return { level: "weak_adjacent", evidenceScore: 1 }
  return { level: "none", evidenceScore: 0 }
}

export function computeDepthScore(profileText: string, seniority: JobSeniority): { depth: number; label: "strong" | "moderate" | "weak" } {
  const t = normalizeText(profileText)

  const hasIntern = /\b(intern|internship|co-op|co op)\b/.test(t) ? 2 : 0
  const hasWork = /\b(analyst|assistant|associate|coordinator|representative|specialist)\b/.test(t) ? 1 : 0
  const hasLeadership = /\b(president|vp|vice president|captain|lead|chair|founder)\b/.test(t) ? 1 : 0
  const hasProjects = /\b(project|case competition|capstone)\b/.test(t) ? 1 : 0
  const hasResearch = /\b(research|lab|irb|publication)\b/.test(t) ? 1 : 0
  const hasAcademics = /\b(major|minor|b\.s\.|b\.a\.|gpa)\b/.test(t) ? 1 : 0

  let depth = hasIntern + hasWork + hasLeadership + hasProjects + hasResearch + hasAcademics

  if (seniority === "experienced") depth -= 1
  if (seniority === "internship") depth += 1

  depth = clamp(depth, 0, 10)

  if (depth >= 6) return { depth, label: "strong" }
  if (depth >= 3) return { depth, label: "moderate" }
  return { depth, label: "weak" }
}

// ----------------------- Signals extraction -----------------------

function overlapCount(jobSignals: Signal[], profSignals: Signal[]): number {
  const profKeys = new Set(profSignals.map((s) => s.key))
  let n = 0
  for (const s of jobSignals) if (profKeys.has(s.key)) n += 1
  return n
}

export function overlapSignals(job: Signal[], prof: Signal[]) {
  const profKeys = new Set(prof.map((s) => s.key))
  return (job || []).filter((s) => profKeys.has(s.key))
}

export function signalLabels(signals: Signal[], max: number) {
  return (signals || [])
    .map((s) => String(s?.label || "").trim())
    .filter(Boolean)
    .slice(0, max)
}

// NOTE: Signals are used as "proof points." Keep them strict.
export function extractJobSignals(jobText: string): Signal[] {
  const t = normalizeText(jobText)

  const signals: Array<[RegExp, Signal]> = [
    // Publishing/editorial
    [/\b(copy[- ]?edit|copyedit|line edit|proofread|proofreading)\b/, { key: "editing", label: "Copyediting and line editing" }],
    [/\b(headlines?|display copy)\b/, { key: "headline_writing", label: "Headline and display copy writing" }],
    [/\bseo\b/, { key: "seo", label: "SEO-aware writing and publishing" }],
    [/\b(content[- ]?management system|cms)\b/, { key: "cms", label: "Content management system publishing" }],
    [/\b(wordpress|incopy|google docs)\b/, { key: "cms", label: "Working in editorial tools (CMS, Docs, InCopy)" }],
    [/\b(editorial assistant|editorial|publisher|publishing|imprint)\b/, { key: "publishing_ops", label: "Editorial support and publishing workflow" }],
    [
      /\b(research)\b.*\b(archives?|database|databases|sources|fact[- ]?check|fact check)\b|\b(archives?|database|databases|sources|fact[- ]?check|fact check)\b.*\b(research)\b/,
      { key: "publishing_research", label: "Researching archives, databases, or sources for accuracy" },
    ],

    // Finance
    [/\b(financial modeling|dcf|lbo|valuation)\b/, { key: "modeling", label: "Financial modeling and valuation" }],
    [/\b(fp&a|forecasting|budgeting|plan vs actual)\b/, { key: "fp_and_a", label: "FP&A, forecasting, and planning" }],
    [/\b(financial statements|balance sheet|income statement|cash flow)\b/, { key: "fin_statements", label: "Financial statement work" }],
    [/\b(underwriting|credit memo|credit analysis)\b/, { key: "underwriting", label: "Underwriting or credit analysis" }],

    // Data/analytics
    [/\bsql\b/, { key: "sql", label: "SQL-based analysis" }],
    [/\b(advanced excel|pivot tables?|vlookup|xlookup|index\s*match|excel modeling)\b/, { key: "excel", label: "Excel execution (advanced functions)" }],
    [/\b(tableau|power bi|looker|dashboard)\b/, { key: "dashboarding", label: "Dashboards and BI tools" }],
    [/\b(a\/b test|experiment|randomized)\b/, { key: "experimentation", label: "Experimentation and testing" }],
    [/\b(market research|competitive research|user research)\b/, { key: "market_research", label: "Market, competitive, or user research" }],

    // Software/IT
    [/\b(software engineer|developer|engineering)\b/, { key: "software_engineering", label: "Software engineering" }],
    [/\b(frontend|react|next\.js|typescript|javascript)\b/, { key: "frontend", label: "Frontend development" }],
    [/\b(backend|node|python|java|go|api)\b/, { key: "backend", label: "Backend development" }],
    [/\b(devops|ci\/cd|docker|kubernetes)\b/, { key: "devops", label: "DevOps and deployment" }],
    [/\b(site reliability|sre)\b/, { key: "sre", label: "Reliability and uptime ownership" }],
    [/\b(security|iam|vulnerability)\b/, { key: "security", label: "Security practices and controls" }],

    // Product/project/process
    [/\b(product manager|product management)\b/, { key: "product_management", label: "Product management" }],
    [/\b(program manager|program management)\b/, { key: "program_management", label: "Program management" }],
    [/\b(project manager|project management)\b/, { key: "project_management", label: "Project management" }],
    [/\b(requirements|user stories|prd)\b/, { key: "requirements", label: "Requirements and specs" }],
    [/\b(process improvement|lean|six sigma)\b/, { key: "process_improvement", label: "Process improvement" }],

    // Ops/supply chain
    [/\b(operations|ops)\b/, { key: "ops", label: "Operations execution" }],
    [/\b(logistics|shipping|freight|transportation)\b/, { key: "logistics", label: "Logistics coordination" }],
    [/\b(supply chain)\b/, { key: "supply_chain", label: "Supply chain planning" }],
    [/\b(procurement|sourcing|purchase orders?)\b/, { key: "procurement", label: "Procurement and sourcing" }],
    [/\b(vendor management|supplier management)\b/, { key: "vendor_management", label: "Vendor and supplier management" }],

    // Sales/customer
    [/\b(cold call|pipeline|quota|closing)\b/, { key: "sales", label: "Sales execution" }],
    [/\b(business development|bd)\b/, { key: "business_development", label: "Business development" }],
    [/\b(account management)\b/, { key: "account_management", label: "Account management" }],
    [/\b(customer success|client success|retention)\b/, { key: "customer_success", label: "Customer success and retention" }],
    [/\b(crm|salesforce|hubspot)\b/, { key: "crm", label: "CRM usage and pipeline hygiene" }],
    [/\b(presentation|deck|powerpoint)\b/, { key: "presentations", label: "Presentations and stakeholder communication" }],

    // Marketing
    [/\b(brand marketing|brand strategy)\b/, { key: "brand_marketing", label: "Brand marketing" }],
    [/\b(content marketing|content strategy)\b/, { key: "content_marketing", label: "Content marketing" }],
    [/\b(copywriting)\b/, { key: "copywriting", label: "Copywriting" }],
    [/\b(meta ads|google ads|paid media|roas)\b/, { key: "paid_media", label: "Paid media execution" }],
    [/\b(lifecycle|email marketing)\b/, { key: "lifecycle_marketing", label: "Lifecycle and email marketing" }],
    [/\b(social media|tiktok|instagram|youtube)\b/, { key: "social_media", label: "Social media execution" }],

    // HR/recruiting
    [/\b(recruiter|recruiting|talent acquisition)\b/, { key: "recruiting", label: "Recruiting and hiring support" }],
    [/\b(hr operations|hr ops|onboarding|offboarding)\b/, { key: "hr_ops", label: "HR operations" }],

    // Legal/policy
    [/\b(contracts?|msa|nda|terms and conditions)\b/, { key: "legal_contracts", label: "Contract drafting and review" }],
    [/\b(legal research|case law|westlaw|lexis)\b/, { key: "legal_research", label: "Legal research" }],
    [/\b(policy|regulatory)\b/, { key: "policy", label: "Policy and regulatory work" }],

    // Healthcare/clinical
    [/\b(patient care|clinical care|bedside)\b/, { key: "clinical_care", label: "Clinical or patient-facing care" }],
    [/\b(intake|triage|vitals)\b/, { key: "patient_intake", label: "Patient intake and triage support" }],
    [/\b(documentation|charting|ehr|epic)\b/, { key: "medical_documentation", label: "Medical documentation and charting" }],
    [/\bemt\b|paramedic\b/, { key: "emt", label: "Emergency medical response" }],
    [/\b(clinical research|trial|irb)\b/, { key: "clinical_research", label: "Clinical research support" }],

    // Education/nonprofit
    [/\b(teach|teaching|instructor)\b/, { key: "teaching", label: "Teaching and instruction" }],
    [/\b(curriculum|lesson plans?)\b/, { key: "curriculum", label: "Curriculum and lesson planning" }],
    [/\b(grant writing|grant application)\b/, { key: "grant_writing", label: "Grant writing" }],
    [/\b(fundraising|donor|development)\b/, { key: "fundraising", label: "Fundraising and donor development" }],
    [/\b(community outreach|community engagement)\b/, { key: "community_outreach", label: "Community outreach" }],
  ]

  const out: Signal[] = []
  for (const [re, sig] of signals) {
    if (re.test(t)) out.push(sig)
    if (out.length >= 4) break
  }
  return out
}

export function extractProfileSignals(profileText: string): Signal[] {
  const t = normalizeText(profileText)

  const signals: Array<[RegExp, Signal]> = [
    // Publishing/editorial
    [/\b(copy[- ]?edit(or|ing)?|copyedit|line edit(ing)?|proofread(ing)?|querying)\b/, { key: "editing", label: "Copyediting, proofreading, and editorial judgment" }],
    [/\b(undergraduate reader|reader)\b/, { key: "editing", label: "Evaluating and screening written submissions" }],
    [/\b(fact[- ]?check(ing)?|fact check(ing)?)\b/, { key: "publishing_research", label: "Fact-checking and accuracy-focused review" }],
    [/\b(headlines?|display copy)\b/, { key: "headline_writing", label: "Headline or display copy writing" }],
    [/\b(seo)\b/, { key: "seo", label: "SEO-aware editorial writing" }],
    [/\b(content[- ]?management system|cms|wordpress|incopy)\b/, { key: "cms", label: "Working in editorial tools (CMS, WordPress, InCopy)" }],
    [/\b(yale review|yale daily news|the new journal|magazine|newsroom|publication)\b/, { key: "publishing_ops", label: "Editorial team experience in a publication environment" }],

    // Research (strict)
    [/\b(literature review|research assistant|monograph|publication)\b/, { key: "research", label: "Research and analysis for publication-quality work" }],
    [/\b(database|databases|sources|archives)\b/, { key: "publishing_research", label: "Using databases/sources/archives to support editorial work" }],

    // Ops / coordination
    [/\b(operations intern|operations assistant|operations coordinator)\b/, { key: "ops", label: "Operations coordination and execution" }],
    [/\b(schedule(ing)?|calendar management|deadline(s)?|route materials)\b/, { key: "project_management", label: "Deadlines, scheduling, and multi-thread coordination" }],
    [/\b(process improvement|workflow|sop)\b/, { key: "process_improvement", label: "Process improvement and workflow clean-up" }],

    // Finance
    [/\b(financial modeling|dcf|lbo|valuation)\b/, { key: "modeling", label: "Financial modeling and valuation" }],
    [/\b(underwriting|credit memo|credit analysis)\b/, { key: "underwriting", label: "Underwriting or credit analysis exposure" }],
    [/\b(financial statements|balance sheet|income statement|cash flow)\b/, { key: "fin_statements", label: "Financial statement familiarity" }],
    [/\b(budget|budgeting|expense tracking)\b/, { key: "budgeting", label: "Budgeting and expense tracking" }],
    [/\b(invoice|invoicing|reconciliation|accounts payable|accounts receivable|ap\b|ar\b)\b/, { key: "ap_ar", label: "AP/AR, invoicing, and reconciliations" }],

    // Data/tools
    [/\bsql\b/, { key: "sql", label: "SQL-based analysis" }],
    [/\b(tableau|power bi|looker|dashboard)\b/, { key: "dashboarding", label: "Dashboards and BI tools" }],
    [/\b(advanced excel|pivot tables?|vlookup|xlookup|index\s*match|excel modeling)\b/, { key: "excel", label: "Excel execution (advanced functions)" }],

    // Presentations (explicit only)
    [/\b(presentation|deck|powerpoint)\b/, { key: "presentations", label: "Presentations and stakeholder communication" }],

    // Sales/marketing (explicit only)
    [/\b(cold call|quota|pipeline|crm\b|salesforce|hubspot)\b/, { key: "sales", label: "Sales/CRM execution" }],
    [/\b(meta ads|google ads|paid media|roas)\b/, { key: "paid_media", label: "Paid media execution" }],
    [/\b(content marketing|social media)\b/, { key: "content_marketing", label: "Content and social execution" }],
  ]

  const out: Signal[] = []
  for (const [re, sig] of signals) {
    if (re.test(t)) out.push(sig)
    if (out.length >= 6) break
  }
  return out
}

// ----------------------- Hard exclusions + ceilings -----------------------

type Ceiling = "cap_review"

function applyCeilings(decision: Decision, ceilings: Ceiling[]): Decision {
  if (ceilings.includes("cap_review")) {
    if (decision === "Priority Apply" || decision === "Apply") return "Review"
  }
  return decision
}

export function isHardExclusionPass(
  constraints: ProfileConstraints,
  jobFacts: JobFacts,
  primary: JobFunction
): { pass: boolean; reason?: string } {
  if (constraints.hardNoHourlyPay && jobFacts.isHourly) {
    const ev = jobFacts.hourlyEvidence ? ` (${jobFacts.hourlyEvidence})` : ""
    return { pass: true, reason: `Hourly role${ev} conflicts with an explicit no-hourly exclusion.` }
  }
  if (constraints.hardNoContract && jobFacts.isContract) {
    return { pass: true, reason: "Contract role conflicts with an explicit no-contract exclusion." }
  }
  if (constraints.hardNoSales && primary === "sales") {
    return { pass: true, reason: "Sales-focused role conflicts with an explicit no-sales exclusion." }
  }
  if (constraints.hardNoGovernment && primary === "government_public") {
    return { pass: true, reason: "Government/public-sector role conflicts with an explicit no-government exclusion." }
  }
  return { pass: false }
}

// ----------------------- Experience (years) + recent grad -----------------------

export function extractMinYearsRequired(jobText: string): number | null {
  const t = normalizeText(jobText)

  const mRange = t.match(/\b(\d{1,2})\s*(?:-|\sto\s)\s*(\d{1,2})\s+years?\b/)
  if (mRange) return Number(mRange[1])

  const mAtLeast = t.match(/\b(at least|minimum|min\.)\s*(\d{1,2})\s+years?\b/)
  if (mAtLeast) return Number(mAtLeast[2])

  const mPlus = t.match(/\b(\d{1,2})\s*\+\s*years?\b/)
  if (mPlus) return Number(mPlus[1])

  return null
}

export function isRecentGrad(profileText: string, profileStructured: any): boolean {
  const t = normalizeText(profileText)
  if (t.includes("recent graduate")) return true

  const ps = safeObj(profileStructured)
  const gy = Number(ps.grad_year || ps.profile?.grad_year)
  if (Number.isFinite(gy)) {
    const nowYear = 2026
    if (gy >= nowYear - 1) return true
  }

  if (/\b(may|jun|june|jul|july|aug|september|october|november|december)\s*20\d{2}\b/.test(t)) return true
  if (/\bmay\s*20\d{2}\b/.test(t)) return true

  return false
}

// ----------------------- Risk labels -----------------------

type RiskCode =
  | "off_target_role"
  | "weak_alignment"
  | "strong_adjacent_alignment"
  | "tier1_competition"
  | "tier2_competition"
  | "pedigree_gap"
  | "gpa_risk_below_3_8"
  | "gpa_risk_below_3_5"
  | "contract_role"
  | "hourly_role"
  | "fully_remote_role"
  | "depth_limited"
  | "targets_unclear"
  | "experience_gap"
  | "seniority_mismatch"

function riskLabel(code: RiskCode) {
  switch (code) {
    case "off_target_role":
      return "Off-target vs your stated direction. Do not treat this as a smart apply unless you are intentionally pivoting."
    case "weak_alignment":
      return "Alignment is not clearly tied to what this job does. The market will treat that as missing."
    case "strong_adjacent_alignment":
      return "Your background is adjacent, not direct. That can work, but it raises the bar."
    case "tier1_competition":
      return "Tier 1 competition. Expect tougher screens and a deeper candidate pool."
    case "tier2_competition":
      return "Tier 2 competition. Still competitive."
    case "pedigree_gap":
      return "For this level of competition, school pedigree can matter. Without a feeder background, you need stronger proof."
    case "gpa_risk_below_3_8":
      return "For Tier 1 competition, GPA below 3.8 can reduce odds depending on employer screens."
    case "gpa_risk_below_3_5":
      return "GPA below 3.5 can reduce odds depending on employer screens."
    case "contract_role":
      return "Contract structure. Only proceed if that fits your preference and risk tolerance."
    case "hourly_role":
      return "Hourly pay structure. Make sure that fits your preference and trajectory."
    case "fully_remote_role":
      return "Fully remote role. If you prefer in-person or hybrid, treat this as a real tradeoff."
    case "depth_limited":
      return "Your proof is light for what this role expects. If you have stronger proof, it is not showing clearly."
    case "targets_unclear":
      return "Your targets are unclear, so this decision is based purely on visible fit signals."
    case "experience_gap":
      return "This role asks for 2+ years of experience. Your profile reads more early-career, so expect a higher bar."
    case "seniority_mismatch":
      return "The seniority level is above what your visible experience typically clears. Treat this as a reach unless you can prove equivalent work."
  }
}

function toUserRiskFlags(codes: RiskCode[]) {
  const out: string[] = []
  for (const code of codes) {
    const label = riskLabel(code)
    if (label && !suppressRiskText(label)) out.push(label)
  }
  return uniqTop(out, 8)
}

function shouldShowGpaRisk(employerTier: EmployerTier, gpaBand: GpaBand) {
  if (gpaBand === "unknown") return false
  if (employerTier === 1) return true
  if (employerTier === 2) return gpaBand === "below_3.5"
  return false
}

function shouldSurfaceDepthRisk(params: {
  decision: Decision
  employerTier: EmployerTier
  depthLabel: "strong" | "moderate" | "weak"
  alignmentLevel: AlignmentLevel
}) {
  const { employerTier, depthLabel, alignmentLevel } = params
  if (depthLabel === "weak") return true
  if (employerTier === 1 && depthLabel === "moderate" && alignmentLevel !== "direct") return true
  return false
}

function shouldAddPedigreeBullet(params: { employerTier: EmployerTier; schoolTier: SchoolTier; decision: Decision }) {
  const { employerTier, schoolTier, decision } = params
  const pedigreeStrong = schoolTier === "S" || schoolTier === "A"
  if (!pedigreeStrong) return false
  if (decision === "Apply" || decision === "Priority Apply") return true
  if (employerTier === 1 || employerTier === 2) return true
  return false
}

// ----------------------- MAIN -----------------------

export async function runJobFit({
  profileText,
  jobText,
  profileStructured,
}: {
  profileText: string
  jobText: string
  profileStructured?: any
}): Promise<RunJobFitResult> {
  const ps = safeObj(profileStructured)

  const jobFacts = extractJobFacts(jobText)
  const constraints = extractProfileConstraints(profileText)

  const employerTier: EmployerTier =
    (Number(ps.employer_tier) as any) ||
    (Number(ps.job_meta?.employer_tier) as any) ||
    inferEmployerTier(jobText)

  const schoolTier = readSchoolTier(ps, profileText)
  const gpaBand = readGpaBand(ps)
  const gpa = readGpa(ps)

  const seniority = inferJobSeniority(jobText)
  const primaryFunction = inferJobFunction(jobText)

  const rawTargets = readTargets(ps, profileText)
  const targetFunctions = mapTargetsToFunctions(rawTargets)
  const targetAlignment = inferTargetAlignment(primaryFunction, targetFunctions)

  const ceilings: Ceiling[] = []
  const riskCodes: RiskCode[] = []

  // 1) HARD EXCLUSIONS => PASS
  const hard = isHardExclusionPass(constraints, jobFacts, primaryFunction)
  if (hard.pass) {
    const bullets = uniqTop(
      [hard.reason || "Role conflicts with an explicit hard exclusion.", buildVisibilityBullet()],
      8
    )
    return {
      decision: "Pass",
      icon: iconForDecision("Pass"),
      score: enforceScoreBand("Pass", 45),
      bullets,
      risk_flags: [],
      next_step: buildNextStep("Pass"),
      location_constraint: "unclear",
      logic_version: JOBFIT_LOGIC_VERSION,
    }
  }

  // 2) CEILINGS (do not auto-pass)
  if (constraints.hardNoFullyRemote && jobFacts.isFullyRemote) ceilings.push("cap_review")
  if (constraints.prefFullTime && jobFacts.isContract && !constraints.hardNoContract) ceilings.push("cap_review")
  if (targetAlignment === "off_target" && !constraints.veryOpenToNonObvious) ceilings.push("cap_review")

  // 3) GRAD WINDOW => PASS (if deterministically mismatched)
  const gradWindow = extractGradWindow(jobText)
  const candGrad = extractCandidateGrad(profileText, ps)
  if (gradWindow && candGrad) {
    const c = ymToIndex(candGrad)
    const s = ymToIndex(gradWindow.start)
    const e = ymToIndex(gradWindow.end)
    if (c < s || c > e) {
      const bullets = uniqTop(
        [
          `Graduation window mismatch. This role targets graduates between ${formatYM(gradWindow.start)} and ${formatYM(gradWindow.end)}.`,
          `Your profile indicates graduation around ${formatYM(candGrad)}.`,
          buildVisibilityBullet(),
        ],
        8
      )
      return {
        decision: "Pass",
        icon: iconForDecision("Pass"),
        score: enforceScoreBand("Pass", 45),
        bullets,
        risk_flags: [],
        next_step: buildNextStep("Pass"),
        location_constraint: "unclear",
        logic_version: JOBFIT_LOGIC_VERSION,
      }
    }
  }

  // 4) HARD REQUIREMENTS => PASS (explicit only)
  const reqs = detectHardRequirements(jobText)
  const missingReqs = reqs.filter((r) => !profileMentionsRequirement(profileText, r))
  if (missingReqs.length > 0) {
    const bullets = uniqTop(
      [
        "This role has explicit hard requirements that are not visible in your profile.",
        ...missingReqs.map((r) => r.label),
        buildVisibilityBullet(),
      ],
      8
    )
    return {
      decision: "Pass",
      icon: iconForDecision("Pass"),
      score: enforceScoreBand("Pass", 45),
      bullets,
      risk_flags: [],
      next_step: buildNextStep("Pass"),
      location_constraint: "unclear",
      logic_version: JOBFIT_LOGIC_VERSION,
    }
  }

  // 5) ALIGNMENT + PROOF
  const { level: alignmentLevel } = inferAlignmentLevel(profileText, primaryFunction)
  const { depth, label: depthLabel } = computeDepthScore(profileText, seniority)

  if (alignmentLevel === "none") {
    const bullets = uniqTop(
      ["No role-relevant alignment is visible for this job’s function.", buildVisibilityBullet()],
      8
    )
    return {
      decision: "Pass",
      icon: iconForDecision("Pass"),
      score: enforceScoreBand("Pass", 45),
      bullets,
      risk_flags: [],
      next_step: buildNextStep("Pass"),
      location_constraint: "unclear",
      logic_version: JOBFIT_LOGIC_VERSION,
    }
  }

  // Aggressive ceilings
  if (alignmentLevel === "weak_adjacent") ceilings.push("cap_review")
  if (depthLabel === "weak" && seniority !== "internship") ceilings.push("cap_review")

  // Experience ceiling: explicit 2+ years + recent grad => cap at Review
  const minYears = extractMinYearsRequired(jobText)
  const recentGrad = isRecentGrad(profileText, ps)
  if (minYears !== null && minYears >= 2 && recentGrad) {
    ceilings.push("cap_review")
    riskCodes.push("experience_gap")
    riskCodes.push("seniority_mismatch")
  }

  const pedigreeStrong = schoolTier === "S" || schoolTier === "A"
  const gpaStrong = gpaBand === "3.8_plus"
  const gpaCompetitive = gpaBand === "3.8_plus" || gpaBand === "3.5_3.79"

  // Signals (proof points)
  const jobSignals = extractJobSignals(jobText)
  const profSignals = extractProfileSignals(profileText)
  const overlap = overlapSignals(jobSignals, profSignals)
  const overlapN = overlapCount(jobSignals, profSignals)

  // 6) DECISION (strict)
  let decision: Decision = "Review"
  const depthStrong = depthLabel === "strong"
  const depthOk = depthLabel === "strong" || depthLabel === "moderate"

  const isTier1 = employerTier === 1
  const isTier2 = employerTier === 2

  if (alignmentLevel === "direct") {
    if (isTier1) {
      if (overlapN >= 2 && depthStrong && (pedigreeStrong || gpaStrong)) decision = "Priority Apply"
      else if (overlapN >= 1 && depthOk && (pedigreeStrong || gpaStrong)) decision = "Apply"
      else decision = "Review"
    } else if (isTier2) {
      if (overlapN >= 2 && depthOk) decision = "Priority Apply"
      else if (overlapN >= 1 && depthOk) decision = "Apply"
      else decision = "Review"
    } else {
      if (overlapN >= 2 && depthOk) decision = "Priority Apply"
      else if (overlapN >= 1) decision = "Apply"
      else decision = "Review"
    }

    // Internship carveout
    if (seniority === "internship" && decision === "Review" && overlapN >= 1) decision = "Apply"
  } else if (alignmentLevel === "strong_adjacent") {
    if (isTier1) {
      if (overlapN >= 2 && depthStrong && pedigreeStrong && gpaStrong) decision = "Apply"
      else decision = "Review"
    } else if (isTier2) {
      if (overlapN >= 2 && depthStrong && gpaCompetitive) decision = "Apply"
      else decision = "Review"
    } else {
      if (overlapN >= 2 && depthStrong) decision = "Apply"
      else decision = "Review"
    }
  } else {
    decision = "Review"
  }

  decision = applyCeilings(decision, ceilings)

  // 7) RISKS (decision-aware)
  if (jobFacts.isContract) riskCodes.push("contract_role")
  if (jobFacts.isHourly) riskCodes.push("hourly_role")
  if (jobFacts.isFullyRemote) riskCodes.push("fully_remote_role")

  if (targetAlignment === "off_target") riskCodes.push("off_target_role")
  if (targetAlignment === "unclear") riskCodes.push("targets_unclear")

  if (alignmentLevel === "strong_adjacent") riskCodes.push("strong_adjacent_alignment")
  if (alignmentLevel === "weak_adjacent") riskCodes.push("weak_alignment")

  if (employerTier === 1) riskCodes.push("tier1_competition")
  if (employerTier === 2) riskCodes.push("tier2_competition")

  if ((employerTier === 1 || employerTier === 2) && !pedigreeStrong) riskCodes.push("pedigree_gap")

  if (shouldShowGpaRisk(employerTier, gpaBand)) {
    if (gpaBand === "below_3.5") riskCodes.push("gpa_risk_below_3_5")
    if (gpaBand === "3.5_3.79" && employerTier === 1) riskCodes.push("gpa_risk_below_3_8")
  }

  if (shouldSurfaceDepthRisk({ decision, employerTier, depthLabel, alignmentLevel })) {
    riskCodes.push("depth_limited")
  }

  const risk_flags = toUserRiskFlags(uniqTop(riskCodes, 12) as RiskCode[])

  // 8) WHY bullets (4–6, interview-ready, no depth leakage)
  const bullets: string[] = []

  const jobSigText = uniqTop(signalLabels(jobSignals, 4).map(cleanSignalLabel), 4)
  const overlapText = uniqTop(signalLabels(overlap, 4).map(cleanSignalLabel), 4)
  const profSigText = uniqTop(signalLabels(profSignals, 6).map(cleanSignalLabel), 6)

  if (overlapText.length > 0) {
    bullets.push(`Your ${joinWithAnd(overlapText).toLowerCase()} maps to what this role is asking you to do.`)
  } else if (jobSigText.length > 0) {
    bullets.push(`This role leans heavily on ${joinWithAnd(jobSigText).toLowerCase()}. Your materials need clearer proof.`)
  } else {
    bullets.push("Decision is based on visible function fit and competitiveness signals.")
  }

  const extraProof = profSigText.filter((x) => !new Set(overlapText).has(x)).slice(0, 2)
  if (extraProof.length > 0) {
    bullets.push(`You also bring ${joinWithAnd(extraProof).toLowerCase()}, which supports your ability to ramp quickly.`)
  }

  if (shouldAddPedigreeBullet({ employerTier, schoolTier, decision })) {
    bullets.push("Your Tier 1 school strengthens your competitiveness for this role.")
  }

  if (minYears !== null && minYears >= 2 && recentGrad) {
    bullets.push("This job is asking for experienced ownership. Treat this as a reach unless your resume bullets prove equivalent work.")
  }

  if (decision === "Priority Apply") bullets.push("This is a priority apply. Move fast, then immediately network after submitting.")
  if (decision === "Apply") bullets.push("This is a smart apply. Submit clean materials, then shift to targeted networking.")
  if (decision === "Review") bullets.push("This is not a clean yes. Only apply if you are willing to tighten proof and accept the risks.")

  if (decision === "Review" || decision === "Pass") bullets.push(buildVisibilityBullet())

  const finalBullets = uniqTop(bullets, 8)

  // 9) SCORE (banded, slightly harsher)
  let scoreBase =
    decision === "Priority Apply" ? 90 :
    decision === "Apply" ? 76 :
    decision === "Review" ? 58 : 45

  if (alignmentLevel === "direct") scoreBase += 2
  if (alignmentLevel === "strong_adjacent") scoreBase += 0
  if (depthLabel === "strong") scoreBase += 2
  if (depthLabel === "weak") scoreBase -= 4
  if (employerTier === 1) scoreBase -= 3
  if (targetAlignment === "off_target") scoreBase -= 5
  if (overlapN === 0) scoreBase -= 6
  if (minYears !== null && minYears >= 2 && recentGrad) scoreBase -= 4
  if (constraints.prefFullTime && jobFacts.isContract && !constraints.hardNoContract) scoreBase -= 2
  if (constraints.hardNoFullyRemote && jobFacts.isFullyRemote) scoreBase -= 2

  const score = enforceScoreBand(decision, scoreBase)

  return {
    decision,
    icon: iconForDecision(decision),
    score,
    bullets: finalBullets,
    risk_flags,
    next_step: buildNextStep(decision),
    location_constraint: "unclear",
    logic_version: JOBFIT_LOGIC_VERSION,
    debug: {
      employer_tier: employerTier,
      school_tier: schoolTier,
      gpa_band: gpaBand,
      gpa,
      job_seniority: seniority,
      primary_function: primaryFunction,
      alignment_level: alignmentLevel,
      depth_score: depth,
      target_alignment: targetAlignment,
      ceilings,
      min_years_required: minYears,
      recent_grad: recentGrad,
      overlap_count: overlapN,
      risk_codes: uniqTop(riskCodes, 12),
      job_facts: jobFacts,
      job_signals: signalLabels(jobSignals, 12),
      profile_signals: signalLabels(profSignals, 12),
      overlap_signals: signalLabels(overlap, 12),
    },
  }
}
