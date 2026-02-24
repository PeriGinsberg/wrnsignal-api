// app/api/_lib/jobfitEvaluator.ts
import OpenAI from "openai"
import crypto from "crypto"

/**
 * WRNSignal JobFit Evaluator — deterministic-first
 *
 * Non-negotiables enforced:
 * - Deterministic gates + hard exclusions override everything
 * - LLM is NOT used for decision/scoring (and not required for bullets)
 * - Score is truly deterministic, differentiated, never 100 (max 97)
 * - If any risks exist, score cannot remain at max
 * - Risks never include pros; Why never includes risk language
 * - If Pass, output only pass reasons (no positives)
 * - Output shape is stable for frontend
 */

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) // kept for optional future use

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

    // generalized “infinite constraints” pattern (start with the ones that matter)
    hardNoAnalytics: boolean
    hardNoRemote: boolean // “No Remote. OK hybrid/in-person.”
    hardNoRelocation: boolean
    hardNoHeavyTravel: boolean
    hardNoNightsWeekends: boolean

    // location preferences (used for deterministic floor_review on constrained roles)
    preferredLocations: string[] // normalized tokens like "new york", "boston", "philadelphia", "washington dc"
    preferredRegions: string[] // coarse: "northeast", "midatlantic", etc (optional)
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

/* ----------------------- score policy ----------------------- */
const SCORE_MAX = 97 // never output 100
const APPLY_THRESHOLD = 80
const REVIEW_THRESHOLD = 60
const REVIEW_CAP_IF_FLOORED = 79
const PASS_CAP = 59

/* ----------------------- basic helpers ----------------------- */
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
    // integer scores only
    return Math.max(0, Math.min(100, Math.round(x)))
}

function iconForDecision(decision: Decision) {
    if (decision === "Apply") return "✅"
    if (decision === "Review") return "⚠️"
    return "⛔"
}

function stableFingerprint(jobText: string, profileText: string) {
    // Deterministic fingerprint for caching and stability (not returned to frontend to avoid shape drift)
    const a = normalizeText(jobText)
    const b = normalizeText(profileText)
    return crypto.createHash("sha256").update(a + "\n---\n" + b).digest("hex")
}

function ensureArrayOfStrings(x: any, max: number) {
    if (!Array.isArray(x)) return []
    return x
        .map((v) => String(v ?? "").trim())
        .filter(Boolean)
        .slice(0, max)
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
        /\boffice\b/.test(t) // “work in our Irvine office”
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

    // common “<City>, <State>” patterns
    const cityState =
        t.match(/\b([a-z]+(?:\s+[a-z]+){0,2})\s*,\s*(ca|ny|ma|pa|nj|oh|dc|va|md)\b/) ||
        t.match(/\bin\s+([a-z]+(?:\s+[a-z]+){0,2})\s*,\s*(ca|ny|ma|pa|nj|oh|dc|va|md)\b/)
    if (cityState?.[1] && cityState?.[2]) {
        out.push(cityState[1].trim())
        out.push(cityState[2].trim())
    }

    // “in our Irvine, California office” style
    const officeLoc = t.match(/\bin\s+our\s+([a-z]+(?:\s+[a-z]+){0,2})\s*,\s*(california|new york|massachusetts|pennsylvania)\s+office\b/)
    if (officeLoc?.[1] && officeLoc?.[2]) {
        out.push(officeLoc[1].trim())
        out.push(officeLoc[2].trim())
    }

    // state mentions
    for (const [abbr, names] of Object.entries(STATE_ALIASES)) {
        if (names.some((n) => t.includes(n))) out.push(abbr)
    }

    // city mentions
    for (const [canonical, aliases] of Object.entries(CITY_ALIASES)) {
        if (aliases.some((a) => t.includes(a))) out.push(canonical)
    }

    return unique(out)
}

function locationPreferenceMismatch(args: {
    profilePreferred: string[]
    jobTokens: string[]
}): boolean {
    const { profilePreferred, jobTokens } = args
    const pref = profilePreferred.map((s) => normalizeText(s))
    const jt = jobTokens.map((s) => normalizeText(s))

    if (!pref.length) return false
    if (!jt.length) return false // if job location truly unknown, do not enforce mismatch

    // If any preferred token matches any job token, treat as not mismatched.
    // Otherwise mismatched.
    const anyMatch = pref.some((p) => jt.some((j) => j === p || j.includes(p) || p.includes(j)))
    return !anyMatch
}

