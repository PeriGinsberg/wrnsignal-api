// app/api/_lib/jobfitEvaluator.ts
import OpenAI from "openai"
import crypto from "crypto"

/**
 * WRNSignal JobFit Evaluator — deterministic-first (weighted risks)
 *
 * Guarantees:
 * - Deterministic gates and hard exclusions override everything
 * - LLM is NOT used for decision/scoring (OpenAI client kept for future, unused here)
 * - Score is deterministic, differentiated, never 100 (max 97)
 * - If any risks are shown, score cannot remain at max
 * - Weighted risk model (severity + type) drives score + Apply downgrade
 * - Why and Risks are deterministically separated (no mixed bullets)
 * - If Pass, show only pass reasons (no positives)
 * - Output JSON shape is stable
 */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
void client // keep compiled even if unused

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

type YM = { year: number; month: number } // month 1-12

type Severity = "severe" | "high" | "medium" | "low"

type RiskSignal = {
    code: string
    severity: Severity
    note: string
}

type WhySignal = {
    code: string
    note: string
}

type ScoreExplain = { label: string; delta: number; note?: string }

type ProfileConstraints = {
    hardNoHourlyPay: boolean
    prefFullTime: boolean
    hardNoContract: boolean
    hardNoSales: boolean
    hardNoGovernment: boolean
    hardNoFullyRemote: boolean

    // scalable constraint catalog (add keys over time without rewriting logic)
    hardNoAnalytics: boolean
    hardNoRemote: boolean
    hardNoRelocation: boolean
    hardNoHeavyTravel: boolean
    hardNoNightsWeekends: boolean

    preferredLocations: string[]
}

/* ----------------------- score policy ----------------------- */
const SCORE_MAX = 97 // never 100
const APPLY_THRESHOLD = 80
const REVIEW_THRESHOLD = 60
const REVIEW_CAP_IF_FLOORED = 79 // only used to prevent Review looking like Apply
const PASS_CAP = 59

/* ----------------------- helpers ----------------------- */
function normalizeText(t: string) {
    return (t || "")
        .replace(/\u202f/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase()
}

function clampScore(n: any) {
    const x = Number(n)
    if (!Number.isFinite(x)) return 0
    return Math.max(0, Math.min(100, Math.round(x)))
}

function iconForDecision(decision: Decision) {
    if (decision === "Apply") return "✅"
    if (decision === "Review") return "⚠️"
    return "⛔"
}

function stableFingerprint(jobText: string, profileText: string) {
    const a = normalizeText(jobText)
    const b = normalizeText(profileText)
    return crypto.createHash("sha256").update(a + "\n---\n" + b).digest("hex")
}

function unique(arr: string[]) {
    return Array.from(new Set(arr.map((s) => (s || "").trim()).filter(Boolean)))
}

/* ----------------------- deterministic extraction: job facts ----------------------- */
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

    return { isHourly, hourlyEvidence, isContract, contractEvidence }
}

/* ----------------------- location + modality ----------------------- */
function jobIsFullyRemote(jobText: string) {
    const t = normalizeText(jobText)
    return /\bfully remote|100% remote|remote only|work from home|wfh\b/.test(t)
}

function jobMentionsHybridOrOnsite(jobText: string) {
    const t = normalizeText(jobText)
    return (
        /\bhybrid\b/.test(t) ||
        /\bon-?site\b/.test(t) ||
        /\bin office\b/.test(t) ||
        /\b\d+\s*days\s*(on-?site|onsite|in office)\b/.test(t) ||
        /\boffice\b/.test(t)
    )
}

function inferLocationConstraint(jobText: string): LocationConstraint {
    if (jobIsFullyRemote(jobText)) return "not_constrained"
    if (jobMentionsHybridOrOnsite(jobText)) return "constrained"
    return "unclear"
}

const CITY_ALIASES: Record<string, string[]> = {
    "new york": ["new york", "nyc", "manhattan", "brooklyn", "queens"],
    boston: ["boston"],
    philadelphia: ["philadelphia", "philly"],
    "washington dc": ["washington dc", "washington, d.c.", "dc", "d.c."],
    "los angeles": ["los angeles", "la"],
    "san francisco": ["san francisco", "sf", "bay area"],
    irvine: ["irvine"],
}

const STATE_ALIASES: Record<string, string[]> = {
    ca: ["california", "ca"],
    ny: ["new york", "ny"],
    ma: ["massachusetts", "ma"],
    pa: ["pennsylvania", "pa"],
    dc: ["district of columbia", "dc", "d.c."],
    nj: ["new jersey", "nj"],
    oh: ["ohio", "oh"],
    va: ["virginia", "va"],
    md: ["maryland", "md"],
}

