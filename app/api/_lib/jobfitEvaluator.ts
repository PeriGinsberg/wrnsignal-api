// app/api/_lib/jobfitEvaluator.ts
// Deterministic JobFit rules engine (no LLM decisioning)
// - Decision-first (Priority Apply / Apply / Review / Pass)
// - No job quotes in bullets
// - Suppresses visa/work auth + driver's license + other minimal qualifiers
// - Uses profileStructured when present (no new user inputs)

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
  // Deterministic heuristic fallback. Real tiering should come from your internal mapping table later.
  const t = normalizeText(jobText)

  const tier1Signals = [
    /\binvestment banking\b/,
    /\bprivate equity\b/,
    /\bm&a\b/,
    /\bmergers\b/,
    /\bleveraged finance\b/,
    /\blbo\b/,
    /\bmanagement consulting\b/,
    /\bstrateg(y|ic)\s+consult(ing|ant)\b/,
    /\bgoldman\b|\bmorgan stanley\b|\bjpmorgan\b|\bciti\b|\bbofa\b|\bbarclays\b|\bcredit suisse\b|\bevercore\b|\blazard\b|\bcenterview\b/,
    /\bmckinsey\b|\bbain\b|\bbcg\b|\bdeloitte consulting\b|\bstrategy&\b/,
  ]

  const tier2Signals = [
    /\brotational\b/,
    /\bleadership development\b/,
    /\bfortunes?\s*500\b/,
    /\bformal training\b/,
    /\bnew grad program\b/,
    /\baccelerated development\b/,
  ]

  if (tier1Signals.some((r) => r.test(t))) return 1
  if (tier2Signals.some((r) => r.test(t))) return 2

  // Default: most roles are Tier 3 unless you explicitly classify later
  return 3
}

