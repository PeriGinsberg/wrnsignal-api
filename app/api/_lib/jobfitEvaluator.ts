// app/api/_lib/jobfitEvaluator.ts
// Deterministic JobFit rules engine (no LLM decisioning)
// - Decision-first (Priority Apply / Apply / Review / Pass)
// - No job quotes in bullets
// - No visa/work auth, driver's license, or other minimal qualifier risks
// - Uses profileStructured when present (no new user inputs)
// - Human-readable risk flags only (no internal tokens)
// - Slightly aggressive: if you can't stand up to it, it's Review/Pass, not Apply

type Decision = "Priority Apply" | "Apply" | "Review" | "Pass"
type LocationConstraint = "constrained" | "not_constrained" | "unclear"
type YM = { year: number; month: number } // month 1-12

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

type EmployerTier = 1 | 2 | 3 | 4
type SchoolTier = "S" | "A" | "B" | "C" | "unknown"
type GpaBand = "3.8_plus" | "3.5_3.79" | "below_3.5" | "unknown"

type JobSeniority = "internship" | "entry" | "early_career" | "experienced" | "unknown"

type JobFunction =
  | "investment_banking_pe_mna"
  | "consulting_strategy"
  | "finance_accounting"
  | "commercial_real_estate"
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

type AlignmentLevel = "direct" | "strong_adjacent" | "weak_adjacent" | "none"
type TargetAlignment = "on_target" | "off_target" | "unclear"

const JOBFIT_LOGIC_VERSION = "rules_v1_2026_02_19"

// ----------------------- basics -----------------------

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
  for (const x of items) {
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

// ----------------------- extract job facts -----------------------

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

  const isFullyRemote = /\bfully remote|100% remote|remote only|work from home\b/.test(t0)

  return { isHourly, hourlyEvidence, isContract, contractEvidence, isFullyRemote }
}

function inferJobSeniority(jobText: string): JobSeniority {
  const t = normalizeText(jobText)
  if (/\b(intern|internship|summer analyst|co-op|co op)\b/.test(t)) return "internship"
  if (/\b(0-?1|0-?2)\s+years\b/.test(t) || /\b(entry level|new grad|graduate program)\b/.test(t)) return "entry"
  if (/\b(1-?3|2-?4)\s+years\b/.test(t)) return "early_career"
  if (/\b(3\+|4\+|5\+)\s+years\b/.test(t) || /\bminimum\s+(3|4|5)\s+years\b/.test(t)) return "experienced"
  return "unknown"
}