function jobExtractLocationTokens(jobText: string): string[] {
    const t = normalizeText(jobText)
    const out: string[] = []

    const cityState =
        t.match(/\b([a-z]+(?:\s+[a-z]+){0,2})\s*,\s*(ca|ny|ma|pa|nj|oh|dc|va|md)\b/) ||
        t.match(/\bin\s+([a-z]+(?:\s+[a-z]+){0,2})\s*,\s*(ca|ny|ma|pa|nj|oh|dc|va|md)\b/)
    if (cityState?.[1] && cityState?.[2]) {
        out.push(cityState[1].trim())
        out.push(cityState[2].trim())
    }

    const officeLoc = t.match(
        /\bin\s+our\s+([a-z]+(?:\s+[a-z]+){0,2})\s*,\s*(california|new york|massachusetts|pennsylvania)\s+office\b/
    )
    if (officeLoc?.[1] && officeLoc?.[2]) {
        out.push(officeLoc[1].trim())
        out.push(officeLoc[2].trim())
    }

    for (const [abbr, names] of Object.entries(STATE_ALIASES)) {
        if (names.some((n) => t.includes(n))) out.push(abbr)
    }

    for (const [canonical, aliases] of Object.entries(CITY_ALIASES)) {
        if (aliases.some((a) => t.includes(a))) out.push(canonical)
    }

    return unique(out)
}

function extractPreferredLocations(profileText: string): string[] {
    const t = normalizeText(profileText)

    const wants = t.match(
        /\b(wants to be in|prefer(?:s)?|preferred|target(?:s)?)\b[\s:]{0,10}([a-z,\.\s]+)\b/
    )
    const fragment = wants?.[2] ? wants[2].slice(0, 180) : ""
    const hay = fragment ? fragment + " " + t : t

    const tokens: string[] = []
    for (const [canonical, aliases] of Object.entries(CITY_ALIASES)) {
        if (aliases.some((a) => hay.includes(a))) tokens.push(canonical)
    }

    // common shorthand
    if (hay.includes("nyc")) tokens.push("new york")
    if (hay.includes("new york")) tokens.push("new york")
    if (hay.includes("boston")) tokens.push("boston")
    if (hay.includes("philadelphia") || hay.includes("philly")) tokens.push("philadelphia")
    if (hay.includes("washington")) tokens.push("washington dc")
    if (hay.includes("d.c.")) tokens.push("washington dc")

    return unique(tokens)
}

function locationPreferenceMismatch(args: {
    profilePreferred: string[]
    jobTokens: string[]
}) {
    const pref = args.profilePreferred.map((s) => normalizeText(s))
    const jt = args.jobTokens.map((s) => normalizeText(s))

    if (!pref.length) return false
    if (!jt.length) return false // if job truly doesn't state location, don't enforce mismatch

    const anyMatch = pref.some((p) => jt.some((j) => j === p || j.includes(p) || p.includes(j)))
    return !anyMatch
}

/* ----------------------- deterministic extraction: profile constraints ----------------------- */
function extractProfileConstraints(profileText: string): ProfileConstraints {
    const t0 = normalizeText(profileText)

    const hardNoHourlyPay =
        t0.includes("no hourly") ||
        t0.includes("no hourly pay") ||
        (t0.includes("do not want") && t0.includes("hourly")) ||
        (t0.includes("hard constraint") && t0.includes("hourly"))

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
        (t0.includes("do not want") &&
            (t0.includes("government") || t0.includes("public sector"))) ||
        t0.includes("no government") ||
        t0.includes("governmental") ||
        t0.includes("public sector")

    const hardNoFullyRemote =
        t0.includes("no fully remote") ||
        (t0.includes("do not want") && t0.includes("fully remote"))

    const hardNoRemote =
        t0.includes("no remote") ||
        t0.includes("not remote") ||
        t0.includes("no wfh") ||
        t0.includes("in person only") ||
        (t0.includes("hard constraint") && t0.includes("no remote"))

    const hardNoAnalytics =
        t0.includes("no heavy analytical") ||
        t0.includes("no heavy analytics") ||
        t0.includes("no analytics") ||
        t0.includes("not analytical") ||
        t0.includes("avoid analyst") ||
        t0.includes("no data-heavy") ||
        t0.includes("not data focused") ||
        t0.includes("no statistics-heavy") ||
        t0.includes("no quantitative")

    const hardNoRelocation =
        t0.includes("no relocation") ||
        t0.includes("cannot relocate") ||
        t0.includes("won't relocate") ||
        t0.includes("will not relocate")

    const hardNoHeavyTravel =
        t0.includes("no travel") ||
        t0.includes("avoid travel") ||
        t0.includes("minimal travel only") ||
        t0.includes("no heavy travel")

    const hardNoNightsWeekends =
        t0.includes("no nights") ||
        t0.includes("no weekends") ||
        t0.includes("no weekend") ||
        (t0.includes("cannot") && t0.includes("weekends")) ||
        (t0.includes("cannot") && t0.includes("nights"))

    const preferredLocations = extractPreferredLocations(profileText)

    return {
        hardNoHourlyPay,
        prefFullTime,
        hardNoContract,
        hardNoSales,
        hardNoGovernment,
        hardNoFullyRemote,
        hardNoAnalytics,
        hardNoRemote,
        hardNoRelocation,
        hardNoHeavyTravel,
        hardNoNightsWeekends,
        preferredLocations,
    }
}

