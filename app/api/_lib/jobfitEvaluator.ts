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
    const cleaned = raw.replace(/(?:json)?/g, "").replace(/```/g, "").trim()

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

function decisionRank(d: Decision) {
    if (d === "Pass") return 0
    if (d === "Review") return 1
    return 2
}

function minDecision(a: Decision, b: Decision): Decision {
    return decisionRank(a) <= decisionRank(b) ? a : b
}

function enforceScoreBand(decision: Decision, score: number) {
    if (decision === "Apply") return Math.max(score, 75)
    if (decision === "Review") return Math.min(Math.max(score, 60), 74)
    return Math.min(score, 59)
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
        (t0.includes("do not want") &&
            (t0.includes("sales") || t0.includes("commission"))) ||
        t0.includes("no sales") ||
        t0.includes("no commission") ||
        t0.includes("commission-based")

    const hardNoGovernment =
        (t0.includes("do not want") &&
            (t0.includes("government") || t0.includes("governmental"))) ||
        t0.includes("no government") ||
        t0.includes("governmental")

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
        /\b(marketing analytics|marketing analyst|junior marketing analyst|digital marketing performance|campaign performance|return on ad spend|roas|meta ads|google ads|linkedin ads)\b/.test(
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
        /\b(sales|business development|quota|commission|pipeline|lead gen|cold call)\b/.test(
            t
        )
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

function jobIsFullyRemote(jobText: string) {
    const t = normalizeText(jobText)
    return /\bfully remote|100% remote|remote only|work from home\b/.test(t)
}

function jobMentionsHybridOrOnsite(jobText: string) {
    const t = normalizeText(jobText)
    return (
        /\bhybrid\b/.test(t) ||
        /\bon-?site\b/.test(t) ||
        /\bin office\b/.test(t) ||
        /\b3 days onsite\b/.test(t) ||
        /\b4 days onsite\b/.test(t)
    )
}

function inferLocationConstraint(jobText: string): LocationConstraint {
    if (jobIsFullyRemote(jobText)) return "not_constrained"
    if (jobMentionsHybridOrOnsite(jobText)) return "constrained"
    return "unclear"
}

/* ----------------------- gates ----------------------- */
function evaluateGates(
    job: JobFacts,
    profile: ProfileConstraints,
    jobText: string,
    profileText: string
): Gate {
    if (profile.hardNoHourlyPay && job.isHourly) {
        const ev = job.hourlyEvidence ? `(${job.hourlyEvidence})` : ""
        return {
            type: "force_pass",
            reason: `Job is hourly${ev}, and the candidate explicitly said no hourly pay.`,
        }
    }

    if (profile.prefFullTime && job.isContract && !profile.hardNoContract) {
        const ev = job.contractEvidence ? `(signals: ${job.contractEvidence})` : ""
        return {
            type: "floor_review",
            reason: `Role appears to be contract${ev}, and the candidate preference is full-time.`,
        }
    }

    const fam = inferJobFamily(jobText)

    if (profile.hardNoSales && fam === "sales") {
        return {
            type: "force_pass",
            reason:
                "Role appears to be sales/commission-focused, which the candidate explicitly excluded.",
        }
    }

    if (profile.hardNoGovernment && fam === "government_public") {
        return {
            type: "force_pass",
            reason:
                "Role appears to be government/public sector, which the candidate explicitly excluded.",
        }
    }

    if (fam === "accounting_finance" && !profileTargetsAccounting(profileText)) {
        return {
            type: "force_pass",
            reason:
                "Role is accounting-focused, which does not match the candidate’s stated target roles.",
        }
    }

    if (profile.hardNoFullyRemote && jobIsFullyRemote(jobText)) {
        return {
            type: "floor_review",
            reason:
                "Role is explicitly fully remote, and the candidate prefers not to be fully remote for their first job.",
        }
    }

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
                reason:
                    "Role is media buying/budget allocation focused, but the profile does not show direct paid media or media buying experience.",
            }
        }
    }

    return { type: "none" }
}

/* ----------------------- deterministic eligibility: graduation window ----------------------- */
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

/* ----------------------- deterministic scoring (NO LLM) ----------------------- */
type ScoreExplain = { label: string; delta: number; note?: string }

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
        t.includes("student")
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

function computeDeterministicScore(args: {
    jobText: string
    profileText: string
    jobFacts: JobFacts
    profileConstraints: ProfileConstraints
}): { score: number; decisionByScore: Decision; explain: ScoreExplain[] } {
    const { jobText, profileText, jobFacts, profileConstraints } = args

    // Start at 97 and never exceed 97
    let score = 97
    const explain: ScoreExplain[] = []

    const fam = inferJobFamily(jobText)

    const mbaMismatch = jobRequiresMBA(jobText) && !profileHasMBA(profileText)
    if (mbaMismatch) {
        score -= 60
        explain.push({
            label: "MBA required mismatch",
            delta: -60,
            note: "Job requires MBA but profile does not show MBA.",
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
                note: `Job asks for ${reqYears}+ years and profile reads early-career.`,
            })
        } else if (reqYears >= 3) {
            score -= 35
            explain.push({
                label: "Experience requirement mismatch (3+ years)",
                delta: -35,
                note: `Job asks for ${reqYears}+ years and profile reads early-career.`,
            })
        }
    }

    if (fam === "accounting_finance" && !profileTargetsAccounting(profileText)) {
        score -= 45
        explain.push({
            label: "Job family mismatch",
            delta: -45,
            note: "Accounting-focused role vs non-accounting target profile.",
        })
    }

    if (profileConstraints.prefFullTime && jobFacts.isContract) {
        score -= 12
        explain.push({
            label: "Contract vs full-time preference",
            delta: -12,
            note: "Role appears contract and candidate prefers full-time.",
        })
    }

    if (profileConstraints.hardNoFullyRemote && jobIsFullyRemote(jobText)) {
        score -= 12
        explain.push({
            label: "Fully remote constraint",
            delta: -12,
            note: "Role is fully remote and candidate prefers not fully remote.",
        })
    }

    if (jobFacts.isHourly && !profileConstraints.hardNoHourlyPay) {
        score -= 18
        explain.push({
            label: "Hourly compensation signal",
            delta: -18,
            note: "Job signals hourly compensation.",
        })
    }

    score = clampScore(score)
    score = Math.min(score, 97)

    const totalPenalty = explain.reduce((sum, e) => sum + Math.min(0, e.delta), 0)
    const hasMajorPenalty = explain.some((e) => e.delta <= -35)

    if (mbaMismatch || totalPenalty <= -75) {
        return { score: Math.min(score, 59), decisionByScore: "Pass", explain }
    }

    if (hasMajorPenalty) {
        const cappedScore = Math.min(Math.max(score, 60), 74)
        return { score: cappedScore, decisionByScore: "Review", explain }
    }

    // No deterministic penalties: Apply (subject to later risk-based downgrade)
    return { score, decisionByScore: "Apply", explain }
}

/* ----------------------- display-risk penalty + separation ----------------------- */
function applyDisplayedRiskPenalty(baseScore: number, risks: string[]) {
    let score = baseScore

    if (risks.length > 0) {
        // If any risks exist, it is not a near-perfect fit
        score = Math.min(score, 96)

        // Additional penalty by count
        const extra = Math.min(risks.length, 5) * 2 // 2..10
        score -= extra
    }

    score = clampScore(score)
    score = Math.min(score, 97) // never 100, never above 97
    return score
}

function looksLikeRisk(line: string) {
    const s = (line || "").trim().toLowerCase()
    if (!s) return false

    const riskCues = [
        "risk",
        "concern",
        "may",
        "might",
        "could",
        "lack",
        "lacks",
        "missing",
        "no explicit",
        "no mention",
        "not shown",
        "limited",
        "gap",
        "unclear",
        "however",
        "but",
        "would be a challenge",
        "preferred",
        "requires",
    ]

    const locationCues = [
        "location preference",
        "commute",
        "relocation",
        "hybrid",
        "in-office",
        "in office",
        "onsite",
        "on-site",
    ]

    return riskCues.some((c) => s.includes(c)) || locationCues.some((c) => s.includes(c))
}

function separateWhyAndRisks(why: string[], risks: string[]) {
    const cleanWhy: string[] = []
    const cleanRisks: string[] = []

    for (const r of risks || []) {
        const t = String(r || "").trim()
        if (t) cleanRisks.push(t)
    }

    for (const w of why || []) {
        const t = String(w || "").trim()
        if (!t) continue
        if (looksLikeRisk(t)) cleanRisks.push(t)
        else cleanWhy.push(t)
    }

    const dedupe = (arr: string[]) => Array.from(new Set(arr))
    return {
        why: dedupe(cleanWhy).slice(0, 8),
        risks: dedupe(cleanRisks).slice(0, 6),
    }
}

function riskIsSevere(r: string) {
    const s = (r || "").toLowerCase()
    return (
        s.includes("lack of direct") ||
        s.includes("no direct experience") ||
        s.includes("missing") ||
        s.includes("no experience") ||
        (s.includes("requires") && (s.includes("experience") || s.includes("tool") || s.includes("platform"))) ||
        s.includes("graduation window") ||
        s.includes("not eligible")
    )
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
            s.includes("reasonable commuting distance") ||
            s.includes("within commuting distance") ||
            s.includes("miles away") ||
            s.includes("distance") ||
            s.includes("not local") ||
            s.includes("local presence") ||
            s.includes("must be local") ||
            s.includes("onsite presence required") ||
            s.includes("hybrid location requirement") ||
            s.includes("location mismatch") ||
            s.includes("location preference mismatch")
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

function stripPositiveOrNeutralWhy(items: string[]) {
    const positiveCues = [
        "align",
        "aligned",
        "matches",
        "match",
        "strong",
        "relevant",
        "good fit",
        "feasible",
        "works for",
        "benefit",
        "supports",
        "collaborative",
    ]

    return (items || []).filter((s0) => {
        const s = (s0 || "").toLowerCase()

        const negativeCues = [
            "requires",
            "must",
            "mismatch",
            "outside",
            "lack",
            "lacks",
            "missing",
            "not eligible",
            "inconsistent",
            "does not",
            "doesn't",
            "no experience",
            "gap",
            "graduate",
            "graduation",
            "mba",
            "enrollment",
            "degree",
            "timeline",
        ]

        const isNegative = negativeCues.some((c) => s.includes(c))
        const isPositive = positiveCues.some((c) => s.includes(c))

        if (isNegative) return true
        if (isPositive) return false

        return false
    })
}

function buildPassReasons(args: {
    gate: Gate
    deterministicExplain: ScoreExplain[]
    gradMismatchReason?: string | null
    modelPassReasons: string[]
}) {
    const { gate, deterministicExplain, gradMismatchReason, modelPassReasons } = args

    const out: string[] = []

    if (gate.type === "force_pass" && gate.reason) out.push(gate.reason)
    if (gradMismatchReason) out.push(gradMismatchReason)

    for (const e of deterministicExplain) {
        if (e.delta >= 0) continue
        const line = e.note ? e.note : e.label
        if (line && !out.includes(line)) out.push(line)
        if (out.length >= 6) break
    }

    const cleaned = stripPositiveOrNeutralWhy(modelPassReasons || [])
    for (const r of cleaned) {
        const s = String(r || "").trim()
        if (!s) continue
        if (!out.includes(s)) out.push(s)
        if (out.length >= 6) break
    }

    if (!out.length) {
        out.push("This role has a core mismatch with candidate eligibility or requirements.")
    }

    return out.slice(0, 6)
}

/* ----------------------- LLM (explanations only) ----------------------- */
async function generateNarrative(args: {
    decision: Decision
    score: number
    gate: Gate
    jobText: string
    profileText: string
    location_constraint: LocationConstraint
}) {
    const { decision, score, gate, jobText, profileText, location_constraint } = args

    if (decision === "Pass") {
        const system = `
You are WRNSignal by Workforce Ready Now.
You generate PASS explanations only.

Rules:
- Return JSON only.
- Return ONLY disqualifying reasons for PASS.
- Do NOT include positives or "but also" statements.
- No advice. No resume/cover letter/networking instructions.
- No "Job:"/"Profile:" labels. No quoting job text.
- 3 to 6 bullets max.

Output JSON:
{ "pass_reasons": string[] }
`.trim()

        const user = `
Decision: Pass
Score: ${score}
Gate: ${
            gate.type === "force_pass"
                ? gate.reason
                : gate.type === "floor_review"
                  ? gate.reason
                  : "none"
        }
Location constraint: ${location_constraint}

CLIENT PROFILE:
${profileText}

JOB DESCRIPTION:
${jobText}
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

        const passReasons = ensureArrayOfStrings(parsed?.pass_reasons, 8)
        return { pass_reasons: passReasons, why: [], risks: [] }
    }

    const system = `
You are WRNSignal by Workforce Ready Now.
You generate explanations for a deterministic decision and score.

Rules:
- Return JSON only.
- Do NOT change the decision or score.
- WHY bullets: 4 to 7 bullets, specific, grounded in job + profile, plain English.
- RISKS: 2 to 6 bullets, only real gaps or constraints triggered by explicit job requirements.
- No advice. No "tailor your resume" or "reach out" or similar.
- No "Job:"/"Profile:" labels. No quoting job text.

Output JSON:
{ "why": string[], "risks": string[] }
`.trim()

    const user = `
Decision: ${decision}
Score: ${score}
Gate: ${
        gate.type === "force_pass"
            ? gate.reason
            : gate.type === "floor_review"
              ? gate.reason
              : "none"
    }
Location constraint: ${location_constraint}

CLIENT PROFILE:
${profileText}

JOB DESCRIPTION:
${jobText}
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

    let why = ensureArrayOfStrings(parsed?.why, 12)
    let risks = ensureArrayOfStrings(parsed?.risks, 12)

    const treatAsConstrained = location_constraint === "constrained"
    if (!treatAsConstrained) {
        why = stripLocationLanguage(why)
        risks = stripLocationLanguage(risks)
    }

    why = stripAdviceLanguage(why)
    risks = stripAdviceLanguage(risks)
    risks = stripNonRiskRiskFlags(risks)
    risks = stripMissingJobInfoRisks(risks)

    // hard-separate, because the model still mixes them sometimes
    const sep = separateWhyAndRisks(why, risks)

    return { pass_reasons: [], why: sep.why, risks: sep.risks }
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
    const location_constraint = inferLocationConstraint(jobText)

    // Forced PASS: deterministic, no “Apply/Review narrative”
    if (gate.type === "force_pass") {
        const score = 59
        const narrative = await generateNarrative({
            decision: "Pass",
            score,
            gate,
            jobText,
            profileText,
            location_constraint,
        })

        const passReasons = buildPassReasons({
            gate,
            deterministicExplain: [],
            gradMismatchReason: null,
            modelPassReasons: narrative.pass_reasons,
        })

        return {
            decision: "Pass" as Decision,
            icon: iconForDecision("Pass"),
            score,
            bullets: [],
            risk_flags: passReasons.slice(0, 6),
            next_step:
                "It is recommended that you do not apply and focus your attention on more aligned positions.",
            location_constraint,
        }
    }

    // Deterministic base score + initial decision
    const det = computeDeterministicScore({
        jobText,
        profileText,
        jobFacts,
        profileConstraints,
    })

    let decision: Decision = det.decisionByScore
    let score: number = det.score

    // Graduation-window mismatch => PASS (deterministic)
    let gradMismatchReason: string | null = null
    const gradWindow = extractGradWindow(jobText)
    const candGrad = extractCandidateGrad(profileText)

    if (gradWindow && candGrad) {
        const candIdx = ymToIndex(candGrad)
        const startIdx = ymToIndex(gradWindow.start)
        const endIdx = ymToIndex(gradWindow.end)
        const outside = candIdx < startIdx || candIdx > endIdx

        if (outside) {
            decision = "Pass"
            score = Math.min(score, 59)
            gradMismatchReason = `Graduation window mismatch (job requires ${formatYM(
                gradWindow.start
            )}–${formatYM(gradWindow.end)}; candidate appears to graduate ${formatYM(
                candGrad
            )}).`
        }
    } else if (gradWindow && !candGrad) {
        // strict window exists but we cannot confirm grad date => do not allow Apply
        if (decision === "Apply") decision = "Review"
    }

    // REVIEW floor gate always wins over Apply
    if (gate.type === "floor_review" && decision === "Apply") {
        decision = "Review"
    }

    // PASS path: generate pass narrative + only pass reasons
    if (decision === "Pass") {
        const narrative = await generateNarrative({
            decision: "Pass",
            score: 59,
            gate,
            jobText,
            profileText,
            location_constraint,
        })

        const passReasons = buildPassReasons({
            gate,
            deterministicExplain: det.explain,
            gradMismatchReason,
            modelPassReasons: narrative.pass_reasons,
        })

        return {
            decision,
            icon: iconForDecision(decision),
            score: 59,
            bullets: [],
            risk_flags: passReasons.slice(0, 6),
            next_step:
                "It is recommended that you do not apply and focus your attention on more aligned positions.",
            location_constraint,
        }
    }

    // Apply/Review narrative (explanations only)
    const narrative = await generateNarrative({
        decision,
        score,
        gate,
        jobText,
        profileText,
        location_constraint,
    })

    let bullets = (narrative.why || []).slice(0, 8)
    let riskFlags = (narrative.risks || []).slice(0, 6)

    // Deterministic risk-based downgrade (strict but fair)
    // - Any severe risk => at least Review
    // - 2+ risks => Review (clean Apply should be clean)
    const riskCount = riskFlags.length
    const hasSevere = riskFlags.some(riskIsSevere)

    if (decision === "Apply") {
        if (hasSevere || riskCount >= 2) decision = "Review"
    }

    // Risk-based score penalty (never 100, never 97 if any risks)
    score = applyDisplayedRiskPenalty(score, riskFlags)

    // Enforce score band for the FINAL decision (UI consistency)
    score = enforceScoreBand(decision, score)

    const next_step =
        decision === "Review"
            ? "Review the risk flags carefully before proceeding."
            : "Apply promptly if this role is still open."

    return {
        decision,
        icon: iconForDecision(decision),
        score,
        bullets,
        risk_flags: riskFlags,
        next_step,
        location_constraint,
    }
}