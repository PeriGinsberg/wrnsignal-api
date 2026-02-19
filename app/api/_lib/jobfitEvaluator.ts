// app/api/_lib/jobfitEvaluator.ts
// Deterministic JobFit rules engine (no LLM decisioning)
//
// Principles
// - Decision-first (Priority Apply / Apply / Review / Pass)
// - Conservative: if proof is not visible, do not claim it
// - No job quotes in bullets (no direct copy/paste fragments)
// - Do not surface internal depth labels or scoring internals to user
// - No visa/work auth, driver's license, background check, drug test risks
// - Uses profileStructured when present (no new user inputs)
// - Human-readable risks only (no internal tokens)
// - Slightly aggressive: if you cannot stand up to it, it is Review/Pass, not Apply

export type Decision = "Priority Apply" | "Apply" | "Review" | "Pass"
export type LocationConstraint = "constrained" | "not_constrained" | "unclear"

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
  veryOpenToNonObvious: boolean
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

type AlignmentLevel = "direct" | "strong_adjacent" | "weak_adjacent" | "none"
type TargetAlignment = "on_target" | "off_target" | "unclear"

const JOBFIT_LOGIC_VERSION = "rules_v1_2026_02_19b"

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
  if (a.length === 0) return ""
  if (a.length === 1) return a[0]
  if (a.length === 2) return `${a[0]} and ${a[1]}`
  return `${a.slice(0, -1).join(", ")}, and ${a[a.length - 1]}`
}