/* ----------------------- deterministic job family + role signals ----------------------- */
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
    )
        return "accounting_finance"

    if (
        /\b(media buying|media buy|programmatic|allocate marketing budget|media planning|media strategy)\b/.test(
            t
        )
    )
        return "brand_marketing_media"

    if (
        /\b(marketing analytics|marketing analyst|data analyst|business intelligence|bi\b|analytics intern|analyst intern)\b/.test(
            t
        )
    )
        return "marketing_analytics"

    if (
        /\b(customer success|client success|client engagement|implementation|onboarding|account manager)\b/.test(
            t
        )
    )
        return "customer_success"

    if (
        /\b(program manager|project manager|program management|project management|pm\b)\b/.test(t)
    )
        return "pm_program"

    if (
        /\b(strategy|operations|biz ops|business operations|strategic planning|operational)\b/.test(
            t
        )
    )
        return "strategy_ops"

    if (
        /\b(sales|business development|quota|commission|pipeline|lead gen|cold call)\b/.test(t)
    )
        return "sales"

    if (/\b(government|public sector|municipal|state agency|federal)\b/.test(t))
        return "government_public"

    return "unknown"
}

function profileTargetsAccounting(profileText: string) {
    const t = normalizeText(profileText)
    return /\b(accounting|accountant|ar\b|ap\b|bookkeeping|controller|general ledger|reconciliation)\b/.test(
        t
    )
}

/**
 * Heavy analytics should be HIGH PRECISION.
 * It should trigger for true analyst/data roles (e.g., "Marketing Analyst Intern"),
 * not for normal email marketing roles that mention "performance reports" or "A/B tests."
 */
function jobIsAnalyticsHeavy(jobText: string) {
    const t = normalizeText(jobText)

    // True analyst/analytics roles (high precision)
    const analystTitleSignal =
        /\b(marketing analyst|data analyst|business intelligence|bi analyst|analytics analyst|marketing analytics)\b/.test(
            t
        ) ||
        /\b(analyst intern|analytics intern)\b/.test(t)

    // Hard analytics tooling (not Excel / PowerPoint)
    const hardAnalyticsTools =
        /\b(sql|tableau|power bi|r\b|python\b)\b/.test(t)

    // Strong quant / modeling language
    const quantLanguage =
        /\b(statistics|statistical|quantitative|modeling|forecasting|regression|segmentation|a\/b testing methodology)\b/.test(
            t
        )

    // Analytics execution language (stronger than "analytical mindset")
    const analyticsOpsLanguage =
        /\b(dashboard|attribution|kpi|roi|incrementality|measurement framework|data pipeline|query)\b/.test(
            t
        )

    // Light marketing measurement language (should NOT auto-trigger heavy)
    const lightMeasurementOnly =
        /\b(email marketing|e-commerce|campaign|qa testing|creative assets|subject lines)\b/.test(
            t
        ) &&
        /\b(report|reporting|performance report|insights|trend)\b/.test(t) &&
        !analystTitleSignal &&
        !hardAnalyticsTools &&
        !quantLanguage &&
        !analyticsOpsLanguage

    if (lightMeasurementOnly) return false

    // Deterministic classification:
    if (analystTitleSignal) return true

    // If job requires hard analytics tools AND also has strong analytics language, treat as heavy
    if (hardAnalyticsTools && (quantLanguage || analyticsOpsLanguage)) return true

    // If it has both quant + analytics ops language, treat as heavy even without tool list
    if (quantLanguage && analyticsOpsLanguage) return true

    return false
}
/* ----------------------- deterministic eligibility: years + mba ----------------------- */
function extractRequiredYears(jobText: string): number | null {
    const t = normalizeText(jobText)

    const plus = t.match(/\b(\d{1,2})\s*\+\s*years?\b/)
    if (plus?.[1]) return Number(plus[1])

    const min = t.match(/\bminimum\s+(\d{1,2})\s*years?\b/)
    if (min?.[1]) return Number(min[1])

    const range = t.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*years?\b/)
    if (range?.[1]) return Number(range[1])

    const plain = t.match(/\b(\d{1,2})\s*years?\s+of\s+experience\b/)
    if (plain?.[1]) return Number(plain[1])

    return null
}

function profileLooksEarlyCareer(profileText: string) {
    const t = normalizeText(profileText)
    return (
        t.includes("class of") ||
        t.includes("expected graduation") ||
        t.includes("expected to graduate") ||
        t.includes("undergraduate") ||
        t.includes("b.s.") ||
        t.includes("b.a.") ||
        t.includes("bachelor") ||
        t.includes("student") ||
        t.includes("junior") ||
        t.includes("sophomore")
    )
}

function jobRequiresMBA(jobText: string) {
    const t = normalizeText(jobText)
    return /\bmba\b/.test(t) || t.includes("master of business administration")
}

function profileHasMBA(profileText: string) {
    const t = normalizeText(profileText)
    return /\bmba\b/.test(t) || t.includes("master of business administration")
}

/* ----------------------- graduation window (deterministic eligibility) ----------------------- */
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