function inferEmployerTier(jobText: string): EmployerTier {
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

function inferJobFunction(jobText: string): JobFunction {
  const t = normalizeText(jobText)

  if (/\b(investment banking|private equity|m&a|mergers|acquisitions|lbo|leveraged buyout|capital markets)\b/.test(t))
    return "investment_banking_pe_mna"

  if (/\b(management consulting|strategy consulting|consultant|case interview|client engagements?)\b/.test(t))
    return "consulting_strategy"

  if (/\b(commercial real estate|cre\b|multifamily|industrial|office leasing|real estate underwriting|dscr|noi|cap rate)\b/.test(t))
    return "commercial_real_estate"

  if (/\b(accounting|accountant|ar\b|ap\b|general ledger|reconciliation|financial statements|cpa)\b/.test(t))
    return "finance_accounting"

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

  if (/\b(research|research assistant|lab\b|publication|literature review|irb\b)\b/.test(t))
    return "research"

  if (/\b(clinical|patient|medical device|emt\b|paramedic|nurse|rn\b|physician|therapy|pt\b|occupational)\b/.test(t))
    return "clinical_health"

  return "unknown"
}

// ----------------------- job signals (no quotes) -----------------------

type SignalKey =
  | "modeling"
  | "underwriting"
  | "presentations"
  | "excel"
  | "sql"
  | "paid_media"
  | "ops"
  | "research"
  | "sales"
  | "fin_statements"

type Signal = { key: SignalKey; label: string }

function extractJobSignals(jobText: string): Signal[] {
  const t = normalizeText(jobText)

  const signals: Array<[RegExp, Signal]> = [
    [/\bfinancial modeling|valuation|dcf|lbo\b/, { key: "modeling", label: "Financial modeling and valuation" }],
    [/\bund(er)?writing|credit memo|credit\b|loan\b/, { key: "underwriting", label: "Underwriting or credit work" }],
    [/\bclient|stakeholder|presentation|deck|powerpoint\b/, { key: "presentations", label: "Stakeholder communication and presentations" }],
    [/\bexcel\b/, { key: "excel", label: "Heavy Excel execution" }],
    [/\bsql\b/, { key: "sql", label: "SQL-based analysis" }],
    [/\bfinancial statements|balance sheet|income statement|cash flow\b/, { key: "fin_statements", label: "Financial statement work" }],
    [/\bresearch|literature review|irb|lab\b/, { key: "research", label: "Research-heavy responsibilities" }],
    [/\boperations|process improvement|workflow\b/, { key: "ops", label: "Operational execution and process improvement" }],
    [/\bcold call|quota|pipeline|crm\b/, { key: "sales", label: "Outbound sales execution" }],
    [/\bmeta ads|google ads|paid media|roas\b/, { key: "paid_media", label: "Performance marketing execution" }],
  ]

  const out: Signal[] = []
  for (const [re, sig] of signals) {
    if (re.test(t)) out.push(sig)
    if (out.length >= 3) break
  }
  return out
}


// ----------------------- profile constraints -----------------------

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
    (t0.includes("do not want") && t0.includes("fully remote")) ||
    (t0.includes("d o n o t want") && t0.includes("fully remote"))

  return { hardNoHourlyPay, prefFullTime, hardNoContract, hardNoSales, hardNoGovernment, hardNoFullyRemote }
}

// ----------------------- structured profile readers -----------------------

function readSchoolTier(profileStructured: any): SchoolTier {
  const ps = safeObj(profileStructured)
  const raw = String(ps.school_tier || ps.profile?.school_tier || "").trim().toUpperCase()
  if (raw === "S" || raw === "A" || raw === "B" || raw === "C") return raw
  return "unknown"
}

function readGpaBand(profileStructured: any): GpaBand {
  const ps = safeObj(profileStructured)
  const raw = String(ps.gpa_band || ps.profile?.gpa_band || "").trim().toLowerCase()
  if (raw === "3.8_plus" || raw === "3.5_3.79" || raw === "below_3.5") return raw
  return "unknown"
}

function readGpa(profileStructured: any): number | null {
  const ps = safeObj(profileStructured)
  const g = Number(ps.gpa || ps.profile?.gpa)
  return Number.isFinite(g) ? g : null
}

function readTargets(profileStructured: any, profileText: string): string[] {
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
  if (t.includes("marketing")) hits.push("marketing")
  if (t.includes("sales")) hits.push("sales")
  if (t.includes("finance")) hits.push("finance")
  if (t.includes("product")) hits.push("product")
  if (t.includes("operations")) hits.push("operations")
  if (t.includes("customer success")) hits.push("customer success")
  if (t.includes("government")) hits.push("government")
  return uniqTop(hits, 12)
}

