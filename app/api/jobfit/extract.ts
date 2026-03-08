// FILE: app/api/jobfit/extract.ts
//
// Evidence-first extractor for JobFit WHY pipeline.
// Deterministic only.
// Produces:
// - coarse classification signals
// - job requirement units
// - profile evidence units
// - function-tag evidence maps for audit/debug

import crypto from "crypto"
import { POLICY } from "./policy"
import type {
  EvidenceKind,
  FunctionTag,
  JobFamily,
  JobRequirementUnit,
  LocationMode,
  ProfileConstraints,
  ProfileEvidenceUnit,
  StructuredJobSignals,
  StructuredProfileSignals,
} from "./signals"

type CapabilityRule = {
  key: string
  label: string
  kind: EvidenceKind
  functionTag?: FunctionTag
  profilePhrases: string[]
  jobPhrases: string[]
  adjacentKeys?: string[]
  aliases?: string[]
}

const CAPABILITY_RULES: CapabilityRule[] = [
  {
    key: "brand_messaging",
    label: "brand messaging and campaign work",
    kind: "function",
    functionTag: "brand_marketing",
    profilePhrases: [
      "brand marketing",
      "campaign",
      "positioning",
      "go-to-market",
      "messaging",
      "brand storytelling",
      "persona",
      "personas",
      "brand strategy",
    ],
    jobPhrases: [
      "brand marketing",
      "campaign",
      "positioning",
      "go-to-market",
      "messaging",
      "brand storytelling",
      "brand strategy",
      "brand communication",
    ],
    adjacentKeys: ["content_execution", "visual_communication"],
  },
  {
    key: "communications_writing",
    label: "communications, writing, and messaging work",
    kind: "function",
    functionTag: "communications_pr",
    profilePhrases: [
      "communications",
      "public relations",
      "media relations",
      "press release",
      "copywriting",
      "editorial",
      "messaging",
    ],
    jobPhrases: [
      "communications",
      "public relations",
      "media relations",
      "press release",
      "copywriting",
      "messaging",
      "editorial",
    ],
    adjacentKeys: ["stakeholder_coordination"],
  },
  {
    key: "visual_communication",
    label: "visual communication and design execution",
    kind: "function",
    functionTag: "creative_design",
    profilePhrases: [
      "graphic design",
      "visual design",
      "creative design",
      "visual communication",
      "creative assets",
      "brand design",
      "layout design",
      "design system",
    ],
    jobPhrases: [
      "graphic design",
      "visual design",
      "creative design",
      "visual communication",
      "creative assets",
      "brand design",
      "design system",
      "visual identity",
    ],
    adjacentKeys: ["brand_messaging", "content_execution"],
  },
  {
    key: "content_execution",
    label: "content and channel execution",
    kind: "function",
    functionTag: "content_social",
    profilePhrases: [
      "social media",
      "content creation",
      "content",
      "instagram",
      "tiktok",
      "channel",
      "editorial calendar",
      "copywriting",
      "content strategy",
    ],
    jobPhrases: [
      "social media",
      "content creation",
      "content",
      "instagram",
      "tiktok",
      "channel",
      "editorial calendar",
      "content strategy",
      "channel execution",
    ],
    adjacentKeys: ["brand_messaging", "visual_communication"],
  },
  {
    key: "consumer_research",
    label: "consumer, market, or user research",
    kind: "function",
    functionTag: "consumer_insights_research",
    profilePhrases: [
      "consumer insights",
      "market research",
      "research",
      "survey",
      "focus group",
      "qualitative",
      "quantitative",
      "trend analysis",
      "consumer behavior",
      "social listening",
    ],
    jobPhrases: [
      "consumer insights",
      "market research",
      "research",
      "survey",
      "focus group",
      "qualitative",
      "quantitative",
      "trend analysis",
      "consumer behavior",
    ],
    adjacentKeys: ["analysis_reporting", "policy_regulatory_research"],
  },
  {
    key: "analysis_reporting",
    label: "analysis, reporting, and measurement work",
    kind: "execution",
    functionTag: "data_analytics_bi",
    profilePhrases: [
      "dashboard",
      "reporting",
      "analysis",
      "data analysis",
      "data visualization",
      "metrics",
      "forecast",
      "trend analysis",
      "report",
      "reporting cadence",
    ],
    jobPhrases: [
      "dashboard",
      "reporting",
      "analysis",
      "data analysis",
      "data visualization",
      "metrics",
      "forecast",
      "trend analysis",
      "measurement",
      "performance reporting",
    ],
    adjacentKeys: ["financial_analysis", "performance_optimization"],
  },
  {
    key: "performance_optimization",
    label: "growth, performance, and optimization work",
    kind: "execution",
    functionTag: "growth_performance",
    profilePhrases: [
      "performance marketing",
      "growth marketing",
      "campaign optimization",
      "optimize",
      "conversion",
      "acquisition",
      "retention",
      "a/b testing",
      "ab testing",
      "roas",
      "ctr",
      "cvr",
    ],
    jobPhrases: [
      "performance marketing",
      "growth marketing",
      "campaign optimization",
      "optimize",
      "conversion",
      "acquisition",
      "retention",
      "a/b testing",
      "ab testing",
      "roas",
      "ctr",
      "cvr",
    ],
    adjacentKeys: ["analysis_reporting", "content_execution"],
  },
  {
    key: "product_positioning",
    label: "product positioning and launch work",
    kind: "function",
    functionTag: "product_marketing",
    profilePhrases: [
      "product marketing",
      "launch strategy",
      "value proposition",
      "competitive intel",
      "product positioning",
    ],
    jobPhrases: [
      "product marketing",
      "launch strategy",
      "value proposition",
      "competitive intel",
      "product positioning",
    ],
    adjacentKeys: ["brand_messaging"],
  },
  {
    key: "client_commercial_work",
    label: "client-facing, sales, or commercial support work",
    kind: "stakeholder",
    functionTag: "sales_bd",
    profilePhrases: [
      "client",
      "client-facing",
      "business development",
      "sales",
      "relationship building",
      "account management",
      "pipeline",
      "stakeholder management",
    ],
    jobPhrases: [
      "client",
      "client-facing",
      "business development",
      "sales",
      "relationship building",
      "account management",
      "pipeline",
    ],
    adjacentKeys: ["stakeholder_coordination"],
  },
  {
    key: "policy_regulatory_research",
    label: "legal, policy, and regulatory research",
    kind: "function",
    functionTag: "legal_regulatory",
    profilePhrases: [
      "legal research",
      "policy research",
      "policy analysis",
      "regulatory",
      "compliance",
      "contracts",
      "litigation",
      "legislative",
    ],
    jobPhrases: [
      "legal research",
      "policy research",
      "policy analysis",
      "regulatory",
      "compliance",
      "contracts",
      "litigation",
      "legislative",
    ],
    adjacentKeys: ["communications_writing", "analysis_reporting"],
  },
  {
    key: "financial_analysis",
    label: "financial analysis and investment work",
    kind: "function",
    functionTag: "finance_corp",
    profilePhrases: [
      "financial analysis",
      "financial modeling",
      "valuation",
      "lbo",
      "portfolio",
      "investment analysis",
      "asset management",
      "capital markets",
      "equity research",
      "credit analysis",
    ],
    jobPhrases: [
      "financial analysis",
      "financial modeling",
      "valuation",
      "lbo",
      "portfolio",
      "investment analysis",
      "asset management",
      "capital markets",
      "equity research",
      "credit analysis",
    ],
    adjacentKeys: ["analysis_reporting", "client_commercial_work"],
  },
  {
    key: "accounting_operations",
    label: "accounting and financial operations work",
    kind: "function",
    functionTag: "accounting_finops",
    profilePhrases: [
      "accounting",
      "reconciliation",
      "journal entry",
      "general ledger",
      "audit",
      "tax",
      "financial reporting",
    ],
    jobPhrases: [
      "accounting",
      "reconciliation",
      "journal entry",
      "general ledger",
      "audit",
      "tax",
      "financial reporting",
    ],
    adjacentKeys: ["analysis_reporting", "operations_execution"],
  },
  {
    key: "clinical_patient_work",
    label: "clinical and patient-facing work",
    kind: "function",
    functionTag: "premed_clinical",
    profilePhrases: [
      "clinical",
      "patient",
      "medical",
      "research assistant",
      "emt",
      "scribe",
      "care team",
    ],
    jobPhrases: [
      "clinical",
      "patient",
      "medical",
      "research assistant",
      "scribe",
      "care team",
    ],
    adjacentKeys: [],
  },
  {
    key: "operations_execution",
    label: "operations, process, and workflow execution",
    kind: "execution",
    functionTag: "operations_general",
    profilePhrases: [
      "operations",
      "process improvement",
      "workflow",
      "project management",
      "program management",
      "cross-functional",
      "process",
    ],
    jobPhrases: [
      "operations",
      "process improvement",
      "workflow",
      "project management",
      "program management",
      "cross-functional",
      "process",
    ],
    adjacentKeys: ["stakeholder_coordination", "analysis_reporting"],
  },
  {
    key: "strategy_problem_solving",
    label: "strategy, synthesis, and problem-solving work",
    kind: "function",
    functionTag: "consulting_strategy",
    profilePhrases: [
      "consulting",
      "strategy",
      "recommendation",
      "problem solving",
      "market research",
      "hypothesis",
      "case competition",
      "presentation",
    ],
    jobPhrases: [
      "consulting",
      "strategy",
      "recommendation",
      "problem solving",
      "market research",
      "hypothesis",
      "presentation",
    ],
    adjacentKeys: ["analysis_reporting", "stakeholder_coordination"],
  },
  {
    key: "stakeholder_coordination",
    label: "stakeholder coordination and cross-functional execution",
    kind: "stakeholder",
    functionTag: "operations_general",
    profilePhrases: [
      "cross-functional",
      "stakeholder",
      "coordination",
      "collaboration",
      "partnered with",
      "worked with",
      "client meetings",
      "presented to",
    ],
    jobPhrases: [
      "cross-functional",
      "stakeholder",
      "coordination",
      "collaboration",
      "partnered with",
      "worked with",
      "present to",
      "collaborate with",
    ],
    adjacentKeys: ["client_commercial_work", "operations_execution"],
  },
  {
    key: "drafting_documentation",
    label: "drafting, documentation, and written deliverables",
    kind: "deliverable",
    functionTag: "communications_pr",
    profilePhrases: [
      "drafted",
      "prepared",
      "wrote",
      "documentation",
      "memo",
      "brief",
      "report",
      "presentation deck",
    ],
    jobPhrases: [
      "draft",
      "prepare",
      "write",
      "documentation",
      "memo",
      "brief",
      "report",
      "presentation deck",
    ],
    adjacentKeys: ["communications_writing", "policy_regulatory_research"],
  },
]