/* ----------------------- tools (deterministic + aliases) ----------------------- */
function extractToolsFromJob(jobText: string) {
    const t = normalizeText(jobText)

    // curated: keep small and meaningful
    const toolCatalog = [
        "google analytics",
        "ga4",
        "asana",
        "sql",
        "tableau",
        "power bi",
        "r",
        "python",
        "excel",
        "powerpoint",
        "microsoft office",
        "google workspace",
    ]

    return toolCatalog.filter((tool) => t.includes(tool))
}
function jobRequiresEmailMarketing(jobText: string) {
  const t = normalizeText(jobText)
  return /\b(email campaigns?|email marketing|segments?|segmentation|customer lists?|a\/b tests?|subject lines?|deliverability|qa testing)\b/.test(t)
}

function profileShowsEmailMarketing(profileText: string) {
  const t = normalizeText(profileText)
  return /\b(email campaigns?|email marketing|mailchimp|klaviyo|hubspot|marketo|pardot|salesforce marketing cloud|sfmc|braze|customer\.io|campaign monitor)\b/.test(t)
}

function jobRequiresMeasurement(jobText: string) {
  const t = normalizeText(jobText)
  return /\b(performance reports?|identify trends?|insights?|campaign performance|marketing data|reporting|measurement|kpi|metrics)\b/.test(t)
}

function profileShowsMeasurement(profileText: string) {
  const t = normalizeText(profileText)
  return /\b(analytics|reporting|insights|metrics|kpi|measurement|dashboard|data analysis|google analytics|ga4|excel)\b/.test(t)
}

function profileMentionsTool(profileText: string, tool: string) {
    const t = normalizeText(profileText)
    const target = normalizeText(tool)

    // direct match
    if (t.includes(target)) return true

    // aliases and “implied coverage”
    const hasMsOffice =
        t.includes("microsoft office") || t.includes("ms office") || t.includes("office suite")
    if (hasMsOffice && (target === "excel" || target === "powerpoint")) return true

    const hasGoogleAnalytics = t.includes("google analytics")
    if (hasGoogleAnalytics && target === "ga4") return true

    const hasAdobeCC = t.includes("adobe creative cloud") || t.includes("adobe cc")
    if (
        hasAdobeCC &&
        (target === "photoshop" || target === "illustrator" || target === "indesign")
    )
        return true

    return false
}

function toolPenalty(missingCount: number) {
    if (missingCount <= 0) return 0
    if (missingCount === 1) return 3
    if (missingCount === 2) return 6
    if (missingCount === 3) return 9
    return 12
}

/* ----------------------- deterministic “constraint catalog” ----------------------- */
type ConstraintKey =
    | "no_hourly"
    | "no_contract"
    | "no_sales"
    | "no_government"
    | "no_remote"
    | "no_heavy_analytics"
    | "location_mismatch_constrained"

type ConstraintRule = {
    key: ConstraintKey
    kind: "force_pass" | "floor_review"
    match: (args: {
        jobText: string
        profileText: string
        jobFacts: JobFacts
        profile: ProfileConstraints
        locationConstraint: LocationConstraint
        jobLocationTokens: string[]
    }) => { matched: boolean; reason?: string }
}

const CONSTRAINT_RULES: ConstraintRule[] = [
    {
        key: "no_hourly",
        kind: "force_pass",
        match: ({ jobFacts, profile }) => {
            if (profile.hardNoHourlyPay && jobFacts.isHourly) {
                const ev = jobFacts.hourlyEvidence ? ` (${jobFacts.hourlyEvidence})` : ""
                return {
                    matched: true,
                    reason: `Job is hourly${ev}, and the candidate explicitly excluded hourly pay.`,
                }
            }
            return { matched: false }
        },
    },
    {
        key: "no_contract",
        kind: "force_pass",
        match: ({ jobFacts, profile }) => {
            if (profile.hardNoContract && jobFacts.isContract) {
                const ev = jobFacts.contractEvidence ? ` (signals: ${jobFacts.contractEvidence})` : ""
                return {
                    matched: true,
                    reason: `Role appears to be contract${ev}, and the candidate explicitly excluded contract/temporary work.`,
                }
            }
            return { matched: false }
        },
    },
    {
        key: "no_sales",
        kind: "force_pass",
        match: ({ jobText, profile }) => {
            if (!profile.hardNoSales) return { matched: false }
            if (inferJobFamily(jobText) === "sales") {
                return {
                    matched: true,
                    reason:
                        "Role appears to be sales/commission-focused, which the candidate explicitly excluded.",
                }
            }
            return { matched: false }
        },
    },
    {
        key: "no_government",
        kind: "force_pass",
        match: ({ jobText, profile }) => {
            if (!profile.hardNoGovernment) return { matched: false }
            if (inferJobFamily(jobText) === "government_public") {
                return {
                    matched: true,
                    reason:
                        "Role appears to be government/public sector, which the candidate explicitly excluded.",
                }
            }
            return { matched: false }
        },
    },
    {
        key: "no_remote",
        kind: "force_pass",
        match: ({ jobText, profile }) => {
            if (!profile.hardNoRemote) return { matched: false }
            if (jobIsFullyRemote(jobText)) {
                return {
                    matched: true,
                    reason: "Role is fully remote, and the candidate explicitly excluded remote roles.",
                }
            }
            return { matched: false }
        },
    },
    {
        key: "no_heavy_analytics",
        kind: "force_pass",
        match: ({ jobText, profile }) => {
            if (!profile.hardNoAnalytics) return { matched: false }
            if (jobIsAnalyticsHeavy(jobText)) {
                return {
                    matched: true,
                    reason:
                        "Role is analytics-heavy (analyst/data responsibilities), and the candidate explicitly excluded heavy analytical roles.",
                }
            }
            return { matched: false }
        },
    },
    {
        key: "location_mismatch_constrained",
        kind: "floor_review",
        match: ({ profile, locationConstraint, jobLocationTokens }) => {
            if (locationConstraint !== "constrained") return { matched: false }
            if (!profile.preferredLocations?.length) return { matched: false }
            if (!jobLocationTokens?.length) return { matched: false }

            const mismatched = locationPreferenceMismatch({
                profilePreferred: profile.preferredLocations,
                jobTokens: jobLocationTokens,
            })

            if (mismatched) {
                return {
                    matched: true,
                    reason: `Role appears location-constrained and is outside the candidate’s stated preferred locations (${profile.preferredLocations.join(
                        ", "
                    )}).`,
                }
            }

            return { matched: false }
        },
    },
]