function inferJobFunction(jobText: string): JobFunction {
  const t = normalizeText(jobText)

  if (/\b(investment banking|private equity|m&a|mergers|acquisitions|lbo|leveraged finance|capital markets)\b/.test(t))
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

// ----------------------- structured profile helpers -----------------------

function safeObj(x: any) {
  return x && typeof x === "object" ? x : {}
}

function readSchoolTier(profileStructured: any): SchoolTier {
  const ps = safeObj(profileStructured)
  const raw = String(ps.school_tier || "").trim().toUpperCase()
  if (raw === "S" || raw === "A" || raw === "B" || raw === "C") return raw
  return "unknown"
}

function readGpaBand(profileStructured: any): GpaBand {
  const ps = safeObj(profileStructured)
  const raw = String(ps.gpa_band || "").trim().toLowerCase()
  if (raw === "3.8_plus" || raw === "3.5_3.79" || raw === "below_3.5") return raw
  return "unknown"
}

function readGpa(profileStructured: any): number | null {
  const ps = safeObj(profileStructured)
  const g = Number(ps.gpa)
  return Number.isFinite(g) ? g : null
}

function readTargets(profileStructured: any, profileText: string): string[] {
  const ps = safeObj(profileStructured)
  const list = Array.isArray(ps.target_roles_list) ? ps.target_roles_list : []
  const fromStructured = list.map((x: any) => String(x || "").trim()).filter(Boolean)

  // Fallback: parse target roles from profile text if structured targets missing
  if (fromStructured.length > 0) return fromStructured.slice(0, 25)

  const t = normalizeText(profileText)
  const hits: string[] = []
  if (t.includes("investment banking")) hits.push("investment banking")
  if (t.includes("private equity")) hits.push("private equity")
  if (t.includes("consulting")) hits.push("consulting")
  if (t.includes("marketing")) hits.push("marketing")
  if (t.includes("sales")) hits.push("sales")
  if (t.includes("finance")) hits.push("finance")
  if (t.includes("commercial real estate")) hits.push("commercial real estate")
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
    if (/\b(investment banking|private equity|m&a|ib|pe)\b/.test(s)) out.push("investment_banking_pe_mna")
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

  return uniqTop(out, 12) as JobFunction[]
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
  const y = Number(ps.grad_year)
  const m = Number(ps.grad_month)
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

  // Visa/work auth: never show (assume authorized)
  if (s.includes("visa") || s.includes("work authorization") || s.includes("sponsorship")) return true
  if (s.includes("authorized to work") || s.includes("employment authorization")) return true

  // Driver's license / background check / generic minimal qualifiers: suppress
  if (s.includes("driver") && s.includes("license")) return true
  if (s.includes("background check") || s.includes("drug test")) return true
  if (s.includes("valid license") && s.includes("driver")) return true

  // "Not stated" / missing job info: suppress
  if (s.includes("not stated") || s.includes("not specified") || s.includes("not mentioned") || s.includes("unclear from the job"))
    return true

  return false
}
function extractJobSignals(jobText: string): string[] {
  const t = normalizeText(jobText)

  const signals: Array<[RegExp, string]> = [
    [/\bfinancial modeling|valuation|dcf|lbo\b/, "Financial modeling and valuation work"],
    [/\bclient|stakeholder|presentation|deck|powerpoint\b/, "Client-facing communication and presentation work"],
    [/\bexcel\b/, "Heavy Excel execution"],
    [/\bsql\b/, "SQL-based analysis"],
    [/\bgoogle analytics|ga4\b/, "Web analytics measurement work"],
    [/\bmeta ads|google ads|paid media|roas\b/, "Performance marketing execution"],
    [/\bproject management|program management|timeline|roadmap\b/, "Project/program management execution"],
    [/\boperations|process improvement|workflow\b/, "Operational execution and process improvement"],
    [/\bresearch|literature review|irb|lab\b/, "Research-heavy responsibilities"],
    [/\bcold call|quota|pipeline|crm\b/, "Outbound sales execution"],
  ]

  const out: string[] = []
  for (const [re, label] of signals) {
    if (re.test(t)) out.push(label)
    if (out.length >= 3) break
  }
  return out
}

// ----------------------- requirements gate (hard requirements only) -----------------------

type RequirementHit = { key: string; label: string }

function detectHardRequirements(jobText: string): RequirementHit[] {
  // Only flag truly hard constraints. Explicit only. Keep list tight.
  const t = normalizeText(jobText)

  const reqs: RequirementHit[] = []

  // IMPORTANT: Do NOT add visa or driver's license here.
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

  return uniqTop(reqs.map((r) => JSON.stringify(r)), 10).map((x) => JSON.parse(x))
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
  investment_banking_pe_mna: [
    /\b(investment banking|ib\b|m&a|mergers|acquisitions|lbo|leveraged buyout|pitchbook|financial modeling|valuation|dcf)\b/,
  ],
  consulting_strategy: [
    /\b(consulting|consultant|case interview|client deliverables|workstream|deck|powerpoint|analysis)\b/,
  ],
  finance_accounting: [
    /\b(financial analysis|fp&a|budget|forecast|accounting|reconciliation|general ledger|journal entries|ar\b|ap\b)\b/,
  ],
  commercial_real_estate: [
    /\b(commercial real estate|real estate underwriting|noi|cap rate|dscr|multifamily|industrial|office|leasing)\b/,
  ],
  sales: [
    /\b(sales|business development|quota|pipeline|crm\b|lead gen|cold call|outbound|clos(e|ing))\b/,
  ],
  marketing_analytics: [
    /\b(sql\b|google analytics|roas|attribution|a\/b test|performance marketing|campaign performance|meta ads|google ads)\b/,
  ],
  brand_marketing: [
    /\b(brand|content|social media|creative strategy|communications|copywriting|storytelling)\b/,
  ],
  product_program_ops: [
    /\b(program management|project management|operations|process improvement|roadmap|requirements|stakeholders?)\b/,
  ],
  customer_success: [
    /\b(customer success|client success|onboarding|implementation|account management|retention)\b/,
  ],
  government_public: [
    /\b(government|public sector|municipal|state agency|federal)\b/,
  ],
  software_data: [
    /\b(software|engineer|developer|typescript|javascript|python\b|api\b|database|sql\b|data pipeline|machine learning)\b/,
  ],
  research: [
    /\b(research|lab\b|irb\b|publication|literature review|data collection|analysis)\b/,
  ],
  clinical_health: [
    /\b(emt\b|patient|clinical|medical device|therapy|rn\b|hospital)\b/,
  ],
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

function inferAlignmentLevel(profileText: string, primary: JobFunction): { level: AlignmentLevel; evidenceScore: number; evidenceLabel: string } {
  if (primary === "unknown") {
    return { level: "weak_adjacent", evidenceScore: 0, evidenceLabel: "Role function unclear; alignment requires review." }
  }

  const directHits = countKeywordHits(profileText, DIRECT_KEYWORDS[primary] || [])
  if (directHits >= 1) {
    return { level: "direct", evidenceScore: 2 + directHits, evidenceLabel: "Direct alignment signals detected in profile." }
  }

  const strongAdj = STRONG_ADJACENCY[primary] || []
  let bestAdjHits = 0
  let bestAdj: JobFunction | null = null
  for (const adj of strongAdj) {
    const hits = countKeywordHits(profileText, DIRECT_KEYWORDS[adj] || [])
    if (hits > bestAdjHits) {
      bestAdjHits = hits
      bestAdj = adj
    }
  }

  if (bestAdjHits >= 1) {
    return { level: "strong_adjacent", evidenceScore: 1 + bestAdjHits, evidenceLabel: "Strong adjacent alignment signals detected in profile." }
  }

  // Weak adjacent: transferable general signals (leadership, projects, analysis)
  const t = normalizeText(profileText)
  const weakSignals =
    (t.includes("project") ? 1 : 0) +
    (t.includes("leadership") ? 1 : 0) +
    (t.includes("analysis") ? 1 : 0) +
    (t.includes("intern") ? 1 : 0)

  if (weakSignals >= 2) {
    return { level: "weak_adjacent", evidenceScore: 1, evidenceLabel: "Transferable signals exist but not clearly tied to the role function." }
  }

  return { level: "none", evidenceScore: 0, evidenceLabel: "No role-relevant alignment signals detected." }
}

function computeDepthScore(profileText: string, seniority: JobSeniority): { depth: number; label: "strong" | "moderate" | "weak" } {
  const t = normalizeText(profileText)

  // Allow stacking; internships can lean more on academics/projects/leadership.
  const hasIntern = /\b(intern|internship|co-op|co op)\b/.test(t) ? 2 : 0
  const hasWork = /\b(analyst|assistant|associate|coordinator|representative)\b/.test(t) ? 1 : 0
  const hasLeadership = /\b(president|vp|vice president|captain|lead|chair|founder)\b/.test(t) ? 1 : 0
  const hasProjects = /\b(project|case competition|capstone)\b/.test(t) ? 1 : 0
  const hasResearch = /\b(research|lab|irb|publication)\b/.test(t) ? 1 : 0

  // Academics signal (major/minor) often exists in profile text; count lightly.
  const hasAcademics = /\b(major|minor|b\.s\.|b\.a\.|gpa)\b/.test(t) ? 1 : 0

  let depth = hasIntern + hasWork + hasLeadership + hasProjects + hasResearch + hasAcademics

  // Seniority adjustments: experienced roles demand more depth; internships allow more academic weighting
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

// ----------------------- decision rules -----------------------

function isHardExclusionPass(constraints: ProfileConstraints, jobFacts: JobFacts, primary: JobFunction): { pass: boolean; reason?: string; riskKey?: string } {
  if (constraints.hardNoHourlyPay && jobFacts.isHourly) {
    const ev = jobFacts.hourlyEvidence ? ` (${jobFacts.hourlyEvidence})` : ""
    return { pass: true, reason: `Hourly role${ev} conflicts with an explicit no-hourly exclusion.`, riskKey: "hard_exclusion_hourly" }
  }

  if (constraints.hardNoContract && jobFacts.isContract) {
    return { pass: true, reason: `Contract role conflicts with an explicit no-contract exclusion.`, riskKey: "hard_exclusion_contract" }
  }

  if (constraints.hardNoSales && primary === "sales") {
    return { pass: true, reason: `Sales-focused role conflicts with an explicit no-sales exclusion.`, riskKey: "hard_exclusion_sales" }
  }

  if (constraints.hardNoGovernment && primary === "government_public") {
    return { pass: true, reason: `Government/public-sector role conflicts with an explicit no-government exclusion.`, riskKey: "hard_exclusion_government" }
  }

  return { pass: false }
}

function applyCeilings(decision: Decision, ceilings: Array<"cap_review">): Decision {
  if (ceilings.includes("cap_review")) {
    if (decision === "Priority Apply" || decision === "Apply") return "Review"
  }
  return decision
}

// ----------------------- output builders -----------------------

function buildNextStep(decision: Decision) {
  if (decision === "Pass") return "Do not apply."
  if (decision === "Review") return "Only apply if you accept the risks."
  if (decision === "Apply") return "Apply. Then move to networking."
  return "Priority apply. Then move to networking."
}


function buildPassVisibilityBullet(): string {
  return "SIGNAL evaluates what is visible. If you have this experience but it is not clearly shown, the market will treat it as missing."
}

function shouldShowGpaRisk(employerTier: EmployerTier, gpaBand: GpaBand) {
  if (gpaBand === "unknown") return false
  if (employerTier === 1) return true
  if (employerTier === 2) return gpaBand === "below_3.5"
  return false
}

// ----------------------- main -----------------------

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

  const ceilings: Array<"cap_review"> = []

  // Hard exclusions => PASS
  const hard = isHardExclusionPass(constraints, jobFacts, primaryFunction)
  if (hard.pass) {
    const bullets = uniqTop(
      [
        hard.reason || "Role conflicts with an explicit hard exclusion.",
        buildPassVisibilityBullet(),
      ],
      5
    )

    const risk_flags = uniqTop([hard.riskKey || "hard_exclusion"], 3)
    return {
      decision: "Pass" as Decision,
      icon: iconForDecision("Pass"),
      score: enforceScoreBand("Pass", 45),
      bullets,
      risk_flags,
      next_step: buildNextStep("Pass"),
      location_constraint: "unclear" as LocationConstraint,
      // optional debug fields (safe to keep in result_json for your own analysis)
      logic_version: JOBFIT_LOGIC_VERSION,
    }
  }

  // Fully remote disallowed => cap Review (not a Pass)
  if (constraints.hardNoFullyRemote && jobFacts.isFullyRemote) {
    ceilings.push("cap_review")
  }

  // Contract role with full-time preference => cap Review (unless explicitly disallowed which would have passed above)
  if (constraints.prefFullTime && jobFacts.isContract && !constraints.hardNoContract) {
    ceilings.push("cap_review")
  }

  // Graduation window mismatch => PASS
  const gradWindow = extractGradWindow(jobText)
  const candGrad = extractCandidateGrad(profileText, ps)
  if (gradWindow && candGrad) {
    const c = ymToIndex(candGrad)
    const s = ymToIndex(gradWindow.start)
    const e = ymToIndex(gradWindow.end)
    if (c < s || c > e) {
      const bullets = uniqTop(
        [
          `Graduation window mismatch. This role targets graduates between ${formatYM(gradWindow.start)} and ${formatYM(
            gradWindow.end
          )}.`,
          `Your profile indicates graduation around ${formatYM(candGrad)}.`,
        ],
        5
      )

      return {
        decision: "Pass" as Decision,
        icon: iconForDecision("Pass"),
        score: enforceScoreBand("Pass", 45),
        bullets,
        risk_flags: ["grad_window_mismatch"],
        next_step: buildNextStep("Pass"),
        location_constraint: "unclear" as LocationConstraint,
        logic_version: JOBFIT_LOGIC_VERSION,
      }
    }
  }

  // Hard requirements gate (explicit only)
  const reqs = detectHardRequirements(jobText)
  const missingReqs = reqs.filter((r) => !profileMentionsRequirement(profileText, r))
  if (missingReqs.length > 0) {
    const bullets = uniqTop(
      [
        "This role has explicit hard requirements that are not visible in your profile.",
        ...missingReqs.map((r) => r.label),
        buildPassVisibilityBullet(),
      ],
      5
    )

    return {
      decision: "Pass" as Decision,
      icon: iconForDecision("Pass"),
      score: enforceScoreBand("Pass", 45),
      bullets,
      risk_flags: uniqTop(missingReqs.map((r) => r.key), 3),
      next_step: buildNextStep("Pass"),
      location_constraint: "unclear" as LocationConstraint,
      logic_version: JOBFIT_LOGIC_VERSION,
    }
  }

  // Target alignment ceiling: off-target can never be Apply or Priority Apply
  if (targetAlignment === "off_target") ceilings.push("cap_review")

  // Alignment + depth
  const { level: alignmentLevel, evidenceLabel } = inferAlignmentLevel(profileText, primaryFunction)
  const { depth, label: depthLabel } = computeDepthScore(profileText, seniority)

  // None => PASS
  if (alignmentLevel === "none") {
    const bullets = uniqTop(
      [
        "No role-relevant alignment is visible for this job’s function.",
        buildPassVisibilityBullet(),
      ],
      5
    )

    return {
      decision: "Pass" as Decision,
      icon: iconForDecision("Pass"),
      score: enforceScoreBand("Pass", 45),
      bullets,
      risk_flags: ["no_alignment_detected"],
      next_step: buildNextStep("Pass"),
      location_constraint: "unclear" as LocationConstraint,
      logic_version: JOBFIT_LOGIC_VERSION,
    }
  }

  // Weak adjacent => cap Review
  if (alignmentLevel === "weak_adjacent") ceilings.push("cap_review")

  // Build risks (enumerated, suppressed)
  const risks: string[] = []

  if (jobFacts.isContract) risks.push("contract_role")
  if (jobFacts.isHourly) risks.push("hourly_role")
  if (jobFacts.isFullyRemote) risks.push("fully_remote_role")

  if (targetAlignment === "off_target") risks.push("off_target_role")
  if (alignmentLevel === "strong_adjacent") risks.push("strong_adjacent_alignment")
  if (alignmentLevel === "weak_adjacent") risks.push("weak_alignment")

  if (employerTier === 1) risks.push("tier1_competition")
  if (employerTier === 2) risks.push("tier2_competition")

// Normal (non-hallucinated) risks when decision isn't perfect
if (depthLabel === "moderate") risks.push("depth_moderate")
if (depthLabel === "weak") risks.push("depth_limited")

// If we could not confidently classify competition level, call it out
if (employerTier === 3 && inferEmployerTier(jobText) === 3) {
  // still allowed, but you should admit tier classification is heuristic
  risks.push("competition_level_estimated")
}

// If targets are missing or unclear, that is a real risk for decision confidence
if (targetAlignment === "unclear") risks.push("targets_unclear")


  // GPA risk visibility rules
  if (shouldShowGpaRisk(employerTier, gpaBand)) {
    if (gpaBand === "below_3.5") risks.push("gpa_risk_below_3_5")
    if (gpaBand === "3.5_3.79" && employerTier === 1) risks.push("gpa_risk_below_3_8")
  }

  // Pedigree risk: Tier 1/2 only
  const pedigreeStrong = schoolTier === "S" || schoolTier === "A"
  if ((employerTier === 1 || employerTier === 2) && !pedigreeStrong) {
    risks.push("pedigree_gap")
  }

  // Clean risks (safety suppression)
  const risk_flags = uniqTop(risks.filter((r) => !suppressRiskText(r)), 6)

  // Decision selection (deterministic)
  let decision: Decision = "Review"

  // Helper: strong conditions
  const depthStrong = depthLabel === "strong"
  const depthModerateOrBetter = depthLabel === "strong" || depthLabel === "moderate"
  const gpaStrong = gpaBand === "3.8_plus"
  const gpaCompetitive = gpaBand === "3.8_plus" || gpaBand === "3.5_3.79"

  if (alignmentLevel === "direct") {
    // Tier 1: needs strong evidence; allow Apply with strong profile; Priority only with strong pedigree + gpa + depth
    if (employerTier === 1) {
      if (depthStrong && (pedigreeStrong || gpaStrong)) decision = "Priority Apply"
      else if (depthModerateOrBetter && (pedigreeStrong || gpaStrong)) decision = "Apply"
      else decision = "Review"
    }

    // Tier 2: more forgiving, still competitive
    if (employerTier === 2) {
      if (depthStrong) decision = "Priority Apply"
      else if (depthModerateOrBetter) decision = "Apply"
      else decision = "Review"
    }

    // Tier 3/4: direct alignment carries
    if (employerTier === 3 || employerTier === 4) {
      if (depthStrong) decision = "Priority Apply"
      else if (depthModerateOrBetter) decision = "Apply"
      else decision = "Review"
    }

    // Internship carveout: don't auto-punish first-timers
    if (seniority === "internship" && decision === "Review" && depthModerateOrBetter) {
      decision = "Apply"
    }
  } else if (alignmentLevel === "strong_adjacent") {
    // Tier 1: strong adjacent can work only with pedigree + gpa + depth (Apply, not Priority)
    if (employerTier === 1) {
      if (depthStrong && pedigreeStrong && gpaStrong) decision = "Apply"
      else decision = "Review"
    }

    // Tier 2: adjacent can reach Apply if depth is strong and GPA is at least competitive
    if (employerTier === 2) {
      if (depthStrong && gpaCompetitive) decision = "Apply"
      else decision = "Review"
    }

    // Tier 3/4: adjacent is usually Review
    if (employerTier === 3 || employerTier === 4) {
      decision = depthStrong ? "Review" : "Review"
    }

    // Internship carveout: adjacent can be Apply if strong depth
    if (seniority === "internship" && depthStrong && employerTier !== 1) {
      decision = "Apply"
    }
  } else {
    // weak_adjacent already caps at Review
    decision = "Review"
  }

  // Apply ceilings last (off-target, weak adjacent, remote preference caps, etc.)
  decision = applyCeilings(decision, ceilings)

  // Build bullets (no job quotes)
  const bullets: string[] = []

  // Core explanation bullets
  bullets.push(
    alignmentLevel === "direct"
      ? "Direct alignment to the role function is visible in your profile."
      : alignmentLevel === "strong_adjacent"
      ? "Strong adjacent alignment is visible, but this role may still be competitive without direct matches."
      : "Transferable signals exist, but alignment is not clearly tied to this role’s function."
  )

  bullets.push(
    depthLabel === "strong"
      ? "Depth is strong based on the number and variety of relevant experiences and signals."
      : depthLabel === "moderate"
      ? "Depth is moderate. You have some relevant signals, but the role may still be competitive."
      : "Depth is limited for this role’s expectations."
  )

  // Tier + competitiveness bullet
  if (employerTier === 1) bullets.push("This is a high-competition role category. The bar is higher than most early-career postings.")
  else if (employerTier === 2) bullets.push("This is a structured early-career role category. Competition is meaningful but not Tier 1.")
  else bullets.push("This role is not classified as Tier 1 competition. Alignment and depth should drive the decision.")

  // Constraints bullets (only if actually relevant)
  if (constraints.prefFullTime && jobFacts.isContract && !constraints.hardNoContract) {
    bullets.push("Contract structure conflicts with a stated full-time preference, so this should be treated as a Review decision.")
  }
  if (constraints.hardNoFullyRemote && jobFacts.isFullyRemote) {
    bullets.push("Fully remote structure conflicts with a stated preference against fully remote work, so this should be treated as a Review decision.")
  }

  // Target alignment bullet (only if targets exist)
  if (targetAlignment === "off_target") bullets.push("This role does not align with your stated targets, so it cannot be an Apply decision.")
  if (targetAlignment === "unclear") bullets.push("Targets are unclear. Decision is based on visible alignment and competitiveness signals.")

  // GPA mention rules (only Tier 1 and sometimes Tier 2)
  if (shouldShowGpaRisk(employerTier, gpaBand) && gpa !== null) {
    if (employerTier === 1 && gpa < 3.8) bullets.push("For Tier 1 competition, GPA can be a meaningful filter depending on the employer and applicant pool.")
    if (employerTier === 2 && gpa < 3.5) bullets.push("For structured early-career roles, low GPA can reduce odds depending on the employer’s screening rules.")
  }

  // Clean + cap bullets
  const finalBullets = uniqTop(bullets, 6)

  // Score (deterministic)
  let scoreBase =
    decision === "Priority Apply" ? 90 :
    decision === "Apply" ? 78 :
    decision === "Review" ? 60 : 45

  // modifiers (small, deterministic)
  if (alignmentLevel === "direct") scoreBase += 3
  if (alignmentLevel === "strong_adjacent") scoreBase += 1
  if (depthLabel === "strong") scoreBase += 3
  if (depthLabel === "weak") scoreBase -= 3
  if (employerTier === 1) scoreBase -= 2 // harder market
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
    risk_flags: risk_flags,
    next_step: buildNextStep(decision),
    location_constraint: "unclear" as LocationConstraint,
    logic_version: JOBFIT_LOGIC_VERSION,

    // Optional internal debug fields (kept in result_json for analysis; UI can ignore)
    debug: {
      employer_tier: employerTier,
      school_tier: schoolTier,
      gpa_band: gpaBand,
      job_seniority: seniority,
      primary_function: primaryFunction,
      alignment_level: alignmentLevel,
      depth_score: depth,
      target_alignment: targetAlignment,
      ceilings,
    },
  }
}