const TOOL_ALIASES: Record<string, string[]> = {
  excel: ["excel", "microsoft excel"],
  powerpoint: ["powerpoint", "power point", "ppt"],
  word: ["word", "microsoft word"],
  sql: ["sql"],
  python: ["python"],
  r: ["r", "r studio", "rstudio"],
  tableau: ["tableau"],
  "power bi": ["power bi", "powerbi"],
  figma: ["figma"],
  photoshop: ["photoshop", "adobe photoshop"],
  illustrator: ["illustrator", "adobe illustrator"],
  indesign: ["indesign", "adobe indesign"],
  canva: ["canva"],
  hubspot: ["hubspot"],
  salesforce: ["salesforce"],
  shopify: ["shopify"],
  "google analytics": ["google analytics", "ga4"],
  spss: ["spss"],
  autocad: ["autocad"],
}

function stableHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16)
}

function norm(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/[•·]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function cleanLine(raw: string): string {
  return String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/[•·]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(resume_paste:|cover_letter:|extra_context:)\s*/i, "")
    .replace(/^(relevant experience|additional experience|legal experience|policy and advocacy experience)\s*:?/i, "")
    .trim()
}

function asStringArray(x: unknown): string[] {
  if (!Array.isArray(x)) return []
  return x.map((v) => String(v || "").trim()).filter(Boolean)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function includesPhrase(hay: string, phrase: string): boolean {
  const p = norm(phrase)
  if (!p) return false
  const pattern = new RegExp(`(^|\\W)${escapeRegExp(p)}($|\\W)`, "i")
  return pattern.test(hay)
}

function includesAny(hay: string, phrases: string[]): boolean {
  return phrases.some((p) => includesPhrase(hay, p))
}

function countHits(hay: string, phrases: string[]): number {
  return phrases.reduce((acc, p) => acc + (includesPhrase(hay, p) ? 1 : 0), 0)
}

function splitEvidenceLines(text: string): string[] {
  const raw = String(text || "")
  if (!raw.trim()) return []

   const actionSplit =
    /(?=\b(Conducted|Reviewed|Drafted|Prepared|Presented|Analyzed|Researched|Coordinated|Supported|Executed|Created|Developed|Managed|Led|Produced|Tracked|Wrote|Collaborated|Applied|Organized)\b)/

  const chunks = raw
    .split(/\r?\n+/)
    .map(cleanLine)
    .flatMap((line) => {
      const sentenceParts = line.split(/(?<=[\.\!\?;])\s+(?=[A-Z0-9])/).map(cleanLine).filter(Boolean)

      return sentenceParts.flatMap((part) => {
        if (part.length <= 280) return [part]
        return part
          .split(actionSplit)
          .map(cleanLine)
          .filter(Boolean)
      })
    })
    .map(cleanLine)
    .filter(Boolean)

  const out: string[] = []
  const seen = new Set<string>()

  for (const line of chunks) {
    const n = norm(line)
    if (!n) continue
    if (seen.has(n)) continue
    seen.add(n)
    out.push(line)
  }

  return out
}

function scoreProfileLine(line: string): number {
  const t = norm(line)
  if (!t) return 0

  let score = 0

  if (t.length >= 35) score += 2
  if (t.length >= 55) score += 1

  if (
    /\b(conducted|analyzed|built|created|developed|managed|supported|coordinated|prepared|drafted|reviewed|researched|presented|executed|optimized|led|designed|translated)\b/i.test(
      line
    )
  ) score += 4

  if (/\b(with|using|for|across|including|through)\b/i.test(line)) score += 1
  if (/\b(client|stakeholder|campaign|portfolio|policy|regulatory|reporting|brand|content|research|analysis)\b/i.test(line)) score += 2
  if (/\b\d+%|\$\d+|\d+\+?\b/.test(line)) score += 1

  if (/\b(education|coursework|gpa|dean'?s list|honors|scholarship|university)\b/i.test(line)) score -= 4
  if (/^[A-Z\s|/-]+$/.test(line)) score -= 5
  if (t.length < 22) score -= 4

  return score
}

function scoreJobLine(line: string): number {
  const t = norm(line)
  if (!t) return 0

  let score = 0

  if (t.length >= 30) score += 2
  if (
    /\b(responsible for|responsibilities include|you will|will be|support|conduct|analyze|develop|manage|prepare|execute|coordinate|collaborate|assist|drive|build|create|own)\b/i.test(
      line
    )
  ) score += 4

  if (/\b(required|preferred|must|proficient|experience with|ability to)\b/i.test(line)) score += 2
  if (/\b(research|analysis|reporting|campaign|content|design|financial|client|stakeholder|policy|regulatory|operations)\b/i.test(line)) score += 2

  if (/\b(equal opportunity|benefits|compensation may vary|about us|who we are|our values)\b/i.test(line)) score -= 5
  if (t.length < 20) score -= 3

  return score
}

function canonicalTool(rawTool: string): string {
  const n = norm(rawTool)
  for (const [canonical, aliases] of Object.entries(TOOL_ALIASES)) {
    if (aliases.some((a) => includesPhrase(n, a))) return canonical
  }
  return n
}

function extractToolMentions(text: string): string[] {
  const t = norm(text)
  const out = new Set<string>()

  for (const [canonical, aliases] of Object.entries(TOOL_ALIASES)) {
    if (aliases.some((alias) => includesPhrase(t, alias))) out.add(canonical)
  }

  const core = asStringArray((POLICY as any)?.tools?.core)
  const preferred = asStringArray((POLICY as any)?.tools?.preferred)
  for (const tool of [...core, ...preferred]) {
    const c = canonicalTool(tool)
    if (includesPhrase(t, tool) || includesPhrase(t, c)) out.add(c)
  }

  return Array.from(out)
}

function familyFromFunctionTags(tags: FunctionTag[]): JobFamily {
  const score: Record<JobFamily, number> = {
    Consulting: 0,
    Marketing: 0,
    Finance: 0,
    Accounting: 0,
    Analytics: 0,
    Sales: 0,
    Government: 0,
    PreMed: 0,
    Other: 0,
  }

  for (const tag of tags) {
    if (tag === "government_cleared") score.Government += 5
    if (tag === "sales_bd") score.Sales += 5
    if (tag === "premed_clinical") score.PreMed += 5

    if (tag === "finance_corp") score.Finance += 5
    if (tag === "accounting_finops") score.Accounting += 5

    if (tag === "data_analytics_bi") score.Analytics += 3
    if (tag === "consumer_insights_research") score.Analytics += 2

    if (tag === "brand_marketing") score.Marketing += 4
    if (tag === "communications_pr") score.Marketing += 3
    if (tag === "content_social") score.Marketing += 3
    if (tag === "growth_performance") score.Marketing += 4
    if (tag === "product_marketing") score.Marketing += 5

    if (tag === "consulting_strategy") score.Consulting += 4
    if (tag === "operations_general") score.Consulting += 3

    if (tag === "legal_regulatory" || tag === "creative_design" || tag === "other") score.Other += 4
  }

  const ordered: JobFamily[] = [
    "Marketing",
    "Consulting",
    "Finance",
    "Accounting",
    "Analytics",
    "Sales",
    "Government",
    "PreMed",
    "Other",
  ]

  let best: JobFamily = "Other"
  let bestScore = 0

  for (const family of ordered) {
    if (score[family] > bestScore) {
      best = family
      bestScore = score[family]
    }
  }

  return best
}

function makeProfileUnit(
  key: string,
  label: string,
  kind: EvidenceKind,
  snippet: string,
  strength: number,
  functionTag?: FunctionTag
): ProfileEvidenceUnit {
  return {
    id: stableHash(`profile|${key}|${snippet}`),
    kind,
    key,
    label,
    snippet,
    source: "resume",
    strength,
    functionTag,
  }
}

function compressJobSnippet(snippet: string): string {
  const text = String(snippet || "").replace(/\s+/g, " ").trim()
  if (!text) return ""

  const cleaned = text
    .replace(/^responsibilities include\s+/i, "")
    .replace(/^responsible for\s+/i, "")
    .replace(/^you will\s+/i, "")
    .trim()

  if (cleaned.length <= 260) return cleaned

  const parts = cleaned
    .split(/;\s+/)
    .map((x) => x.trim())
    .filter(Boolean)

  if (parts.length === 0) return cleaned.slice(0, 260).trim()

  return parts.slice(0, 2).join("; ").trim()
}

function makeJobUnit(
  key: string,
  label: string,
  kind: EvidenceKind,
  snippet: string,
  strength: number,
  requiredness: "core" | "supporting",
  functionTag?: FunctionTag
): JobRequirementUnit {
  return {
    id: stableHash(`job|${key}|${snippet}`),
    kind,
    key,
    label,
    snippet: compressJobSnippet(snippet),
    strength,
    requiredness,
    functionTag,
  }
}

function dedupeUnits<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    out.push(item)
  }
  return out
}

function detectRequiredness(line: string): "core" | "supporting" {
  return /\b(required|must|responsible for|you will|core|primary|lead|own)\b/i.test(line)
    ? "core"
    : "supporting"
}

function buildUnitsFromLines(
  lines: string[],
  side: "job" | "profile"
): {
  profileUnits: ProfileEvidenceUnit[]
  jobUnits: JobRequirementUnit[]
  functionTagEvidence: Partial<Record<FunctionTag, string[]>>
  functionTags: FunctionTag[]
  debugHits: Record<string, number>
} {
  const profileUnits: ProfileEvidenceUnit[] = []
  const jobUnits: JobRequirementUnit[] = []
  const functionTagEvidence: Partial<Record<FunctionTag, string[]>> = {}
  const functionTags = new Set<FunctionTag>()
  const debugHits: Record<string, number> = {}

  for (const line of lines) {
    const cleaned = cleanLine(line)
    const n = norm(cleaned)
    if (!n) continue

    const lineScore = side === "job" ? scoreJobLine(cleaned) : scoreProfileLine(cleaned)
    if (lineScore < 2) continue
        if (
      side === "job" &&
      (
        /\bideal candidates will have\b/i.test(cleaned) ||
        /\b(bachelor'?s degree|bachelors degree|degree in)\b/i.test(cleaned)
      )
    ) {
      continue
    }

    for (const rule of CAPABILITY_RULES) {
      const phrases = side === "job" ? rule.jobPhrases : rule.profilePhrases
      const hits = countHits(n, phrases)
      if (hits <= 0) continue

      debugHits[rule.key] = (debugHits[rule.key] || 0) + hits

      const strength = Math.min(10, lineScore + hits + (rule.kind === "function" ? 1 : 0))

      if (rule.functionTag) {
        functionTags.add(rule.functionTag)
        const bucket = functionTagEvidence[rule.functionTag] || []
        if (!bucket.includes(cleaned) && bucket.length < 5) {
          bucket.push(cleaned)
          functionTagEvidence[rule.functionTag] = bucket
        }
      }

      if (side === "job") {
        jobUnits.push(
          makeJobUnit(
            rule.key,
            rule.label,
            rule.kind,
            cleaned,
            strength,
            detectRequiredness(cleaned),
            rule.functionTag
          )
        )
      } else {
        profileUnits.push(
          makeProfileUnit(rule.key, rule.label, rule.kind, cleaned, strength, rule.functionTag)
        )
      }
    }

    const tools = extractToolMentions(cleaned)
    for (const tool of tools) {
      debugHits[`tool:${tool}`] = (debugHits[`tool:${tool}`] || 0) + 1
      if (side === "job") {
        jobUnits.push(
          makeJobUnit(
            tool,
            `${tool} tool usage`,
            "tool",
            cleaned,
            Math.min(10, lineScore + 2),
            detectRequiredness(cleaned)
          )
        )
      } else {
        profileUnits.push(
          makeProfileUnit(tool, `${tool} tool usage`, "tool", cleaned, Math.min(10, lineScore + 2))
        )
      }
    }
  }

  return {
    profileUnits: dedupeUnits(profileUnits),
    jobUnits: dedupeUnits(jobUnits),
    functionTagEvidence,
    functionTags: Array.from(functionTags),
    debugHits,
  }
}

function extractYearsRequired(jobText: string): number | null {
  const patterns: RegExp[] = Array.isArray((POLICY as any)?.extraction?.years?.patterns)
    ? ((POLICY as any).extraction.years.patterns as RegExp[])
    : []

  for (const r of patterns) {
    const m = jobText.match(r)
    if (m && m[1]) {
      const v = parseInt(String(m[1]), 10)
      if (!Number.isNaN(v) && v >= 0 && v <= 20) return v
    }
  }
  return null
}

function extractGradYearHint(jobText: string): number | null {
  const patterns: RegExp[] = Array.isArray((POLICY as any)?.extraction?.grad?.patterns)
    ? ((POLICY as any).extraction.grad.patterns as RegExp[])
    : []

  for (const r of patterns) {
    const m = jobText.match(r)
    if (!m) continue
    for (const part of m.slice(1)) {
      const s = String(part || "")
      if (/^20\d{2}$/.test(s)) {
        const v = parseInt(s, 10)
        if (!Number.isNaN(v)) return v
      }
    }
    const fallback = m[0].match(/20\d{2}/)
    if (fallback?.[0]) {
      const v = parseInt(fallback[0], 10)
      if (!Number.isNaN(v)) return v
    }
  }

  return null
}

function extractCity(t: string): string | null {
  if (/\bnyc\b/.test(t) || t.includes("new york city") || t.includes("new york, ny")) return "New York City"
  if (/\bchicago\b/.test(t)) return "Chicago"
  if (/\bboston\b/.test(t)) return "Boston"
  if (/\baustin\b/.test(t)) return "Austin"
  if (/\bmiami\b/.test(t)) return "Miami"
  if (/\bphiladelphia\b/.test(t)) return "Philadelphia"
  if (/\batlanta\b/.test(t)) return "Atlanta"
  if (/\bcharlotte\b/.test(t)) return "Charlotte"
  if (/\bwashington,\s*dc\b|\bwashington dc\b/.test(t)) return "Washington DC"
  if (/\blos angeles\b/.test(t)) return "Los Angeles"
  return null
}

function detectLocationMode(jobText: string): {
  mode: LocationMode
  constrained: boolean
  city: string | null
  evidence: string | null
} {
  const t = norm(jobText)

  const constrainedPhrases = asStringArray((POLICY as any)?.extraction?.location?.constrainedPhrases).map(norm)
  const remotePhrases = asStringArray((POLICY as any)?.extraction?.location?.remotePhrases).map(norm)
  const hybridPhrases = asStringArray((POLICY as any)?.extraction?.location?.hybridPhrases).map(norm)
  const onsitePhrases = asStringArray((POLICY as any)?.extraction?.location?.onsitePhrases).map(norm)

  const constrained =
    includesAny(t, constrainedPhrases) ||
    t.includes("must be in") ||
    t.includes("required to be in") ||
    t.includes("local candidates only")

  const hasRemote = includesAny(t, remotePhrases)
  const hasHybrid = includesAny(t, hybridPhrases)
  const hasInPerson = includesAny(t, onsitePhrases) || t.includes("in-person") || t.includes("in person")

  let mode: LocationMode = "unclear"
  if (hasHybrid) mode = "hybrid"
  else if (hasRemote && !hasInPerson) mode = "remote"
  else if (hasInPerson && !hasRemote) mode = "in_person"
  else if (hasRemote && hasInPerson) mode = "hybrid"

  const city = extractCity(t)
  const evidenceLine =
    splitEvidenceLines(jobText).find((line) =>
      /\b(remote|hybrid|in-person|in person|new york city|nyc office)\b/i.test(line)
    ) || null

  return { mode, constrained, city, evidence: evidenceLine }
}

function detectAnalytics(jobText: string, tags: FunctionTag[]): { isHeavy: boolean; isLight: boolean } {
  const t = norm(jobText)
  const heavyKeywords = asStringArray((POLICY as any)?.extraction?.analytics?.heavyKeywords).map(norm)
  const lightKeywords = asStringArray((POLICY as any)?.extraction?.analytics?.lightKeywords).map(norm)

  const heavyByKeywords = includesAny(t, heavyKeywords)
  const heavyByTags = tags.includes("data_analytics_bi") || tags.includes("consumer_insights_research")
  const isHeavy = heavyByKeywords || heavyByTags
  const isLight = !isHeavy && includesAny(t, lightKeywords)

  return { isHeavy, isLight }
}

function extractToolRequirements(jobTextRaw: string): { required: string[]; preferred: string[] } {
  const lines = splitEvidenceLines(jobTextRaw)
  const required = new Set<string>()
  const preferred = new Set<string>()

  for (const line of lines) {
    const tools = extractToolMentions(line)
    if (!tools.length) continue
    const requiredLine = /\b(required|must have|proficient|experience with|required qualifications)\b/i.test(line)
    for (const tool of tools) {
      if (requiredLine) required.add(tool)
      else preferred.add(tool)
    }
  }

  for (const tool of Array.from(required)) preferred.delete(tool)

  return {
    required: Array.from(required),
    preferred: Array.from(preferred),
  }
}

function extractInternshipDates(t: string): { dates: string | null; dateLine: string | null } {
  const m = t.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\s*[-–]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i
  )
  if (!m) return { dates: null, dateLine: null }
  const line = splitEvidenceLines(t).find((x) => x.toLowerCase().includes(m[0].toLowerCase())) || null
  return { dates: m[0], dateLine: line }
}

function extractPay(t: string): { pay: string | null; payLine: string | null } {
  const m = t.match(/\$\s*\d+(\.\d+)?\s*\/\s*(hr|hour)\b/i)
  if (!m) return { pay: null, payLine: null }
  const line = splitEvidenceLines(t).find((x) => x.toLowerCase().includes(m[0].toLowerCase())) || null
  return { pay: m[0], payLine: line }
}

function detectInternshipSignals(textRaw: string) {
  const t = norm(textRaw)
  const internshipKeywords = asStringArray((POLICY as any)?.extraction?.internship?.keywords).map(norm)
  const summerKeywords = asStringArray((POLICY as any)?.extraction?.internship?.summerKeywords).map(norm)
  const aiToolsKeywords = asStringArray((POLICY as any)?.extraction?.internship?.aiToolsKeywords).map(norm)
  const rotationKeywords = asStringArray((POLICY as any)?.extraction?.internship?.marketingRotationKeywords).map(norm)
  const inPersonInternKeywords = asStringArray((POLICY as any)?.extraction?.internship?.inPersonInternKeywords).map(norm)

  const lines = splitEvidenceLines(textRaw)

  const isInternship = internshipKeywords.some((k) => t.includes(k))
  const isSummer = summerKeywords.some((k) => t.includes(k))
  const mentionsAITools = aiToolsKeywords.some((k) => t.includes(k))
  const rotationHitCount = rotationKeywords.reduce((acc, k) => acc + (t.includes(k) ? 1 : 0), 0)
  const isMarketingRotation = rotationHitCount >= 3
  const isInPersonExplicit = inPersonInternKeywords.some((k) => t.includes(k))

  const departmentUniverse = [
    "pr",
    "events",
    "influencer",
    "digital marketing",
    "brand marketing",
    "global marketing",
    "partnerships",
    "visual merchandising",
    "key accounts",
  ]

  const departments: string[] = []
  for (const d of departmentUniverse) {
    if (t.includes(d)) {
      if (d === "pr") departments.push("PR")
      else if (d === "events") departments.push("Events")
      else if (d === "influencer") departments.push("Influencer Marketing")
      else if (d === "digital marketing") departments.push("Digital Marketing")
      else if (d === "brand marketing") departments.push("Brand Marketing")
      else if (d === "global marketing") departments.push("Global Marketing")
      else if (d === "partnerships") departments.push("Partnerships")
      else if (d === "visual merchandising") departments.push("Visual Merchandising")
      else if (d === "key accounts") departments.push("Key Accounts")
    }
  }

  const hasCapstone = t.includes("capstone project") || t.includes("capstone")
  const { dates, dateLine } = extractInternshipDates(textRaw)
  const { pay, payLine } = extractPay(textRaw)

  return {
    isInternship,
    isSummer,
    isInPersonExplicit,
    mentionsAITools,
    isMarketingRotation,
    departments,
    dates,
    pay,
    hasCapstone,
    evidence: {
      internshipLine: lines.find((line) => /\b(internship|summer 20\d{2}|intern)\b/i.test(line)) || null,
      inPersonLine: lines.find((line) => /\b(in-person|in person|office)\b/i.test(line)) || null,
      aiLine: lines.find((line) => /\b(ai|artificial intelligence)\b/i.test(line)) || null,
      deptLine: lines.find((line) => /\b(pr|events|influencer|digital marketing|brand marketing)\b/i.test(line)) || null,
      capstoneLine: lines.find((line) => /\bcapstone\b/i.test(line)) || null,
      payLine,
      dateLine,
    },
  }
}

function inferProfileGradYear(text: string): number | null {
  const matches = text.match(/\b20(1\d|2\d|3\d)\b/g) || []
  const years = matches
    .map((x) => parseInt(x, 10))
    .filter((y) => y >= 2018 && y <= 2035)
    .sort((a, b) => a - b)

  return years.length ? years[years.length - 1] : null
}

function inferYearsExperienceApprox(profileText: string): number | null {
  const t = norm(profileText)
  const explicit = t.match(/\b(\d{1,2})\+?\s+years?\b/)
  if (explicit?.[1]) {
    const v = parseInt(explicit[1], 10)
    if (!Number.isNaN(v)) return v
  }

  const roleSignals = splitEvidenceLines(profileText).filter(
    (line) =>
      /\b(intern|internship|analyst|assistant|coordinator|associate|manager|emt|clerk|specialist)\b/i.test(line)
  ).length

  if (roleSignals >= 5) return 2
  if (roleSignals >= 3) return 1
  if (roleSignals >= 1) return 0

  return null
}

function defaultConstraintsFromText(tRaw: string, wantsInternship: boolean): ProfileConstraints {
  const t = norm(tRaw)

  return {
    hardNoSales: t.includes("no sales"),
    hardNoGovernment: t.includes("no government"),
    hardNoContract: t.includes("no contract") || t.includes("no temporary") || t.includes("no temp"),
    hardNoHourlyPay: t.includes("no hourly"),
    hardNoFullyRemote: t.includes("no remote") || t.includes("no fully remote") || t.includes("no fully-remote"),
    prefFullTime: wantsInternship ? false : t.includes("full-time") || t.includes("full time"),
    preferNotAnalyticsHeavy:
      t.includes("no heavy analytical") || t.includes("no heavy analytics") || t.includes("not analytics heavy"),
  }
}

function inferTargetFamiliesFromTags(tags: FunctionTag[]): JobFamily[] {
  const family = familyFromFunctionTags(tags)
  return family === "Other" ? [] : [family]
}

export function extractJobSignals(jobTextRaw: string): StructuredJobSignals {
  const normalized = norm(jobTextRaw)
  const rawHash = stableHash(normalized)

  const lines = splitEvidenceLines(jobTextRaw)
  const built = buildUnitsFromLines(lines, "job")
  const functionTags = built.functionTags
  const jobFamily = familyFromFunctionTags(functionTags)
  const analytics = detectAnalytics(jobTextRaw, functionTags)
  const location = detectLocationMode(jobTextRaw)
  const yearsRequired = extractYearsRequired(normalized)
  const gradYearHint = extractGradYearHint(normalized)

  const mbaKeywords = asStringArray((POLICY as any)?.extraction?.mba?.keywords).map(norm)
  const govKeywords = asStringArray((POLICY as any)?.extraction?.government?.keywords).map(norm)
  const salesKeywords = asStringArray((POLICY as any)?.extraction?.sales?.keywords).map(norm)
  const contractKeywords = asStringArray((POLICY as any)?.extraction?.contract?.keywords).map(norm)
  const hourlyKeywords = asStringArray((POLICY as any)?.extraction?.hourly?.keywords).map(norm)

  const mbaRequired = includesAny(normalized, mbaKeywords)
  const isGovernment = includesAny(normalized, govKeywords) || functionTags.includes("government_cleared")
  const isSalesHeavy = includesAny(normalized, salesKeywords) || functionTags.includes("sales_bd")
  const isContract = includesAny(normalized, contractKeywords)
  const isHourly = includesAny(normalized, hourlyKeywords) || /\$\s*\d+(\.\d+)?\s*\/\s*(hr|hour)\b/i.test(jobTextRaw)

  const { required, preferred } = extractToolRequirements(jobTextRaw)

  const reportingStrong = built.jobUnits.some(
    (u) => u.key === "analysis_reporting" && u.requiredness === "core"
  )

  return {
    rawHash,
    jobFamily,
    analytics,
    function_tags: functionTags,
    signal_debug: {
      hits: built.debugHits,
      notes: [
        "Requirement units are evidence-first and line-anchored.",
        "Function tags are derived from extracted requirement units, not used as the WHY source of truth.",
      ],
    },
    location,
    isGovernment,
    isSalesHeavy,
    isContract,
    isHourly,
    yearsRequired,
    mbaRequired,
    gradYearHint,
    requiredTools: required,
    preferredTools: preferred,
    reportingSignals: { strong: reportingStrong },
    requirement_units: built.jobUnits.sort((a, b) => b.strength - a.strength),
    internship: detectInternshipSignals(jobTextRaw),
  }
}

export function extractProfileSignals(
  profileTextRaw: string,
  overrides?: Partial<StructuredProfileSignals>
): StructuredProfileSignals {
  const normalized = norm(profileTextRaw)
  const wantsInternship = normalized.includes("internship") || normalized.includes("summer 2026")

  const resumeSectionMatch = String(profileTextRaw || "").match(
    /resume_paste:\s*([\s\S]*?)(?:\n\s*cover_letter:|\n\s*extra_context:|$)/i
  )
  const resumeEvidenceText = resumeSectionMatch?.[1]?.trim() || String(profileTextRaw || "")

  const built = buildUnitsFromLines(splitEvidenceLines(resumeEvidenceText), "profile")
  const extractedTools = extractToolMentions(profileTextRaw)

  const baseFamilies = inferTargetFamiliesFromTags(built.functionTags)

  const base: StructuredProfileSignals = {
    targetFamilies: baseFamilies.length ? baseFamilies : ["Marketing"],
    locationPreference: { mode: "unclear", constrained: false, allowedCities: undefined },
    constraints: defaultConstraintsFromText(profileTextRaw, wantsInternship),
    tools: extractedTools,
    gradYear: inferProfileGradYear(profileTextRaw),
    yearsExperienceApprox: inferYearsExperienceApprox(profileTextRaw),
    statedInterests: {
      targetRoles: [],
      adjacentRoles: [],
      targetIndustries: [],
    },
    function_tags: built.functionTags,
    function_tag_evidence: built.functionTagEvidence,
    profile_evidence_units: built.profileUnits.sort((a, b) => b.strength - a.strength),
  }

  const mergedTools = Array.from(
    new Set([...(base.tools || []), ...((overrides?.tools || []).map(canonicalTool))])
  )

  const mergedTags = Array.from(
    new Set([...(base.function_tags || []), ...(overrides?.function_tags || [])])
  )

  const merged: StructuredProfileSignals = {
    ...base,
    ...(overrides || {}),
    constraints: {
      ...base.constraints,
      ...(overrides?.constraints || {}),
    },
    locationPreference: {
      ...base.locationPreference,
      ...(overrides?.locationPreference || {}),
      allowedCities:
        Array.isArray(overrides?.locationPreference?.allowedCities) &&
        overrides.locationPreference.allowedCities.length > 0
          ? overrides.locationPreference.allowedCities
          : base.locationPreference.allowedCities,
    },
    targetFamilies:
      Array.isArray(overrides?.targetFamilies) && overrides.targetFamilies.length > 0
        ? overrides.targetFamilies
        : base.targetFamilies,
    tools: mergedTools,
    function_tags: mergedTags,
    function_tag_evidence: overrides?.function_tag_evidence || base.function_tag_evidence,
    profile_evidence_units:
      Array.isArray(overrides?.profile_evidence_units) && overrides.profile_evidence_units.length > 0
        ? overrides.profile_evidence_units
        : base.profile_evidence_units,
    gradYear: overrides?.gradYear ?? base.gradYear,
    statedInterests: overrides?.statedInterests || base.statedInterests,
    yearsExperienceApprox: overrides?.yearsExperienceApprox ?? base.yearsExperienceApprox,
  }

  return merged
}