/* ----------------------- gates (deterministic) ----------------------- */
function evaluateGates(args: {
    jobFacts: JobFacts
    profile: ProfileConstraints
    jobText: string
    profileText: string
    locationConstraint: LocationConstraint
    jobLocationTokens: string[]
}): Gate {
    const { jobFacts, profile, jobText, profileText, locationConstraint, jobLocationTokens } =
        args

    // 1) Force-pass first (hard exclusions)
    for (const rule of CONSTRAINT_RULES.filter((r) => r.kind === "force_pass")) {
        const res = rule.match({
            jobText,
            profileText,
            jobFacts,
            profile,
            locationConstraint,
            jobLocationTokens,
        })
        if (res.matched) return { type: "force_pass", reason: res.reason || "Hard constraint triggered." }
    }

    // 2) Non-candidate “hard mismatch” logic
    const fam = inferJobFamily(jobText)
    if (fam === "accounting_finance" && !profileTargetsAccounting(profileText)) {
        return {
            type: "force_pass",
            reason:
                "Role is accounting-focused, which does not match the candidate’s stated target roles.",
        }
    }

    // 3) Floor review next (soft gates)
    // Contract vs full-time preference floors to Review (unless hardNoContract already would have force-passed)
    if (profile.prefFullTime && jobFacts.isContract && !profile.hardNoContract) {
        const ev = jobFacts.contractEvidence ? ` (signals: ${jobFacts.contractEvidence})` : ""
        return {
            type: "floor_review",
            reason: `Role appears to be contract${ev}, and the candidate preference is full-time.`,
        }
    }

    // Location mismatch floor
    for (const rule of CONSTRAINT_RULES.filter((r) => r.kind === "floor_review")) {
        const res = rule.match({
            jobText,
            profileText,
            jobFacts,
            profile,
            locationConstraint,
            jobLocationTokens,
        })
        if (res.matched) return { type: "floor_review", reason: res.reason || "Constraint floors to Review." }
    }

    return { type: "none" }
}

/* ----------------------- weighted risk model ----------------------- */
function riskSeverityValue(sev: Severity) {
    if (sev === "severe") return 24
    if (sev === "high") return 14
    if (sev === "medium") return 8
    return 3
}

function riskTypeMultiplier(code: string) {
    // tooling gaps should not blow up decisioning
    if (code === "tooling_gap") return 0.7
    // location mismatch is more meaningful on constrained roles
    if (code === "location_mismatch") return 1.2
    // floor gate is informational but real
    if (code === "floor_review_gate") return 1.0
    return 1.0
if (code === "email_marketing_gap") return 1.0
if (code === "measurement_gap") return 0.8
}

function computeRiskPoints(risks: RiskSignal[]) {
    let points = 0
    let hasSevere = false
    let maxSeverity: Severity = "low"

    const rank = (s: Severity) =>
        s === "severe" ? 4 : s === "high" ? 3 : s === "medium" ? 2 : 1

    for (const r of risks) {
        const base = riskSeverityValue(r.severity)
        const mult = riskTypeMultiplier(r.code)
        points += base * mult
        if (r.severity === "severe") hasSevere = true
        if (rank(r.severity) > rank(maxSeverity)) maxSeverity = r.severity
    }

    return { points: Math.round(points), hasSevere, maxSeverity }
}