function mapTargetsToFunctions(targets: string[]): JobFunction[] {
  const t = targets.map((x) => normalizeText(x))
  const out: JobFunction[] = []

  for (const s of t) {
    if (/\b(investment banking|private equity|m&a|ib\b|pe\b)\b/.test(s)) out.push("investment_banking_pe_mna")
    else if (/\b(consulting|strategy)\b/.test(s)) out.push("consulting_strategy")
    else if (/\b(commercial real estate|real estate)\b/.test(s)) out.push("commercial_real_estate")
    else if (/\b(accounting|finance)\b/.test(s)) out.push("finance_accounting")
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

// ----------------------- eligibility (graduation window) -----------------------

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

function extractCandidateGrad(profileText: string, profileStructured: any): YM | null {
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

// ----------------------- suppress noisy risks -----------------------

function suppressRiskText(s0: string) {
  const s = normalizeText(s0)

  if (s.includes("visa") || s.includes("work authorization") || s.includes("sponsorship")) return true
  if (s.includes("authorized to work") || s.includes("employment authorization")) return true

  if (s.includes("driver") && s.includes("license")) return true
  if (s.includes("background check") || s.includes("drug test")) return true
  if (s.includes("valid license") && s.includes("driver")) return true

  if (
    s.includes("not stated") ||
    s.includes("not specified") ||
    s.includes("not mentioned") ||
    s.includes("unclear from the job")
  ) return true

  return false
}

// ----------------------- hard requirements gate (explicit only) -----------------------

type RequirementHit = { key: string; label: string }

function detectHardRequirements(jobText: string): RequirementHit[] {
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

  for (const [re, hit] of patterns) {
    if (re.test(t)) reqs.push(hit)
  }

  const seen = new Set<string>()
  const out: RequirementHit[] = []
  for (const r of reqs) {
    if (seen.has(r.key)) continue
    seen.add(r.key)
    out.push(r)
  }
  return out.slice(0, 10)
}

function profileMentionsRequirement(profileText: string, req: RequirementHit) {
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

// ----------------------- alignment + depth -----------------------

const DIRECT_KEYWORDS: Record<JobFunction, RegExp[]> = {
  investment_banking_pe_mna: [/\b(investment banking|ib\b|m&a|mergers|acquisitions|lbo|leveraged buyout|pitchbook|financial modeling|valuation|dcf)\b/],
  consulting_strategy: [/\b(consulting|consultant|case interview|workstream|deck|analysis|client deliverables)\b/],
  finance_accounting: [/\b(financial analysis|fp&a|budget|forecast|accounting|reconciliation|general ledger|journal entries|ar\b|ap\b)\b/],
  commercial_real_estate: [/\b(commercial real estate|real estate underwriting|noi|cap rate|dscr|multifamily|industrial|office|leasing)\b/],
  sales: [/\b(sales|business development|quota|pipeline|crm\b|lead gen|cold call|outbound|closing)\b/],
  marketing_analytics: [/\b(sql\b|google analytics|roas|attribution|a\/b test|performance marketing|campaign performance|meta ads|google ads)\b/],
  brand_marketing: [/\b(brand|content|social media|creative strategy|communications|copywriting|storytelling)\b/],
  product_program_ops: [/\b(program management|project management|operations|process improvement|roadmap|requirements|stakeholders?)\b/],
  customer_success: [/\b(customer success|client success|onboarding|implementation|account management|retention)\b/],
  government_public: [/\b(government|public sector|municipal|state agency|federal)\b/],
  software_data: [/\b(software|engineer|developer|typescript|javascript|python\b|api\b|database|sql\b|data pipeline|machine learning)\b/],
  research: [/\b(research|lab\b|irb\b|publication|literature review|data collection|analysis)\b/],
  clinical_health: [/\b(emt\b|patient|clinical|medical device|therapy|rn\b|hospital)\b/],
  unknown: [],
}

const STRONG_ADJACENCY: Record<JobFunction, JobFunction[]> = {
  investment_banking_pe_mna: ["finance_accounting", "commercial_real_estate", "consulting_strategy"],
  consulting_strategy: ["product_program_ops", "finance_accounting", "marketing_analytics"],
  finance_accounting: ["investment_banking_pe_mna", "commercial_real_estate", "product_program_ops"],
  commercial_real_estate: ["finance_accounting", "investment_banking_pe_mna"],
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
  for (const re of patterns) {
    if (re.test(t)) hits += 1
  }
  return hits
}

function inferAlignmentLevel(profileText: string, primary: JobFunction): {
  level: AlignmentLevel
  evidenceScore: number
} {
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

function computeDepthScore(profileText: string, seniority: JobSeniority): { depth: number; label: "strong" | "moderate" | "weak" } {
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

function inferTargetAlignment(primary: JobFunction, targets: JobFunction[]): TargetAlignment {
  if (!targets || targets.length === 0) return "unclear"
  if (targets.includes(primary)) return "on_target"
  return "off_target"
}

// ----------------------- risk labels (no internal tokens) -----------------------

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
      return "Depth is light for what this role expects. If you have stronger proof, it is not showing clearly."
    case "targets_unclear":
      return "Your targets are unclear, so this decision is based purely on visible fit signals."
  }
}

function toUserRiskFlags(codes: RiskCode[]) {
  const out: string[] = []
  for (const code of codes) {
    const label = riskLabel(code)
    if (label && !suppressRiskText(label)) out.push(label)
  }
  return uniqTop(out, 6)
}

// ----------------------- hard exclusions + ceilings -----------------------

function isHardExclusionPass(
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

type Ceiling = "cap_review"

function applyCeilings(decision: Decision, ceilings: Ceiling[]): Decision {
  if (ceilings.includes("cap_review")) {
    if (decision === "Priority Apply" || decision === "Apply") return "Review"
  }
  return decision
}

// ----------------------- next step copy -----------------------

function buildNextStep(decision: Decision) {
  if (decision === "Pass") return "Do not apply."
  if (decision === "Review") return "Only apply if you accept the risks."
  if (decision === "Apply") return "Apply. Then move to networking."
  return "Priority apply. Then move to networking."
}

function buildVisibilityBullet() {
  return "SIGNAL evaluates what is visible. If you have the experience but it is not clearly shown, the market will treat it as missing."
}

// GPA risk rules (your spec)
function shouldShowGpaRisk(employerTier: EmployerTier, gpaBand: GpaBand) {
  if (gpaBand === "unknown") return false
  if (employerTier === 1) return true
  if (employerTier === 2) return gpaBand === "below_3.5"
  return false
}

// Depth risk rules (fixed: decision exists before calling)
function shouldSurfaceDepthRisk(params: {
  decision: Decision
  employerTier: EmployerTier
  depthLabel: "strong" | "moderate" | "weak"
  alignmentLevel: AlignmentLevel
}) {
  const { decision, employerTier, depthLabel, alignmentLevel } = params

  if (depthLabel === "weak") return true
  if (employerTier === 1 && depthLabel === "moderate" && alignmentLevel !== "direct") return true
  if ((decision === "Apply" || decision === "Priority Apply") && employerTier >= 2 && depthLabel === "moderate") return false

  return false
}

// ----------------------- profile signals -----------------------

function extractProfileSignals(profileText: string): Signal[] {
  const t = normalizeText(profileText)

  const signals: Array<[RegExp, Signal]> = [
    [/\bfinancial modeling|valuation|dcf|lbo\b/, { key: "modeling", label: "Financial modeling and valuation" }],
    [/\bund(er)?writing|credit memo|credit\b|loan\b/, { key: "underwriting", label: "Underwriting or credit exposure" }],
    [/\bclient|stakeholder|presentation|deck|powerpoint\b/, { key: "presentations", label: "Stakeholder communication and presentations" }],
    [/\bexcel\b/, { key: "excel", label: "Excel execution" }],
    [/\bsql\b/, { key: "sql", label: "SQL-based analysis" }],
    [/\bfinancial statements|balance sheet|income statement|cash flow\b/, { key: "fin_statements", label: "Financial statement work" }],
    [/\bresearch|literature review|irb|lab\b/, { key: "research", label: "Research experience" }],
    [/\boperations|process improvement|workflow\b/, { key: "ops", label: "Operations/process work" }],
    [/\bcold call|quota|pipeline|crm\b|salesforce\b/, { key: "sales", label: "Sales/CRM execution" }],
    [/\bmeta ads|google ads|paid media|roas\b/, { key: "paid_media", label: "Performance marketing execution" }],
  ]

  const out: Signal[] = []
  for (const [re, sig] of signals) {
    if (re.test(t)) out.push(sig)
    if (out.length >= 4) break
  }
  return out
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
}) {
  const ps = safeObj(profileStructured)

  const jobFacts = extractJobFacts(jobText)
  const constraints = extractProfileConstraints(profileText)

  const employerTier: EmployerTier =
    (Number(ps.employer_tier) as any) ||
    (Number(ps.job_meta?.employer_tier) as any) ||
    inferEmployerTier(jobText)

  const schoolTier = readSchoolTier(ps)
  const gpaBand = readGpaBand(ps)
  const gpa = readGpa(ps)

  const seniority = inferJobSeniority(jobText)
  const primaryFunction = inferJobFunction(jobText)

  const rawTargets = readTargets(ps, profileText)
  const targetFunctions = mapTargetsToFunctions(rawTargets)
  const targetAlignment = inferTargetAlignment(primaryFunction, targetFunctions)

  const ceilings: Ceiling[] = []

  // 1) HARD EXCLUSIONS => PASS
  const hard = isHardExclusionPass(constraints, jobFacts, primaryFunction)
  if (hard.pass) {
    const bullets = uniqTop([hard.reason || "Role conflicts with an explicit hard exclusion.", buildVisibilityBullet()], 6)
    return {
      decision: "Pass" as Decision,
      icon: iconForDecision("Pass"),
      score: enforceScoreBand("Pass", 45),
      bullets,
      risk_flags: [],
      next_step: buildNextStep("Pass"),
      location_constraint: "unclear" as LocationConstraint,
      logic_version: JOBFIT_LOGIC_VERSION,
    }
  }

  // 2) CEILINGS (do not auto-pass)
  if (constraints.hardNoFullyRemote && jobFacts.isFullyRemote) ceilings.push("cap_review")
  if (constraints.prefFullTime && jobFacts.isContract && !constraints.hardNoContract) ceilings.push("cap_review")
  if (targetAlignment === "off_target") ceilings.push("cap_review")

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
        6
      )
      return {
        decision: "Pass" as Decision,
        icon: iconForDecision("Pass"),
        score: enforceScoreBand("Pass", 45),
        bullets,
        risk_flags: [],
        next_step: buildNextStep("Pass"),
        location_constraint: "unclear" as LocationConstraint,
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
      6
    )
    return {
      decision: "Pass" as Decision,
      icon: iconForDecision("Pass"),
      score: enforceScoreBand("Pass", 45),
      bullets,
      risk_flags: [],
      next_step: buildNextStep("Pass"),
      location_constraint: "unclear" as LocationConstraint,
      logic_version: JOBFIT_LOGIC_VERSION,
    }
  }

  // 5) ALIGNMENT + DEPTH
  const { level: alignmentLevel } = inferAlignmentLevel(profileText, primaryFunction)
  const { depth, label: depthLabel } = computeDepthScore(profileText, seniority)

  // Absolute mismatch => PASS
  if (alignmentLevel === "none") {
    const bullets = uniqTop(
      [
        "No role-relevant alignment is visible for this job’s function.",
        buildVisibilityBullet(),
      ],
      6
    )
    return {
      decision: "Pass" as Decision,
      icon: iconForDecision("Pass"),
      score: enforceScoreBand("Pass", 45),
      bullets,
      risk_flags: [],
      next_step: buildNextStep("Pass"),
      location_constraint: "unclear" as LocationConstraint,
      logic_version: JOBFIT_LOGIC_VERSION,
    }
  }

  // Aggressive cap: weak depth (non-internship) cannot be Apply/Priority
  if (depthLabel === "weak" && seniority !== "internship") ceilings.push("cap_review")
  // Weak adjacent: cannot be clean Apply
  if (alignmentLevel === "weak_adjacent") ceilings.push("cap_review")

  // Pedigree / GPA flags (not hard gates)
  const pedigreeStrong = schoolTier === "S" || schoolTier === "A"
  const gpaStrong = gpaBand === "3.8_plus"
  const gpaCompetitive = gpaBand === "3.8_plus" || gpaBand === "3.5_3.79"

  // 6) DECISION (deterministic)
  let decision: Decision = "Review"

  const depthStrong = depthLabel === "strong"
  const depthModerateOrBetter = depthLabel === "strong" || depthLabel === "moderate"

  if (alignmentLevel === "direct") {
    if (employerTier === 1) {
      if (depthStrong && (pedigreeStrong || gpaStrong)) decision = "Priority Apply"
      else if (depthModerateOrBetter && (pedigreeStrong || gpaStrong)) decision = "Apply"
      else decision = "Review"
    } else if (employerTier === 2) {
      if (depthStrong) decision = "Priority Apply"
      else if (depthModerateOrBetter) decision = "Apply"
      else decision = "Review"
    } else {
      if (depthStrong) decision = "Priority Apply"
      else if (depthModerateOrBetter) decision = "Apply"
      else decision = "Review"
    }

    // Internship carveout: don't auto-kill first-job candidates
    if (seniority === "internship" && decision === "Review" && depthModerateOrBetter) decision = "Apply"
  } else if (alignmentLevel === "strong_adjacent") {
    if (employerTier === 1) {
      // Adjacent never becomes Priority Apply
      if (depthStrong && pedigreeStrong && gpaStrong) decision = "Apply"
      else decision = "Review"
    } else if (employerTier === 2) {
      if (depthStrong && gpaCompetitive) decision = "Apply"
      else decision = "Review"
    } else {
      decision = "Review"
      if (seniority === "internship" && depthStrong) decision = "Apply"
    }
  } else {
    decision = "Review"
  }

  // Apply ceilings last
  decision = applyCeilings(decision, ceilings)

  // 7) RISKS (decision-aware)
  const riskCodes: RiskCode[] = []

  if (jobFacts.isContract) riskCodes.push("contract_role")
  if (jobFacts.isHourly) riskCodes.push("hourly_role")
  if (jobFacts.isFullyRemote) riskCodes.push("fully_remote_role")

  if (targetAlignment === "off_target") riskCodes.push("off_target_role")
  if (targetAlignment === "unclear") riskCodes.push("targets_unclear")

  if (alignmentLevel === "strong_adjacent") riskCodes.push("strong_adjacent_alignment")
  if (alignmentLevel === "weak_adjacent") riskCodes.push("weak_alignment")

  if (employerTier === 1) riskCodes.push("tier1_competition")
  if (employerTier === 2) riskCodes.push("tier2_competition")

  // Pedigree risk (Tier 1/2 only)
  if ((employerTier === 1 || employerTier === 2) && !pedigreeStrong) riskCodes.push("pedigree_gap")

  // GPA risk visibility rules
  if (shouldShowGpaRisk(employerTier, gpaBand)) {
    if (gpaBand === "below_3.5") riskCodes.push("gpa_risk_below_3_5")
    if (gpaBand === "3.5_3.79" && employerTier === 1) riskCodes.push("gpa_risk_below_3_8")
  }

  // Depth risk (only when it threatens outcome)
  if (shouldSurfaceDepthRisk({ decision, employerTier, depthLabel, alignmentLevel })) {
    riskCodes.push("depth_limited")
  }

  const risk_flags = toUserRiskFlags(uniqTop(riskCodes, 10) as RiskCode[])

  // 8) BULLETS (strengths only, no contradictions)
  const bullets: string[] = []
  const jobSignals = extractJobSignals(jobText)
  const profSignals = extractProfileSignals(profileText)

  // What the job is
  if (jobSignals.length > 0) bullets.push(`This role centers on: ${jobSignals.join(", ")}.`)
  else bullets.push("This role is broad. Decision is based on visible function fit and competitiveness signals.")

  // Strongest visible match
  if (jobSignals.length > 0 && profSignals.length > 0) {
   function overlapSignals(job: Signal[], prof: Signal[]) {
  const profKeys = new Set(prof.map((s) => s.key))
  return job.filter((s) => profKeys.has(s.key))
}

// --- inside runJobFit() where you build bullets ---
const bullets: string[] = []
const jobSignals = extractJobSignals(jobText)
const profSignals = extractProfileSignals(profileText)
const overlap = overlapSignals(jobSignals, profSignals)

// 1) What the job is
if (jobSignals.length > 0) {
  bullets.push(`This role centers on: ${jobSignals.map((s) => s.label).join(", ")}.`)
} else {
  bullets.push("This role is broad. Decision is based on visible function fit and competitiveness signals.")
}

// 2) Proof (ONLY when overlap exists)
if (overlap.length > 0) {
  bullets.push(`Visible proof of fit: ${overlap.map((s) => s.label).slice(0, 2).join(" + ")}.`)
} else if (alignmentLevel === "direct") {
  bullets.push("Function fit looks right, but the proof is not specific in what is currently visible.")
} else if (alignmentLevel === "strong_adjacent") {
  bullets.push("Your background is adjacent. You are plausible, but you are not the obvious pick.")
} else {
  bullets.push("You have transferable signals, but fit is not clearly demonstrated.")
}

// 3) Depth
if (depthLabel === "strong") bullets.push("Depth is strong. You have multiple credible signals backing the fit.")
else if (depthLabel === "moderate") bullets.push("Depth is moderate. You have enough proof to justify a shot, but this is not a lock.")
else bullets.push("Depth is limited. You may be screened out unless your proof is stronger than what is currently visible.")

// 4) Apply momentum
if (decision === "Priority Apply") bullets.push("This is worth prioritizing. Move quickly.")
if (decision === "Apply") bullets.push("This is worth applying to based on visible fit.")

// 5) Visibility reminder only for Review/Pass
if (decision === "Review" || decision === "Pass") bullets.push(buildPassVisibilityBullet())

const finalBullets = uniqTop(bullets, 6)

  } else if (alignmentLevel === "direct") {
    bullets.push("Your profile shows clear fit for what this job does.")
  } else if (alignmentLevel === "strong_adjacent") {
    bullets.push("Your background is adjacent. You are plausible, but you are not the obvious pick.")
  } else {
    bullets.push("You have transferable signals, but fit is not clearly demonstrated.")
  }

  // Credibility / reps (as a strength statement)
  if (depthLabel === "strong") bullets.push("Depth is strong. You have multiple credible signals backing the fit.")
  else if (depthLabel === "moderate") bullets.push("Depth is moderate. You have enough proof to justify a shot, but this is not a lock.")
  else bullets.push("Depth is limited. You may be screened out unless your proof is stronger than what is currently visible.")

  // Action-oriented (only for Apply/Priority)
  if (decision === "Priority Apply") bullets.push("This is worth prioritizing. Move quickly.")
  if (decision === "Apply") bullets.push("This is worth applying to based on visible fit.")

  // Visibility reminder: only on Review/Pass
  if (decision === "Review" || decision === "Pass") bullets.push(buildVisibilityBullet())

  const finalBullets = uniqTop(bullets, 6)

  // 9) SCORE (deterministic)
  let scoreBase =
    decision === "Priority Apply" ? 90 :
    decision === "Apply" ? 78 :
    decision === "Review" ? 60 : 45

  if (alignmentLevel === "direct") scoreBase += 3
  if (alignmentLevel === "strong_adjacent") scoreBase += 1
  if (depthLabel === "strong") scoreBase += 3
  if (depthLabel === "weak") scoreBase -= 3
  if (employerTier === 1) scoreBase -= 2
  if (targetAlignment === "off_target") scoreBase -= 4
  if (constraints.prefFullTime && jobFacts.isContract && !constraints.hardNoContract) scoreBase -= 2
  if (constraints.hardNoFullyRemote && jobFacts.isFullyRemote) scoreBase -= 2
  if ((employerTier === 1 || employerTier === 2) && !pedigreeStrong) scoreBase -= 1

  const score = enforceScoreBand(decision, scoreBase)

  return {
    decision,
    icon: iconForDecision(decision),
    score,
    bullets: finalBullets,
    risk_flags,
    next_step: buildNextStep(decision),
    location_constraint: "unclear" as LocationConstraint,
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
      risk_codes: uniqTop(riskCodes, 12),
    },
  }
}