function cleanSignalLabel(label: string) {
  // Keep labels tight, remove parentheticals, avoid bloated text
  return String(label || "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function buildVisibilityBullet() {
  return "SIGNAL evaluates what is visible. If you have the experience but it is not clearly shown, the market will treat it as missing."
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

  // Contract should mean employment type, not "draft contracts" as a responsibility
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
    /\bprestige\b/,
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

  if (/\b(accounting|accountant|general ledger|reconciliation|financial statements|cpa)\b/.test(t))
    return "finance_accounting"

  // Publishing/editorial should win early
  if (
    /\b(editorial assistant|editorial|assistant editor|copy editor|copyeditor|proofread|copy[- ]?edit|line edit|publishing|imprint|literary agent|book proposals?|submissions?|manuscripts?)\b/.test(
      t
    ) ||
    /\b(jacket copy|galley copy|fact sheets?|metadata|book production|incopy|ap style|chicago manual)\b/.test(t)
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

  if (/\b(clinical|patient|medical device|emt\b|paramedic|nurse|rn\b|therapy|pt\b|occupational)\b/.test(t))
    return "clinical_health"

  return "unknown"
}

// ----------------------- signals -----------------------

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
  | "research"

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

export type Signal = { key: SignalKey; label: string; strength?: "explicit" | "implied" }

function signalLabels(signals: Signal[], max: number) {
  return (signals || [])
    .map((s) => cleanSignalLabel(s?.label || ""))
    .filter(Boolean)
    .slice(0, max)
}

function overlapSignals(job: Signal[], prof: Signal[]) {
  const profKeys = new Set((prof || []).map((s) => s.key))
  return (job || []).filter((s) => profKeys.has(s.key))
}

function safeOverlapLabels(overlap: Signal[]) {
  const raw = signalLabels(overlap, 6)
  // avoid tiny generic labels
  const cleaned = raw.filter((s) => s.length >= 8)
  return uniqTop(cleaned, 3)
}

// ----------------------- job signals (strict, specific first) -----------------------

function extractJobSignals(jobText: string): Signal[] {
  const t = normalizeText(jobText)

  const patterns: Array<[RegExp, Signal]> = [
    // Editorial core
    [/\b(copy[- ]?edit|copyedit|line edit|line editing)\b/, { key: "editing", label: "Copyediting and line editing", strength: "explicit" }],
    [/\b(proofread|proofreading|final pass)\b/, { key: "proofreading", label: "Proofreading and final-pass accuracy", strength: "explicit" }],
    [/\b(fact[- ]?check|fact check)\b/, { key: "publishing_research", label: "Fact-checking and accuracy review", strength: "explicit" }],
    [/\b(style guide|ap style|chicago)\b/, { key: "editing", label: "Style guide based editing (AP/Chicago)", strength: "explicit" }],
    [/\b(headlines?|display copy)\b/, { key: "headline_writing", label: "Headline and display copy writing", strength: "explicit" }],
    [/\bseo\b/, { key: "seo", label: "SEO-aware editorial publishing", strength: "explicit" }],
    [/\b(content[- ]?management system|cms)\b/, { key: "cms", label: "CMS publishing workflow", strength: "explicit" }],
    [/\b(wordpress|incopy|google docs)\b/, { key: "cms", label: "Editorial tools (WordPress, Docs, InCopy)", strength: "explicit" }],

    // Publishing ops, submissions, authors
    [/\b(editorial assistant|editorial operations|publishing workflow|schedule pieces|content calendar)\b/, { key: "publishing_ops", label: "Editorial operations and publishing workflow", strength: "explicit" }],
    [/\b(submissions?|unsolicited submissions?|slush pile|proposals?|manuscripts?)\b/, { key: "publishing_ops", label: "Evaluating submissions and drafts", strength: "explicit" }],
    [/\b(authors?|agents?|contributors?|freelancers?)\b/, { key: "publishing_ops", label: "Working with contributors, authors, or agents", strength: "explicit" }],

    // Rotational, program signals
    [/\brotational\b|\baccelerate\b|\bapprenticeship\b|\bdevelopment program\b/, { key: "program_management", label: "Rotational or structured development program", strength: "explicit" }],

    // Presentations (only when explicit)
    [/\b(presentation|deck|powerpoint)\b/, { key: "presentations", label: "Presentations and stakeholder communication", strength: "explicit" }],

    // Data analysis (only when explicit)
    [/\b(data analysis|analyze performance|testing and reporting|kpi)\b/, { key: "data_analysis", label: "Data analysis and performance reporting", strength: "explicit" }],
    [/\bsql\b/, { key: "sql", label: "SQL-based analysis", strength: "explicit" }],
    [/\b(advanced excel|pivot tables?|vlookup|xlookup|index\s*match|excel modeling)\b/, { key: "excel", label: "Advanced Excel execution", strength: "explicit" }],

    // Marketing adjacent signals in editorial programs
    [/\b(influencer program|ads and creative|paid social|campaign)\b/, { key: "paid_media", label: "Campaign and creative execution (ads/influencers)", strength: "explicit" }],
    [/\b(copywriting|marketing copy)\b/, { key: "copywriting", label: "Copywriting or marketing copy refinement", strength: "explicit" }],

    // Finance / analytics
    [/\b(financial modeling|dcf|lbo|valuation)\b/, { key: "modeling", label: "Financial modeling and valuation", strength: "explicit" }],
    [/\b(underwriting|credit memo|credit analysis)\b/, { key: "underwriting", label: "Underwriting or credit analysis", strength: "explicit" }],
    [/\b(financial statements|balance sheet|income statement|cash flow)\b/, { key: "fin_statements", label: "Financial statement work", strength: "explicit" }],
  ]

  const out: Signal[] = []
  for (const [re, sig] of patterns) {
    if (re.test(t)) out.push(sig)
    if (out.length >= 6) break
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

// ----------------------- structured profile readers -----------------------

const SCHOOL_TIER_S: string[] = [
  "harvard", "yale", "princeton", "stanford", "mit", "caltech",
  "oxford", "cambridge"
]

const SCHOOL_TIER_A: string[] = [
  "columbia", "upenn", "university of pennsylvania", "brown",
  "dartmouth", "cornell", "duke", "northwestern",
  "university of chicago", "uchicago",
  "johns hopkins", "georgetown",
  "uc berkeley", "berkeley", "ucla",
  "carnegie mellon", "rice", "vanderbilt",
  "notre dame", "nyu", "new york university"
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

function readGpaBand(profileStructured: any): GpaBand {
  const ps = safeObj(profileStructured)
  const raw = String(ps.gpa_band || ps.profile?.gpa_band || "").trim().toLowerCase()
  if (raw === "3.8_plus" || raw === "3.5_3.79" || raw === "below_3.5") return raw as GpaBand
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

  // fallback: weak extraction from text
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

  return uniqTop(hits, 12)
}

function mapTargetsToFunctions(targets: string[]): JobFunction[] {
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

function inferTargetAlignment(primary: JobFunction, targets: JobFunction[]): TargetAlignment {
  if (!targets || targets.length === 0) return "unclear"
  if (targets.includes(primary)) return "on_target"
  return "off_target"
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

  const explicit = parseMonthYear(profileText || "")
  if (explicit) return explicit

  const classOf = (profileText || "").match(/\bclass of\s*(20\d{2})\b/i)
  if (classOf) {
    const year = Number(classOf[1])
    if (Number.isFinite(year)) return { year, month: 5 }
  }

  const yr = (profileText || "").match(/\b(graduate|graduating|graduation)\b[^\d]{0,20}\b(20\d{2})\b/i)
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
  if (s.includes("not stated") || s.includes("not specified") || s.includes("not mentioned")) return true
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

// ----------------------- alignment inference -----------------------

const DIRECT_KEYWORDS: Record<JobFunction, RegExp[]> = {
  investment_banking_pe_mna: [/\b(investment banking|ib\b|m&a|mergers|acquisitions|lbo|leveraged buyout|pitchbook|financial modeling|valuation|dcf)\b/],
  consulting_strategy: [/\b(consulting|consultant|case interview|workstream|deck|analysis|client deliverables)\b/],
  finance_accounting: [/\b(financial analysis|fp&a|budget|forecast|accounting|reconciliation|general ledger|journal entries|ar\b|ap\b)\b/],
  commercial_real_estate: [/\b(commercial real estate|real estate underwriting|noi|cap rate|dscr|multifamily|industrial|office|leasing)\b/],
  publishing_editorial: [
    /\b(copy[- ]?edit|copyedit|proofread|proofreading|line edit|fact[- ]?check|style guide|ap style|chicago)\b/,
    /\b(editorial assistant|assistant editor|editor\b|publishing|imprint|submissions?|manuscripts?|op-eds?|contributors?)\b/,
    /\b(cms|content[- ]?management system|wordpress|incopy)\b/,
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
  for (const re of patterns || []) {
    if (re.test(t)) hits += 1
  }
  return hits
}

function inferAlignmentLevel(profileText: string, primary: JobFunction): { level: AlignmentLevel; evidenceScore: number } {
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

  // Weak adjacency is allowed only when the profile has general evidence of professional execution
  const t = normalizeText(profileText)
  const weakSignals =
    (t.includes("project") ? 1 : 0) +
    (t.includes("leadership") ? 1 : 0) +
    (t.includes("analysis") ? 1 : 0) +
    (t.includes("intern") ? 1 : 0)
  if (weakSignals >= 2) return { level: "weak_adjacent", evidenceScore: 1 }

  return { level: "none", evidenceScore: 0 }
}

// ----------------------- experience gate (years required) -----------------------

function extractMinYearsRequired(jobText: string): number | null {
  const t = normalizeText(jobText)

  // patterns: "3-6 years", "3 to 6 years"
  const mRange = t.match(/\b(\d{1,2})\s*(?:-|\sto\s)\s*(\d{1,2})\s+years?\b/)
  if (mRange) return Number(mRange[1])

  // patterns: "at least 3 years", "minimum 3 years"
  const mAtLeast = t.match(/\b(at least|minimum|min\.)\s*(\d{1,2})\s+years?\b/)
  if (mAtLeast) return Number(mAtLeast[2])

  // patterns: "3+ years"
  const mPlus = t.match(/\b(\d{1,2})\s*\+\s*years?\b/)
  if (mPlus) return Number(mPlus[1])

  return null
}

type ExperienceBand = "0_1" | "2_3" | "4_6" | "7_plus" | "unknown"

function estimateExperienceBand(profileText: string, profileStructured: any): ExperienceBand {
  const t = normalizeText(profileText)
  const ps = safeObj(profileStructured)

  // explicit "X years"
  const mYears = t.match(/\b(\d{1,2})\s*\+?\s*years?\b/)
  if (mYears) {
    const y = Number(mYears[1])
    if (y >= 7) return "7_plus"
    if (y >= 4) return "4_6"
    if (y >= 2) return "2_3"
    return "0_1"
  }

  // proxy: grad year
  const gy = Number(ps.grad_year || ps.profile?.grad_year)
  if (Number.isFinite(gy)) {
    const nowYear = 2026
    const diff = nowYear - gy
    if (diff >= 7) return "7_plus"
    if (diff >= 4) return "4_6"
    if (diff >= 2) return "2_3"
    if (diff >= 0) return "0_1"
  }

  // fallback: obvious student signals
  if (t.includes("recent graduate") || t.includes("class of")) return "0_1"

  return "unknown"
}

function yearsBandMeets(minYears: number, band: ExperienceBand): boolean {
  if (band === "unknown") return false
  if (minYears >= 7) return band === "7_plus"
  if (minYears >= 4) return band === "4_6" || band === "7_plus"
  if (minYears >= 2) return band === "2_3" || band === "4_6" || band === "7_plus"
  return true
}

// ----------------------- profile signals (strict, proof-first) -----------------------

function extractProfileSignals(profileText: string): Signal[] {
  const t = normalizeText(profileText)

  const patterns: Array<[RegExp, Signal]> = [
    // Editorial proof (only when explicit)
    [/\b(copy[- ]?edit(or|ing)?|copyedit|line edit(ing)?)\b/, { key: "editing", label: "Copyediting and line editing", strength: "explicit" }],
    [/\b(proofread(ing)?)\b/, { key: "proofreading", label: "Proofreading and final-pass accuracy", strength: "explicit" }],
    [/\b(fact[- ]?check(ing)?|fact check(ing)?)\b/, { key: "publishing_research", label: "Fact-checking and accuracy review", strength: "explicit" }],
    [/\b(style guide|ap style|chicago)\b/, { key: "editing", label: "Style guide based editing (AP/Chicago)", strength: "explicit" }],
    [/\b(headlines?|display copy)\b/, { key: "headline_writing", label: "Headline and display copy writing", strength: "explicit" }],
    [/\bseo\b/, { key: "seo", label: "SEO-aware publishing", strength: "explicit" }],
    [/\b(content[- ]?management system|cms|wordpress|incopy)\b/, { key: "cms", label: "CMS publishing workflow", strength: "explicit" }],

    // Publication environment (only when a real publication is referenced)
    [/\b(newsroom|magazine|journal|the yale review|yale daily news|the new journal)\b/, { key: "publishing_ops", label: "Editorial team experience in a publication environment", strength: "explicit" }],

    // Submissions screening (ONLY when explicit)
    [/\b(unsolicited submissions?|slush pile|submissions? screening|reader\b)\b/, { key: "publishing_ops", label: "Evaluating and screening submissions", strength: "explicit" }],

    // Presentations
    [/\b(presentation|deck|powerpoint)\b/, { key: "presentations", label: "Presentations and stakeholder communication", strength: "explicit" }],

    // Data analysis
    [/\b(data analysis|testing and reporting|kpi)\b/, { key: "data_analysis", label: "Data analysis and reporting", strength: "explicit" }],
    [/\bsql\b/, { key: "sql", label: "SQL-based analysis", strength: "explicit" }],
    [/\b(advanced excel|pivot tables?|vlookup|xlookup|index\s*match|excel modeling)\b/, { key: "excel", label: "Advanced Excel execution", strength: "explicit" }],

    // Operations / coordination
    [/\b(operations intern|operations assistant|operations coordinator)\b/, { key: "ops", label: "Operations coordination and execution", strength: "explicit" }],
    [/\b(schedule(ing)?|calendar management|deadline(s)?|multi[- ]?thread)\b/, { key: "project_management", label: "Deadlines, scheduling, and coordination", strength: "explicit" }],
  ]

  const out: Signal[] = []
  for (const [re, sig] of patterns) {
    if (re.test(t)) out.push(sig)
    if (out.length >= 7) break
  }
  return out
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
  if (decision === "Review") return "Only apply if you accept the risks and can tighten proof fast."
  if (decision === "Apply") return "Apply. Then move to networking."
  return "Priority apply. Then move to networking."
}

function shouldShowGpaRisk(employerTier: EmployerTier, gpaBand: GpaBand) {
  if (gpaBand === "unknown") return false
  if (employerTier === 1) return true
  if (employerTier === 2) return gpaBand === "below_3.5"
  return false
}

function shouldAddPedigreeBullet(params: { employerTier: EmployerTier; schoolTier: SchoolTier; decision: Decision }) {
  const { employerTier, schoolTier, decision } = params
  const pedigreeStrong = schoolTier === "S" || schoolTier === "A"
  if (!pedigreeStrong) return false

  // Only show when it helps and does not become fluff
  if (decision === "Priority Apply" || decision === "Apply") return true
  if (employerTier === 1 || employerTier === 2) return true
  return false
}

// ----------------------- risk labels (human only) -----------------------

type RiskCode =
  | "off_target_role"
  | "weak_alignment"
  | "strong_adjacent_alignment"
  | "tier1_competition"
  | "tier2_competition"
  | "competitive_market"
  | "pedigree_gap"
  | "gpa_risk_below_3_8"
  | "gpa_risk_below_3_5"
  | "contract_role"
  | "hourly_role"
  | "fully_remote_role"
  | "years_required_mismatch"
  | "targets_unclear"

function riskLabel(code: RiskCode) {
  switch (code) {
    case "off_target_role":
      return "Off-target vs your stated direction. Do not treat this as a smart apply unless you are intentionally pivoting."
    case "weak_alignment":
      return "The role match is not clearly proven in your materials. Screens will treat that as missing."
    case "strong_adjacent_alignment":
      return "Your background is adjacent, not direct. That can work, but it raises the bar."
    case "tier1_competition":
      return "Tier 1 competition. Expect tougher screens and a deeper candidate pool."
    case "tier2_competition":
      return "Tier 2 competition. Still competitive."
    case "competitive_market":
      return "Competitive applicant pool. Your materials need tight proof and fast follow-up networking."
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
    case "years_required_mismatch":
      return "Years-of-experience mismatch. The job asks for experienced ownership, and your profile does not clearly prove that level yet."
    case "targets_unclear":
      return "Your targets are unclear, so this decision is based purely on visible fit signals."
  }
}

function toUserRiskFlags(codes: RiskCode[]) {
  const out: string[] = []
  for (const code of codes || []) {
    const label = riskLabel(code)
    if (label && !suppressRiskText(label)) out.push(label)
  }
  return uniqTop(out, 6)
}

// ----------------------- bullet builders (Why must be factual) -----------------------

function buildWhyBullets(params: {
  decision: Decision
  jobSignals: Signal[]
  profSignals: Signal[]
  overlap: Signal[]
  schoolTier: SchoolTier
  employerTier: EmployerTier
  minYears: number | null
  expBand: ExperienceBand
}) {
  const {
    decision,
    jobSignals,
    profSignals,
    overlap,
    schoolTier,
    employerTier,
    minYears,
    expBand,
  } = params

  const bullets: string[] = []

  const jobTop = uniqTop(signalLabels(jobSignals, 4), 4)
  const overlapTop = safeOverlapLabels(overlap)

  // 1) Role requirement statement (generic, no quotes)
  if (jobTop.length > 0) {
    bullets.push(`This role centers on ${joinWithAnd(jobTop).toLowerCase()}.`)
  } else {
    bullets.push("This role is evaluating strong execution in its core function and quality standards.")
  }

  // 2) Proof statement (only if overlap is real)
  if (overlapTop.length > 0) {
    bullets.push(`Visible proof: your ${joinWithAnd(overlapTop).toLowerCase()} maps to what this role requires.`)
  } else {
    bullets.push("Your resume does not show clean, explicit proof that matches the role’s core requirements yet.")
  }

  // 3) Competitiveness signal (only if it matters and is not fluff)
  const pedigreeStrong = schoolTier === "S" || schoolTier === "A"
  if (shouldAddPedigreeBullet({ employerTier, schoolTier, decision })) {
    bullets.push("Your Tier 1 school strengthens your competitiveness for this role.")
  } else if (decision === "Review" && employerTier <= 2) {
    bullets.push("This is competitive. If your proof is not explicit, you will get screened out fast.")
  }

  // 4) Experience statement (only if job asks for it)
  if (minYears !== null && minYears >= 3) {
    const meets = yearsBandMeets(minYears, expBand)
    if (!meets) {
      bullets.push("This posting expects experienced editing ownership. If you apply anyway, your materials must show equivalent professional-level work.")
    } else {
      bullets.push("Your experience level appears closer to what this posting expects, so this becomes a cleaner shot if your proof is explicit.")
    }
  }

  // 5) Decision-specific action line (not fluff)
  if (decision === "Priority Apply") bullets.push("Priority apply. Submit clean materials, then move to targeted networking.")
  if (decision === "Apply") bullets.push("Apply. Submit clean materials, then move to targeted networking.")
  if (decision === "Review") bullets.push("Review. Only apply if you can tighten proof fast and accept the risks.")
  if (decision === "Pass") bullets.push("Pass. This is not a smart use of applications right now.")

  return uniqTop(bullets, 6)
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

  const schoolTier = readSchoolTier(ps, profileText)
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
  if (targetAlignment === "off_target" && !constraints.veryOpenToNonObvious) ceilings.push("cap_review")

  // 3) GRAD WINDOW => PASS (deterministically mismatched)
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

  // 5) ALIGNMENT
  const { level: alignmentLevel } = inferAlignmentLevel(profileText, primaryFunction)

  // Absolute mismatch => PASS
  if (alignmentLevel === "none") {
    const bullets = uniqTop(["No role-relevant alignment is visible for this job’s function.", buildVisibilityBullet()], 6)
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

  // 6) EXPERIENCE GATE (years required)
  const minYears = extractMinYearsRequired(jobText)
  const expBand = estimateExperienceBand(profileText, ps)

  // If job requires 3+ years and we cannot clearly prove it, cap to Review
  const yearsMismatch = minYears !== null && minYears >= 3 && !yearsBandMeets(minYears, expBand)
  if (yearsMismatch) ceilings.push("cap_review")

  // 7) DECISION (conservative)
  const pedigreeStrong = schoolTier === "S" || schoolTier === "A"
  const gpaStrong = gpaBand === "3.8_plus"
  const gpaCompetitive = gpaBand === "3.8_plus" || gpaBand === "3.5_3.79"

  let decision: Decision = "Review"

  if (alignmentLevel === "direct") {
    if (employerTier === 1) {
      if (pedigreeStrong && gpaStrong && !yearsMismatch) decision = "Priority Apply"
      else if ((pedigreeStrong || gpaStrong) && !yearsMismatch) decision = "Apply"
      else decision = "Review"
    } else if (employerTier === 2) {
      if ((pedigreeStrong || gpaCompetitive) && !yearsMismatch) decision = "Apply"
      else decision = "Review"
    } else {
      if (!yearsMismatch) decision = "Apply"
      else decision = "Review"
    }

    // Internship carveout
    if (seniority === "internship" && decision === "Review" && !yearsMismatch) decision = "Apply"
  } else if (alignmentLevel === "strong_adjacent") {
    // Adjacent is never Priority Apply
    if (employerTier === 1) {
      decision = pedigreeStrong && gpaStrong && !yearsMismatch ? "Apply" : "Review"
    } else if (employerTier === 2) {
      decision = gpaCompetitive && !yearsMismatch ? "Apply" : "Review"
    } else {
      decision = !yearsMismatch ? "Apply" : "Review"
    }
  } else {
    decision = "Review"
  }

  decision = applyCeilings(decision, ceilings)

  // 8) RISKS (do not allow "no risks" when job clearly asks for experience or is competitive)
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

  // Pedigree gap (Tier 1/2 only)
  if ((employerTier === 1 || employerTier === 2) && !pedigreeStrong) riskCodes.push("pedigree_gap")

  // GPA risk visibility rules
  if (shouldShowGpaRisk(employerTier, gpaBand)) {
    if (gpaBand === "below_3.5") riskCodes.push("gpa_risk_below_3_5")
    if (gpaBand === "3.5_3.79" && employerTier === 1) riskCodes.push("gpa_risk_below_3_8")
  }

  // Years mismatch risk
  if (yearsMismatch) riskCodes.push("years_required_mismatch")

  // Competitive market risk for high tiers even when Apply
  if ((decision === "Apply" || decision === "Priority Apply") && (employerTier === 1 || employerTier === 2)) {
    riskCodes.push("competitive_market")
  }

  const risk_flags = toUserRiskFlags(uniqTop(riskCodes, 12) as RiskCode[])

  // 9) WHY BULLETS (3+ bullets, factual, no "depth" talk)
  const jobSignals = extractJobSignals(jobText)
  const profSignals = extractProfileSignals(profileText)
  const overlap = overlapSignals(jobSignals, profSignals)

  const bullets = buildWhyBullets({
    decision,
    jobSignals,
    profSignals,
    overlap,
    schoolTier,
    employerTier,
    minYears,
    expBand,
  })

  // 10) SCORE (deterministic, but not described to user)
  let scoreBase =
    decision === "Priority Apply" ? 90 :
    decision === "Apply" ? 78 :
    decision === "Review" ? 60 : 45

  if (alignmentLevel === "direct") scoreBase += 3
  if (alignmentLevel === "strong_adjacent") scoreBase += 1
  if (employerTier === 1) scoreBase -= 2
  if (targetAlignment === "off_target") scoreBase -= 4
  if (constraints.prefFullTime && jobFacts.isContract && !constraints.hardNoContract) scoreBase -= 2
  if (constraints.hardNoFullyRemote && jobFacts.isFullyRemote) scoreBase -= 2
  if (yearsMismatch) scoreBase -= 4

  const score = enforceScoreBand(decision, scoreBase)

  return {
    decision,
    icon: iconForDecision(decision),
    score,
    bullets,
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
      target_alignment: targetAlignment,
      ceilings,
      job_facts: jobFacts,
      min_years_required: minYears,
      experience_band: expBand,
      years_mismatch: yearsMismatch,
      job_signals: signalLabels(jobSignals, 12),
      profile_signals: signalLabels(profSignals, 12),
      overlap_signals: signalLabels(overlap, 12),
      risk_codes: uniqTop(riskCodes, 12),
    },
  }
}