/* ----------------------- deterministic signals (why + risks) ----------------------- */
function buildSignals(args: {
    jobText: string
    profileText: string
    jobFacts: JobFacts
    profile: ProfileConstraints
    gate: Gate
    locationConstraint: LocationConstraint
    jobLocationTokens: string[]
}): { why: WhySignal[]; risks: RiskSignal[] } {
    const { jobText, profileText, jobFacts, profile, gate, locationConstraint, jobLocationTokens } =
        args

    const why: WhySignal[] = []
    const risks: RiskSignal[] = []

    const jt = normalizeText(jobText)
    const pt = normalizeText(profileText)

// RISKS: email marketing execution gap (only if job explicitly requires it)
if (jobRequiresEmailMarketing(jobText) && !profileShowsEmailMarketing(profileText)) {
  risks.push({
    code: "email_marketing_gap",
    severity: "medium",
    note: "Role is email marketing execution heavy (campaigns, segmentation, A/B tests), but the profile does not show direct email marketing experience or platforms.",
  })
}

// RISKS: measurement/reporting gap (analytics-light)
if (jobRequiresMeasurement(jobText) && !profileShowsMeasurement(profileText)) {
  risks.push({
    code: "measurement_gap",
    severity: "low",
    note: "Role includes recurring performance reporting and trend analysis; the profile does not show explicit reporting/measurement experience.",
  })
}


    // WHY: marketing/communications alignment
    if (/\b(brand marketing|brand|communications|creative strategy|advertising|campaign|email marketing|digital marketing|e-commerce)\b/.test(pt)) {
        why.push({
            code: "marketing_interest_alignment",
            note: "Profile targets brand marketing/communications and consumer-focused work.",
        })
    }

    // WHY: creative toolkit
    if (/\b(adobe|photoshop|illustrator|indesign|canva)\b/.test(pt)) {
        why.push({
            code: "creative_tools_strength",
            note: "Strong creative production toolkit (design and content creation).",
        })
    }

    // WHY: client + coordination
    if (/\b(client|stakeholder|coordina|presentation|deck|communications audit|strategy)\b/.test(pt)) {
        why.push({
            code: "client_comms_strength",
            note: "Relevant communication and client-facing execution experience (projects and coordination).",
        })
    }

    // RISKS: floor gate reason becomes a medium risk (still negative, but not auto-kill)
    if (gate.type === "floor_review" && gate.reason) {
        risks.push({
            code: "floor_review_gate",
            severity: "medium",
            note: gate.reason,
        })
    }

    // RISKS: location mismatch (only when we can prove it and role is constrained)
    if (
        locationConstraint === "constrained" &&
        profile.preferredLocations.length &&
        jobLocationTokens.length
    ) {
        const mismatched = locationPreferenceMismatch({
            profilePreferred: profile.preferredLocations,
            jobTokens: jobLocationTokens,
        })
        if (mismatched) {
            risks.push({
                code: "location_mismatch",
                severity: "high",
                note: `Location mismatch for a mostly in-office role (job location does not align with stated preferences: ${profile.preferredLocations.join(
                    ", "
                )}).`,
            })
        }
    }

    // RISKS: tooling gaps (deterministic)
    const tools = extractToolsFromJob(jobText)
    if (tools.length) {
        const missing = tools.filter((tool) => !profileMentionsTool(profileText, tool))
        if (missing.length) {
            const missingHardAnalytics = missing.some((m) =>
                ["google analytics", "ga4", "sql", "tableau", "power bi", "r", "python"].includes(
                    normalizeText(m)
                )
            )
            risks.push({
                code: "tooling_gap",
                severity: missingHardAnalytics ? "high" : "medium",
                note:
                    missing.length === 1
                        ? `Job mentions ${missing[0]}, but the profile does not show it.`
                        : `Job mentions tools not shown in the profile (${missing
                              .slice(0, 5)
                              .join(", ")}).`,
            })
        }
    }

    // RISKS: hourly/contract signals (if not hard-excluded)
    if (jobFacts.isHourly && !profile.hardNoHourlyPay) {
        risks.push({
            code: "hourly_signal",
            severity: "low",
            note: "Job signals hourly compensation.",
        })
    }

    if (jobFacts.isContract && profile.prefFullTime && !profile.hardNoContract) {
        risks.push({
            code: "contract_signal",
            severity: "medium",
            note: "Role appears contract/temporary while the candidate preference is full-time.",
        })
    }

    // Dedupe by code
    const seenR = new Set<string>()
    const cleanRisks: RiskSignal[] = []
    for (const r of risks) {
        const note = (r.note || "").trim()
        if (!note) continue
        if (seenR.has(r.code)) continue
        seenR.add(r.code)
        cleanRisks.push({ ...r, note })
    }

    const seenW = new Set<string>()
    const cleanWhy: WhySignal[] = []
    for (const w of why) {
        const note = (w.note || "").trim()
        if (!note) continue
        if (seenW.has(w.code)) continue
        seenW.add(w.code)
        cleanWhy.push({ ...w, note })
    }

    return { why: cleanWhy, risks: cleanRisks }
}