/* ----------------------- deterministic extraction: profile constraints ----------------------- */
function extractPreferredLocations(profileText: string): string[] {
    const t = normalizeText(profileText)

    // capture explicit “Wants to be in …” lists if present
    const wants = t.match(/\b(wants to be in|prefer(?:s)?|preferred|target(?:s)?)\b[\s:]{0,10}([a-z,\.\s]+)\b/)
    const fragment = wants?.[2] ? wants[2].slice(0, 140) : ""

    const tokens: string[] = []

    // canonical city detection (from either full profile or fragment)
    const hay = fragment ? fragment + " " + t : t
    for (const [canonical, aliases] of Object.entries(CITY_ALIASES)) {
        if (aliases.some((a) => hay.includes(a))) tokens.push(canonical)
    }

    // also allow raw tokens “ny”, “boston”, etc
    if (hay.includes("nyc")) tokens.push("new york")
    if (hay.includes("new york")) tokens.push("new york")
    if (hay.includes("boston")) tokens.push("boston")
    if (hay.includes("philadelphia") || hay.includes("philly")) tokens.push("philadelphia")
    if (hay.includes("washington")) tokens.push("washington dc")
    if (hay.includes("d.c.")) tokens.push("washington dc")

    return unique(tokens)
}

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
        (t0.includes("do not want") && (t0.includes("government") || t0.includes("public sector"))) ||
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
    const preferredRegions: string[] = [] // reserved (keep stable, do not invent)

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
        preferredRegions,
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
        /\b(media buying|media buy|brand awareness media|tv\b|billboards?|podcasts?|radio|placements?|allocate marketing budget)\b/.test(
            t
        )
    )
        return "brand_marketing_media"

    if (
        /\b(marketing analytics|marketing analyst|analyst intern|campaign outcome measurement|measurement and reporting|consumer data|market data|insights|dashboards?)\b/.test(
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
        /\b(program manager|project manager|program management|project management|pm\b)\b/.test(
            t
        )
    )
        return "pm_program"

    if (
        /\b(strategy|operations|biz ops|business operations|strategic planning|operational|strategic partnerships)\b/.test(
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

function jobIsAnalyticsHeavy(jobText: string) {
    const t = normalizeText(jobText)

    const strongRole = /\b(analyst|analytics|measurement|reporting|dashboards?|insights)\b/.test(t)
    const dataVerbs = /\b(analy[sz]e|analysis|measure|track|report|evaluate|metrics?|kpi|roi)\b/.test(t)
    const dataNouns = /\b(market data|consumer data|data collection|data-driven|statistics|quantitative)\b/.test(t)
    const tools = /\b(google analytics|ga4|sql|tableau|power bi|r\b|python\b)\b/.test(t)

    // high precision: require at least two categories of signal
    const buckets = [strongRole, dataVerbs, dataNouns, tools].filter(Boolean).length
    return buckets >= 2
}

function profileTargetsAccounting(profileText: string) {
    const t = normalizeText(profileText)
    return /\b(accounting|accountant|ar\b|ap\b|bookkeeping|controller|general ledger|reconciliation)\b/.test(
        t
    )
}

function profilePrefersCreativeOverAnalytics(profileText: string) {
    const t = normalizeText(profileText)
    const creative = /\b(creative strategy|creative|graphic design|visual design|photography|storytelling|brand messaging|communications|pr|media relations)\b/.test(
        t
    )
    const quant = /\b(statistics|quantitative|data analysis|sql|tableau|power bi|r\b|python\b)\b/.test(
        t
    )
    return creative && !quant
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

    const y = t.match(
        /\b(graduate|graduating|graduation)\b[^\d]{0,20}\b(20\d{2})\b/i
    )
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

/* ----------------------- deterministic “constraint catalog” (scales) ----------------------- */
type ConstraintKey =
    | "no_hourly"
    | "no_contract"
    | "no_sales"
    | "no_government"
    | "no_fully_remote"
    | "no_remote"
    | "no_heavy_analytics"
    | "no_relocation"
    | "no_heavy_travel"
    | "no_nights_weekends"
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
            const fam = inferJobFamily(jobText)
            if (fam === "sales") {
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
            const fam = inferJobFamily(jobText)
            if (fam === "government_public") {
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
        key: "no_heavy_analytics",
        kind: "force_pass",
        match: ({ jobText, profile }) => {
            if (!profile.hardNoAnalytics) return { matched: false }
            if (jobIsAnalyticsHeavy(jobText)) {
                return {
                    matched: true,
                    reason:
                        "Role is analytics/measurement-heavy (analyst-style responsibilities), and the candidate explicitly excluded heavy analytical roles.",
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
                    reason:
                        "Role is fully remote, and the candidate explicitly excluded remote roles.",
                }
            }
            return { matched: false }
        },
    },
    {
        key: "no_fully_remote",
        kind: "floor_review",
        match: ({ jobText, profile }) => {
            if (!profile.hardNoFullyRemote) return { matched: false }
            if (jobIsFullyRemote(jobText)) {
                return {
                    matched: true,
                    reason:
                        "Role is fully remote, and the candidate prefers not to be fully remote.",
                }
            }
            return { matched: false }
        },
    },
    {
        key: "location_mismatch_constrained",
        kind: "floor_review",
        match: ({ profile, locationConstraint, jobLocationTokens }) => {
            // only enforce a mismatch if:
            // - candidate provided preferred locations, and
            // - job appears constrained (hybrid/onsite), and
            // - job location tokens are known, and
            // - no overlap
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
        if (res.matched) {
            return { type: "force_pass", reason: res.reason || "Hard constraint triggered." }
        }
    }

    // 2) Existing deterministic mismatch gates that are not “candidate constraint” phrased
    const fam = inferJobFamily(jobText)

    if (fam === "accounting_finance" && !profileTargetsAccounting(profileText)) {
        return {
            type: "force_pass",
            reason:
                "Role is accounting-focused, which does not match the candidate’s stated target roles.",
        }
    }

    if (fam === "brand_marketing_media") {
        // media-buying roles need explicit paid media signals
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
                reason:
                    "Role is media buying/budget allocation focused, but the profile does not show direct paid media or media buying experience.",
            }
        }
    }

    // 3) Floor-review rules next
    // Contract vs full-time preference is not a hard exclusion, but floors to Review
    if (profile.prefFullTime && jobFacts.isContract && !profile.hardNoContract) {
        const ev = jobFacts.contractEvidence ? ` (signals: ${jobFacts.contractEvidence})` : ""
        return {
            type: "floor_review",
            reason: `Role appears to be contract${ev}, and the candidate preference is full-time.`,
        }
    }

    // Candidate prefers not fully remote (soft floor)
    for (const rule of CONSTRAINT_RULES.filter((r) => r.kind === "floor_review")) {
        const res = rule.match({
            jobText,
            profileText,
            jobFacts,
            profile,
            locationConstraint,
            jobLocationTokens,
        })
        if (res.matched) {
            return { type: "floor_review", reason: res.reason || "Constraint floors to Review." }
        }
    }

    return { type: "none" }
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

/* ----------------------- tools (deterministic) ----------------------- */
function extractToolsFromJob(jobText: string) {
    const t = normalizeText(jobText)

    // curated list: only include what you actually care about in scoring
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
        "microsoft office",
        "google workspace",
    ]

    return toolCatalog.filter((tool) => t.includes(tool))
}

function profileMentionsTool(profileText: string, tool: string) {
    const t = normalizeText(profileText)
    return t.includes(tool)
}

function toolPenalty(missingCount: number) {
    // deterministic, monotonic, capped
    if (missingCount <= 0) return 0
    if (missingCount === 1) return 3
    if (missingCount === 2) return 6
    if (missingCount === 3) return 9
    return 12
}

/* ----------------------- deterministic risk/why signals ----------------------- */
function severityPenalty(sev: Severity) {
    if (sev === "severe") return 18
    if (sev === "high") return 12
    if (sev === "medium") return 7
    return 3
}

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

    const fam = inferJobFamily(jobText)
    const analyticsHeavy = jobIsAnalyticsHeavy(jobText)

    // WHY signals (positives)
    if (fam === "marketing_analytics" || fam === "brand_marketing_media" || fam === "unknown") {
        if (/\b(marketing|brand|communications|creative strategy|advertising|campaign)\b/.test(
            normalizeText(profileText)
        )) {
            why.push({
                code: "marketing_interest_alignment",
                note: "Profile targets brand marketing/communications and consumer-focused work.",
            })
        }
    }

    if (/\b(adobe|photoshop|illustrator|indesign|canva)\b/.test(normalizeText(profileText))) {
        why.push({
            code: "creative_tools_strength",
            note: "Strong creative production toolkit (design and content creation).",
        })
    }

    if (/\b(client|stakeholder|presentation|deck|communications audit|strategy)\b/.test(
        normalizeText(profileText)
    )) {
        why.push({
            code: "client_comms_strength",
            note: "Relevant communication and client-facing execution experience (projects and coordination).",
        })
    }

    // RISK signals (gaps/constraints) — strictly negative phrasing
    // Gate is handled elsewhere, but can still create risks for non-PASS paths
    if (gate.type === "floor_review" && gate.reason) {
        risks.push({ code: "floor_review_gate", severity: "medium", note: gate.reason })
    }

    // Location mismatch for constrained roles (if not already a floor reason)
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

    // Analytics mismatch (soft risk) when candidate prefers creative and job is analytics-heavy
    // Note: if profile.hardNoAnalytics is true, this job would already be force-pass.
    if (!profile.hardNoAnalytics && analyticsHeavy && profilePrefersCreativeOverAnalytics(profileText)) {
        risks.push({
            code: "analytics_heavy_role",
            severity: "high",
            note: "Role is measurement/analysis-heavy, but the profile emphasizes creative strengths with limited quantitative evidence.",
        })
    }

    // Tooling gaps
    const tools = extractToolsFromJob(jobText)
    if (tools.length) {
        const missing = tools.filter((tool) => !profileMentionsTool(profileText, tool))
        if (missing.length) {
            // severity by how central these tools are
            const hasAnalyticsTools = missing.some((m) =>
                ["google analytics", "ga4", "sql", "tableau", "power bi", "r", "python"].includes(m)
            )
            risks.push({
                code: "tooling_gap",
                severity: hasAnalyticsTools ? "high" : "medium",
                note:
                    missing.length === 1
                        ? `Job mentions ${missing[0]}, but the profile does not show it.`
                        : `Job mentions tools not shown in the profile (${missing.slice(0, 5).join(", ")}).`,
            })
        }
    }

    // Hourly/contract signals (if not hard-excluded)
    if (jobFacts.isHourly && !profile.hardNoHourlyPay) {
        risks.push({
            code: "hourly_signal",
            severity: "low",
            note: "Job signals hourly compensation, which may be less aligned with typical internship expectations.",
        })
    }

    if (jobFacts.isContract && profile.prefFullTime && !profile.hardNoContract) {
        risks.push({
            code: "contract_signal",
            severity: "medium",
            note: "Role appears contract/temporary while the candidate preference is full-time.",
        })
    }

    // De-dupe by code (keep first)
    const seenRisk = new Set<string>()
    const cleanRisks: RiskSignal[] = []
    for (const r of risks) {
        if (!r?.note) continue
        if (seenRisk.has(r.code)) continue
        seenRisk.add(r.code)
        cleanRisks.push(r)
    }

    const seenWhy = new Set<string>()
    const cleanWhy: WhySignal[] = []
    for (const w of why) {
        if (!w?.note) continue
        if (seenWhy.has(w.code)) continue
        seenWhy.add(w.code)
        cleanWhy.push(w)
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

    // Eligibility mismatches (heavy penalties)
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

    // Build deterministic signals (also used to generate bullets)
    const signals = buildSignals({
        jobText,
        profileText,
        jobFacts,
        profile,
        gate,
        locationConstraint,
        jobLocationTokens,
    })

    // Gate effects on score (deterministic, but not “forced to a number”)
    // force_pass is handled outside; floor_review caps later if needed.
    if (gate.type === "floor_review") {
        score -= 6
        explain.push({
            label: "Floor review gate triggered",
            delta: -6,
            note: gate.reason,
        })
    }

    // Tool penalty (deterministic)
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

    // Risk penalties by severity (this is what makes Review scores differentiate)
    // These penalties are deterministic and come from deterministic risk signals.
    // IMPORTANT: if any risks exist, score cannot remain at max.
    let riskPenalty = 0
    for (const r of signals.risks) riskPenalty += severityPenalty(r.severity)

    // cap risk penalty so it doesn't become absurd, but keep it meaningful
    riskPenalty = Math.min(riskPenalty, 42)

    if (riskPenalty > 0) {
        score -= riskPenalty
        explain.push({
            label: "Risk penalties applied",
            delta: -riskPenalty,
            note: "Score reduced based on number and severity of deterministic risks.",
        })
    }

    // Work-structure penalties (distinct from “risk list” to keep scoring richer)
    if (profile.prefFullTime && jobFacts.isContract) {
        score -= 8
        explain.push({
            label: "Contract vs full-time preference",
            delta: -8,
            note: "Role appears contract while candidate prefers full-time.",
        })
    }

    if (profile.hardNoFullyRemote && jobIsFullyRemote(jobText)) {
        score -= 10
        explain.push({
            label: "Fully remote preference mismatch",
            delta: -10,
            note: "Role is fully remote and candidate prefers not fully remote.",
        })
    }

    if (jobFacts.isHourly && !profile.hardNoHourlyPay) {
        score -= 10
        explain.push({
            label: "Hourly compensation signal",
            delta: -10,
            note: "Job signals hourly compensation.",
        })
    }

    // Final clamp and invariants
    score = clampScore(score)
    score = Math.min(score, SCORE_MAX)

    // Hard invariant: if any risks exist, score must be below max
    if (signals.risks.length > 0 && score === SCORE_MAX) score = SCORE_MAX - 1

    return { score, explain, risks: signals.risks, why: signals.why }
}

/* ----------------------- deterministic decisioning ----------------------- */
function decideFinal(args: {
    baseDecision: Decision
    score: number
    gate: Gate
    gradMismatch: boolean
}): Decision {
    const { baseDecision, score, gate, gradMismatch } = args

    if (gate.type === "force_pass") return "Pass"
    if (gradMismatch) return "Pass"

    // score-based default
    let d: Decision = "Review"
    if (score >= APPLY_THRESHOLD) d = "Apply"
    else if (score >= REVIEW_THRESHOLD) d = "Review"
    else d = "Pass"

    // floor_review gate prevents Apply regardless of score
    if (gate.type === "floor_review" && d === "Apply") d = "Review"

    // baseDecision (from other logic) can only push down, not up
    // (kept for future extension; currently unused)
    if (baseDecision === "Pass") return "Pass"
    if (baseDecision === "Review" && d === "Apply") return "Review"

    return d
}

function enforceDecisionConsistentScore(decision: Decision, score: number, gate: Gate) {
    let s = clampScore(score)
    s = Math.min(s, SCORE_MAX)

    if (decision === "Pass") return Math.min(s, PASS_CAP)

    if (decision === "Review") {
        // DO NOT smash to a single number.
        // Only cap if it would look like Apply.
        if (s >= APPLY_THRESHOLD) s = REVIEW_CAP_IF_FLOORED
        if (s < REVIEW_THRESHOLD) s = REVIEW_THRESHOLD
        return s
    }

    // Apply
    if (s < APPLY_THRESHOLD) s = APPLY_THRESHOLD
    return s
}

/* ----------------------- deterministic output hygiene ----------------------- */
function buildWhyBullets(whySignals: WhySignal[]) {
    // only positives; no hedging/risk language
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
    // only negatives; no “but positive” language
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

    // Prefer explicit risk signals (they are negative by construction)
    for (const r of riskSignals) {
        const s = (r.note || "").trim()
        if (!s) continue
        if (!out.includes(s)) out.push(s)
        if (out.length >= 6) break
    }

    // Fall back to negative explain notes
    if (out.length < 3) {
        for (const e of deterministicExplain) {
            if (e.delta >= 0) continue
            const line = (e.note || e.label || "").trim()
            if (!line) continue
            if (!out.includes(line)) out.push(line)
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
    // fingerprint exists for deterministic stability/caching (kept internal)
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
    } else if (gradWindow && !candGrad) {
        // strict window exists but we cannot confirm grad date => do not allow Apply later
        // handled by floor_review via score cap logic (we keep it deterministic)
    }

    // Gates (deterministic, catalog-driven)
    const gate = evaluateGates({
        jobFacts,
        profile,
        jobText,
        profileText,
        locationConstraint: location_constraint,
        jobLocationTokens,
    })

    // Force PASS path immediately
    if (gate.type === "force_pass" || gradMismatch) {
        // build deterministic signals to populate pass reasons
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

    // Base decision solely by deterministic policy
    // (baseDecision is reserved for future deterministic layers; keep as "Review" default)
    const baseDecision: Decision = "Review"

    let decision = decideFinal({
        baseDecision,
        score: det.score,
        gate,
        gradMismatch: false,
    })

    // If job has a strict graduation window but grad date is unknown, never allow Apply
    if (gradWindow && !candGrad && decision === "Apply") decision = "Review"

    // Generate strictly-separated bullets deterministically (no LLM needed)
    let bullets = buildWhyBullets(det.why)
    let risk_flags = buildRiskBullets(det.risks)

    // Enforce hygiene: Apply should be clean. If multiple high/severe risks exist, push to Review.
    if (decision === "Apply") {
        const highOrSevere = det.risks.filter((r) => r.severity === "high" || r.severity === "severe")
        if (highOrSevere.length >= 1 || det.risks.length >= 2) {
            decision = "Review"
        }
    }

    // Final score must be consistent with final decision, but not smashed to a single number.
    let score = enforceDecisionConsistentScore(decision, det.score, gate)

    // Hard invariant: any displayed risks must prevent score from remaining at max
    if (risk_flags.length > 0 && score === SCORE_MAX) score = SCORE_MAX - 1

    // If Pass, show only pass reasons (no positives)
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

    // Keep output shape stable for frontend
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