/* ----------------------- deterministic scoring ----------------------- */
function computeDeterministicScore(args: {
    jobText: string
    profileText: string
    jobFacts: JobFacts
    profile: ProfileConstraints
    gate: Gate
    locationConstraint: LocationConstraint
    jobLocationTokens: string[]
}): { score: number; explain: ScoreExplain[]; risks: RiskSignal[]; why: WhySignal[] } {
    const { jobText, profileText, jobFacts, profile, gate, locationConstraint, jobLocationTokens } =
        args

    let score = SCORE_MAX
    const explain: ScoreExplain[] = []

    // Eligibility mismatches (big hits)
    const mbaMismatch = jobRequiresMBA(jobText) && !profileHasMBA(profileText)
    if (mbaMismatch) {
        score -= 60
        explain.push({
            label: "MBA required mismatch",
            delta: -60,
            note: "Job requires an MBA but the profile does not show an MBA.",
        })
    }

    const reqYears = extractRequiredYears(jobText)
    const earlyCareer = profileLooksEarlyCareer(profileText)
    if (reqYears !== null && earlyCareer) {
        if (reqYears >= 4) {
            score -= 50
            explain.push({
                label: "Experience requirement mismatch (4+ years)",
                delta: -50,
                note: `Job asks for ${reqYears}+ years and the profile reads early-career.`,
            })
        } else if (reqYears >= 3) {
            score -= 35
            explain.push({
                label: "Experience requirement mismatch (3+ years)",
                delta: -35,
                note: `Job asks for ${reqYears}+ years and the profile reads early-career.`,
            })
        }
    }

    // Signals (deterministic)
    const signals = buildSignals({
        jobText,
        profileText,
        jobFacts,
        profile,
        gate,
        locationConstraint,
        jobLocationTokens,
    })

    // Small gate score impact (not forced-to-number behavior)
    if (gate.type === "floor_review") {
        score -= 6
        explain.push({
            label: "Floor review gate triggered",
            delta: -6,
            note: gate.reason,
        })
    }

    // Tool penalty is scored separately from risk points (so tools still differentiate Apply vs Apply)
    const tools = extractToolsFromJob(jobText)
    if (tools.length) {
        const missing = tools.filter((tool) => !profileMentionsTool(profileText, tool))
        const p = toolPenalty(missing.length)
        if (p > 0) {
            score -= p
            explain.push({
                label: "Tooling gap vs job",
                delta: -p,
                note:
                    missing.length === 1
                        ? `Missing tool signal: ${missing[0]}.`
                        : `Missing tool signals: ${missing.slice(0, 5).join(", ")}.`,
            })
        }
    }

    // Weighted risk points affect score (this creates real Review differentiation)
    const rp = computeRiskPoints(signals.risks)
    // Cap to keep scores sane, but still meaningful
    const riskPenalty = Math.min(rp.points, 42)
    if (riskPenalty > 0) {
        score -= riskPenalty
        explain.push({
            label: "Risk penalties applied",
            delta: -riskPenalty,
            note: "Score reduced based on weighted risk severity.",
        })
    }

    score = clampScore(score)
    score = Math.min(score, SCORE_MAX)

    // If any risks exist, score cannot remain at max
    if (signals.risks.length > 0 && score === SCORE_MAX) score = SCORE_MAX - 1

    return { score, explain, risks: signals.risks, why: signals.why }
}

/* ----------------------- deterministic decisioning ----------------------- */
function decideByScore(score: number): Decision {
    if (score >= APPLY_THRESHOLD) return "Apply"
    if (score >= REVIEW_THRESHOLD) return "Review"
    return "Pass"
}

function enforceDecisionConsistentScore(decision: Decision, score: number) {
    let s = clampScore(score)
    s = Math.min(s, SCORE_MAX)

    if (decision === "Pass") return Math.min(s, PASS_CAP)

    if (decision === "Review") {
        // keep differentiation: allow 60..79
        if (s >= APPLY_THRESHOLD) s = REVIEW_CAP_IF_FLOORED
        if (s < REVIEW_THRESHOLD) s = REVIEW_THRESHOLD
        return s
    }

    // Apply
    if (s < APPLY_THRESHOLD) s = APPLY_THRESHOLD
    return s
}

/* ----------------------- deterministic output builders ----------------------- */
function buildWhyBullets(whySignals: WhySignal[]) {
    const out: string[] = []
    for (const w of whySignals) {
        const s = (w.note || "").trim()
        if (!s) continue
        out.push(s)
        if (out.length >= 7) break
    }
    return out
}

function buildRiskBullets(riskSignals: RiskSignal[]) {
    const out: string[] = []
    for (const r of riskSignals) {
        const s = (r.note || "").trim()
        if (!s) continue
        out.push(s)
        if (out.length >= 6) break
    }
    return out
}

function buildPassReasons(args: {
    gate: Gate
    gradMismatchReason?: string | null
    deterministicExplain: ScoreExplain[]
    riskSignals: RiskSignal[]
}) {
    const { gate, gradMismatchReason, deterministicExplain, riskSignals } = args
    const out: string[] = []

    if (gate.type === "force_pass" && gate.reason) out.push(gate.reason)
    if (gradMismatchReason) out.push(gradMismatchReason)

    for (const r of riskSignals) {
        const s = (r.note || "").trim()
        if (!s) continue
        if (!out.includes(s)) out.push(s)
        if (out.length >= 6) break
    }

    if (out.length < 3) {
        for (const e of deterministicExplain) {
            if (e.delta >= 0) continue
            const s = (e.note || e.label || "").trim()
            if (!s) continue
            if (!out.includes(s)) out.push(s)
            if (out.length >= 6) break
        }
    }

    if (!out.length) {
        out.push("This role has a core mismatch with the candidate’s constraints or eligibility.")
    }

    return out.slice(0, 6)
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
    // deterministic fingerprint (internal)
    const _fp = stableFingerprint(jobText, profileText)
    void _fp
    void profileStructured

    const jobFacts = extractJobFacts(jobText)
    const profile = extractProfileConstraints(profileText)
    const location_constraint = inferLocationConstraint(jobText)
    const jobLocationTokens = jobExtractLocationTokens(jobText)

    // Graduation-window mismatch => PASS (deterministic)
    let gradMismatch = false
    let gradMismatchReason: string | null = null

    const gradWindow = extractGradWindow(jobText)
    const candGrad = extractCandidateGrad(profileText)

    if (gradWindow && candGrad) {
        const candIdx = ymToIndex(candGrad)
        const startIdx = ymToIndex(gradWindow.start)
        const endIdx = ymToIndex(gradWindow.end)
        const outside = candIdx < startIdx || candIdx > endIdx
        if (outside) {
            gradMismatch = true
            gradMismatchReason = `Graduation window mismatch (job requires ${formatYM(
                gradWindow.start
            )}–${formatYM(gradWindow.end)}; candidate appears to graduate ${formatYM(candGrad)}).`
        }
    }

    // Gates (deterministic)
    const gate = evaluateGates({
        jobFacts,
        profile,
        jobText,
        profileText,
        locationConstraint: location_constraint,
        jobLocationTokens,
    })

    // Hard PASS path
    if (gate.type === "force_pass" || gradMismatch) {
        const signals = buildSignals({
            jobText,
            profileText,
            jobFacts,
            profile,
            gate,
            locationConstraint: location_constraint,
            jobLocationTokens,
        })

        const det = computeDeterministicScore({
            jobText,
            profileText,
            jobFacts,
            profile,
            gate,
            locationConstraint: location_constraint,
            jobLocationTokens,
        })

        const passReasons = buildPassReasons({
            gate: gate.type === "force_pass" ? gate : { type: "none" },
            gradMismatchReason,
            deterministicExplain: det.explain,
            riskSignals: signals.risks,
        })

        return {
            decision: "Pass" as Decision,
            icon: iconForDecision("Pass"),
            score: PASS_CAP,
            bullets: [],
            risk_flags: passReasons.slice(0, 6),
            next_step:
                "It is recommended that you do not apply and focus your attention on more aligned positions.",
            location_constraint,
        }
    }

    // Deterministic scoring + signals
    const det = computeDeterministicScore({
        jobText,
        profileText,
        jobFacts,
        profile,
        gate,
        locationConstraint: location_constraint,
        jobLocationTokens,
    })

    // Initial decision from score
    let decision: Decision = decideByScore(det.score)

    // If job has a strict graduation window but grad date is unknown, never allow Apply
    if (gradWindow && !candGrad && decision === "Apply") decision = "Review"

    // Floor-review gate prevents Apply regardless of score
    if (gate.type === "floor_review" && decision === "Apply") decision = "Review"

    // Weighted-risk-based Apply downgrade (NOT “risk count”)
    const rp = computeRiskPoints(det.risks)

    if (decision === "Apply") {
        const hasCriticalCode = det.risks.some((r) => r.code === "location_mismatch")
        // Rule:
        // - any severe risk => Review
        // - riskPoints threshold => Review (weighted)
        // - critical code => Review
        // Tuning: 18 means “one high + a little” or “two medium-ish”
        if (rp.hasSevere || rp.points >= 18 || hasCriticalCode) {
            decision = "Review"
        }
    }

    // Final score consistent with decision, but not smashed to a fixed number
    let score = enforceDecisionConsistentScore(decision, det.score)

    // Output bullets deterministically
    const bullets = buildWhyBullets(det.why)
    const risk_flags = buildRiskBullets(det.risks)

    // If any risks are shown, score cannot be max
    if (risk_flags.length > 0 && score === SCORE_MAX) score = SCORE_MAX - 1

    // Pass path (should be rare here, since force-pass/grad mismatch already handled)
    if (decision === "Pass") {
        const passReasons = buildPassReasons({
            gate,
            gradMismatchReason: null,
            deterministicExplain: det.explain,
            riskSignals: det.risks,
        })

        return {
            decision,
            icon: iconForDecision(decision),
            score: PASS_CAP,
            bullets: [],
            risk_flags: passReasons.slice(0, 6),
            next_step:
                "It is recommended that you do not apply and focus your attention on more aligned positions.",
            location_constraint,
        }
    }

    const next_step =
        decision === "Review"
            ? "Review the risk flags carefully before proceeding."
            : "Apply promptly if this role is still open."

    return {
        decision,
        icon: iconForDecision(decision),
        score,
        bullets: bullets.slice(0, 8),
        risk_flags: risk_flags.slice(0, 6),
        next_step,
        location_constraint,
    }
}