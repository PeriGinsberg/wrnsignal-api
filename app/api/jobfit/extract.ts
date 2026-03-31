// FILE: app/api/jobfit/extract.ts
//
// Evidence-first extractor for JobFit WHY pipeline.
// Deterministic only.
// Produces:
// - coarse classification signals
// - job requirement units
// - profile evidence units
// - function-tag evidence maps for audit/debug
//
// Phase I hardening notes:
// - Added weak-posting fallback extraction so Google summary / scraped bullet jobs do not collapse to zero requirements
// - Added sports / event / guest-service / coaching / customer-service signals
// - Added “no-empty-requirements” guardrail behavior
// - Kept deterministic architecture intact

import crypto from "crypto"
import { POLICY } from "./policy"
import type {
  EvidenceKind,
  FinanceSubFamily,
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
  profileWeakPhrases?: string[]
  jobWeakPhrases?: string[]
  profileBoostPhrases?: string[]
  jobBoostPhrases?: string[]
  minMatches?: number
  suppressAnalyticsHeavy?: boolean
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
      "brand initiatives",
      "brand initiative",
      "brand activations",
      "brand activation",
      "campaign initiatives",
      "marketing initiatives",
      "brand events",
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
      "events",
      "event support",
      "event execution",
      "marketing events",
      "brand events",
      "activations",
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
    key: "customer_service_guest_experience",
    label: "customer service, guest experience, and issue resolution",
    kind: "stakeholder",
    functionTag: "operations_general",
    profilePhrases: [
      "guest experience",
      "guest services",
      "fan services",
      "fan engagement",
      "guest issues",
      "customer service",
      "customer support",
      "served as a gracious host",
      "point of contact",
      "guest assistance",
      "crowd flow",
      "fan-facing",
      "families",
      "players and families",
    ],
    jobPhrases: [
      "guest experience",
      "guest services",
      "fan services",
      "fan engagement",
      "customer service",
      "build relationships with players, parents, and coaches",
      "superior customer service",
      "players, parents, and coaches",
      "players and coaches",
      "i9 sports experience",
    ],
    adjacentKeys: ["stakeholder_coordination", "operations_execution"],
  },
  {
    key: "event_operations_live_execution",
    label: "live event, venue, and game-day operations execution",
    kind: "execution",
    functionTag: "operations_general",
    profilePhrases: [
      "game day",
      "game day operations",
      "event operations",
      "event execution",
      "venue logistics",
      "setup and breakdown",
      "signage and equipment setup",
      "load-ins",
      "hospitality spaces",
      "operational setup",
      "venue",
      "crowd flow",
      "live events",
      "live event logistics",
    ],
    jobPhrases: [
      "game day",
      "game day operation",
      "game day operations",
      "practices and games",
      "hands-on involvement",
      "hands on involvement",
      "supervise the overall operation",
      "overall operation of designated sport on game day",
      "game day execution",
      "event operations",
      "sport coordinator",
    ],
    adjacentKeys: ["operations_execution", "stakeholder_coordination"],
  },
  {
    key: "coaching_instruction_facilitation",
    label: "coaching, instruction, and fundamentals-based facilitation",
    kind: "deliverable",
    functionTag: "operations_general",
    profilePhrases: [
      "coach",
      "assistant basketball coach",
      "led weekly practices",
      "skill development",
      "mentor",
      "athletes and families",
      "discipline and accountability",
      "youth athletes",
      "training sessions",
    ],
    jobPhrases: [
      "coaches",
      "coach",
      "observing, assessing, and assisting our coaches",
      "empower volunteer coaches",
      "teach & demonstrate core concepts",
      "teach and demonstrate core concepts",
      "fundamentals",
      "sportsmanship values",
      "practice sessions",
    ],
    adjacentKeys: ["stakeholder_coordination", "customer_service_guest_experience"],
  },
  {
    key: "prospecting_pipeline_management",
    label: "prospecting, outreach, and pipeline management",
    kind: "execution",
    functionTag: "sales_bd",
    profilePhrases: [
      "prospect",
      "prospecting",
      "pipeline",
      "cold calling",
      "cold call",
      "outreach",
      "lead generation",
      "lead gen",
      "new business",
      "b2b prospects",
      "sales presentations",
      "closed new accounts",
      "closed new advertising accounts",
    ],
    profileWeakPhrases: ["client communication", "client meetings", "scheduling client meetings"],
    jobPhrases: [
      "prospect",
      "prospecting",
      "pipeline",
      "cold call",
      "cold calling",
      "outreach",
      "lead generation",
      "new business",
      "sales calls",
      "sales presentations",
    ],
    adjacentKeys: ["account_management", "territory_execution"],
  },
  {
    key: "account_management",
    label: "account support and account management",
    kind: "stakeholder",
    functionTag: "sales_bd",
    profilePhrases: [
      "account management",
      "account support",
      "customer relationship",
      "customer success",
      "client portfolio",
      "book of business",
      "maintained accounts",
      "supported accounts",
    ],
    profileWeakPhrases: ["client communication", "client meetings", "scheduling client meetings"],
    jobPhrases: [
      "account management",
      "account support",
      "support accounts",
      "maintain accounts",
      "account growth",
      "customer accounts",
      "book of business",
    ],
    adjacentKeys: ["prospecting_pipeline_management", "post_sale_support"],
  },
  {
    key: "territory_execution",
    label: "territory coverage and field sales execution",
    kind: "execution",
    functionTag: "sales_bd",
    profilePhrases: [
      "territory",
      "territory management",
      "territory coverage",
      "regional accounts",
      "field sales",
      "travel to accounts",
      "onsite customer visits",
    ],
    jobPhrases: [
      "territory",
      "territory coverage",
      "territory management",
      "field sales",
      "assigned territory",
      "regional sales",
      "drive utilization",
      "grow utilization",
      "onsite account visits",
      "cover cases",
    ],
    adjacentKeys: ["account_management", "hospital_or_environment"],
  },
  {
    key: "crm_usage",
    label: "crm usage and sales system hygiene",
    kind: "tool",
    functionTag: "sales_bd",
    profilePhrases: [
      "crm",
      "salesforce",
      "hubspot",
      "lead tracking",
      "opportunity tracking",
      "pipeline tracking",
      "customer database",
    ],
    profileWeakPhrases: ["excel", "spreadsheets"],
    jobPhrases: [
      "crm",
      "salesforce",
      "hubspot",
      "customer relationship management",
      "pipeline tracking",
      "opportunity management",
    ],
    adjacentKeys: [],
  },
  {
    key: "post_sale_support",
    label: "post-sale support, follow-up, and replenishment support",
    kind: "execution",
    functionTag: "sales_bd",
    profilePhrases: [
      "post-sale",
      "post sale",
      "follow-up",
      "customer follow-up",
      "implementation support",
      "client onboarding",
      "customer onboarding",
      "renewal support",
      "replenishment",
      "after-sale support",
      "after sales support",
    ],
    jobPhrases: [
      "post-sale",
      "post sale",
      "follow-up",
      "follow up",
      "replenishment",
      "implementation support",
      "customer support after purchase",
      "account follow-up",
      "support after sale",
    ],
    adjacentKeys: ["account_management", "product_training_enablement"],
  },
  {
    key: "product_training_enablement",
    label: "product training, in-service support, and product introductions",
    kind: "deliverable",
    functionTag: "sales_bd",
    profilePhrases: [
      "product demo",
      "product demonstrations",
      "training",
      "trained",
      "education sessions",
      "onboarding sessions",
      "in-service",
      "presented products",
      "product intro",
      "introduced products",
    ],
    jobPhrases: [
      "in-service",
      "in service",
      "product training",
      "train staff",
      "educate staff",
      "product intro",
      "product introduction",
      "demo",
      "demonstration",
      "case support",
    ],
    adjacentKeys: ["post_sale_support", "clinical_stakeholder_fluency"],
  },
  {
    key: "hospital_or_environment",
    label: "hospital, operating room, or procedural environment exposure",
    kind: "function",
    functionTag: "premed_clinical",
    profilePhrases: [
      "operating room",
      "orthopedic",
      "surgical",
      "hospital",
      "trauma center",
      "emt",
      "physician-facing",
      "physician facing",
      "surgeon",
      "sterile field",
      "scrub",
    ],
    jobPhrases: [
      "operating room",
      "orthopedic",
      "surgical",
      "hospital",
      "case coverage",
      "procedural environment",
      "surgeon",
      "sterile field",
    ],
    adjacentKeys: ["clinical_stakeholder_fluency"],
    suppressAnalyticsHeavy: true,
  },
  {
    key: "clinical_stakeholder_fluency",
    label: "clinical stakeholder communication and physician-facing fluency",
    kind: "stakeholder",
    functionTag: "premed_clinical",
    profilePhrases: [
      "physician-facing",
      "physician facing",
      "provider communication",
      "clinical staff",
      "surgeon interaction",
      "patient communication",
      "care team",
      "worked with physicians",
      "worked with surgeons",
    ],
    profileWeakPhrases: ["patient"],
    jobPhrases: [
      "physician",
      "surgeon",
      "clinical team",
      "hospital staff",
      "work with surgeons",
      "work with physicians",
      "support clinicians",
    ],
    adjacentKeys: ["hospital_or_environment", "product_training_enablement"],
    suppressAnalyticsHeavy: true,
  },
  {
    key: "med_device_industry_knowledge",
    label: "medical device industry, product, and competitive knowledge",
    kind: "function",
    functionTag: "sales_bd",
    profilePhrases: [
      "medical device sales",
      "device sales",
      "implant sales",
      "orthopedic device",
      "capital equipment sales",
      "competitive device knowledge",
      "device portfolio",
      "clinical sales specialist",
      "medical device industry",
    ],
    profileWeakPhrases: ["emt", "clinical", "hospital", "patient care"],
    jobPhrases: [
      "medical device industry",
      "device industry",
      "competitive trends",
      "competitive knowledge",
      "acumed customers",
      "product portfolio",
      "device product knowledge",
      "industry knowledge",
    ],
    adjacentKeys: ["hospital_or_environment", "product_training_enablement"],
  },
  {
    key: "client_commercial_work",
    label: "generic client-facing or commercial support work",
    kind: "stakeholder",
    functionTag: "operations_general",
    minMatches: 2,
    profilePhrases: [
      "client",
      "client-facing",
      "relationship building",
      "stakeholder management",
    ],
    profileWeakPhrases: [
      "client communication",
      "maintaining client communication",
      "scheduling client meetings",
      "client meetings",
    ],
    jobPhrases: [
      "client",
      "client-facing",
      "relationship building",
    ],
    adjacentKeys: ["stakeholder_coordination", "account_management"],
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
      "safety standards",
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
      "safety",
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
"ad hoc financial",
"fp&a",
"fp &a",
"financial planning",
"variance analysis",
"expense analysis", 
"expense reporting",
"management reporting",
"budget",
"forecast",
"cash flow",
"profitability",
"balance sheet",
"revenue reporting",
"competitive analysis",  // when in finance context
"financial package",
"board-level",
"board level",
    ],
    adjacentKeys: ["analysis_reporting"],
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
"management reporting",
"daily review",
"weekly review", 
"monthly review",
"business performance",
"ad hoc analysis",
"planning and forecasting",
"cash application",
"accounts payable",
"accounts receivable",
"treasury",
"regulatory",
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
    adjacentKeys: ["hospital_or_environment", "clinical_stakeholder_fluency"],
    suppressAnalyticsHeavy: true,
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
      "logistics",
      "game day execution",
      "staff coordination",
      "event operations",
    ],
    jobPhrases: [
      "operations",
      "process improvement",
      "workflow",
      "project management",
      "program management",
      "cross-functional",
      "process",
      "logistics",
      "game day",
      "supervise",
      "schedule",
      "weekends and evenings",
    ],
    adjacentKeys: ["stakeholder_coordination", "analysis_reporting"],
  },
  {
    key: "strategy_problem_solving",
    label: "strategy, synthesis, and problem-solving work",
    kind: "function",
    functionTag: "consulting_strategy",
    minMatches: 2,
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
      "hypothesis",
      "presentation",
    ],
    adjacentKeys: ["analysis_reporting", "consumer_research", "stakeholder_coordination"],
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
      "presented to",
      "players and families",
      "media, operations staff, and event personnel",
      "sponsor needs",
      "coaches",
      "parents",
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
      "build relationships",
      "players, parents, and coaches",
      "players and coaches",
      "volunteer coaches",
    ],
    adjacentKeys: ["operations_execution", "account_management"],
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
  salesforce: ["salesforce", "sales force"],
  shopify: ["shopify"],
  "google analytics": ["google analytics", "ga4"],
  spss: ["spss"],
  autocad: ["autocad"],
  crm: ["crm", "customer relationship management"],
}

const NEVER_CORE_KEYS = new Set([
  "clinical_patient_work",
  "drafting_documentation",
  "communications_writing",
  "consumer_research",
  "analysis_reporting",
  "strategy_problem_solving",
])

const FALLBACK_JOB_RULES: Array<{
  key: string
  label: string
  kind: EvidenceKind
  functionTag?: FunctionTag
  phrases: string[]
  requiredness?: "core" | "supporting"
}> = [
  {
    key: "event_operations_live_execution",
    label: "live event, venue, and game-day operations execution",
    kind: "execution",
    functionTag: "operations_general",
    requiredness: "core",
    phrases: [
      "game day",
      "practices and games",
      "supervise the overall operation",
      "overall operation of designated sport",
      "hands-on involvement",
      "hands on involvement",
      "event operations",
      "sport coordinator",
    ],
  },
  {
    key: "customer_service_guest_experience",
    label: "customer service, guest experience, and issue resolution",
    kind: "stakeholder",
    functionTag: "operations_general",
    requiredness: "supporting",
    phrases: [
      "customer service",
      "superior customer service",
      "build relationships with players, parents, and coaches",
      "players, parents, and coaches",
      "players and coaches",
      "i9 sports experience",
      "guest experience",
      "fan services",
    ],
  },
  {
    key: "coaching_instruction_facilitation",
    label: "coaching, instruction, and fundamentals-based facilitation",
    kind: "deliverable",
    functionTag: "operations_general",
    requiredness: "supporting",
    phrases: [
      "observing, assessing, and assisting our coaches",
      "empower volunteer coaches",
      "teach",
      "demonstrate core concepts",
      "sportsmanship values",
      "fundamentals",
      "practice sessions",
    ],
  },
  {
    key: "stakeholder_coordination",
    label: "stakeholder coordination and cross-functional execution",
    kind: "stakeholder",
    functionTag: "operations_general",
    requiredness: "supporting",
    phrases: [
      "build professional relationships",
      "parents",
      "coaches",
      "players",
      "communicate",
      "relationship",
    ],
  },
  {
    key: "operations_execution",
    label: "operations, process, and workflow execution",
    kind: "execution",
    functionTag: "operations_general",
    requiredness: "supporting",
    phrases: [
      "schedule",
      "weekends",
      "evenings",
      "self-starter",
      "work independently",
      "solve problems",
      "take charge",
      "safety of players",
    ],
  },
]

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

function countWeakHits(hay: string, phrases?: string[]): number {
  if (!phrases?.length) return 0
  return countHits(hay, phrases)
}

function splitEvidenceLines(text: string): string[] {
  const raw = String(text || "")
  if (!raw.trim()) return []

  const actionSplit =
    /(?=\b(Conducted|Reviewed|Drafted|Prepared|Presented|Analyzed|Researched|Coordinated|Supported|Executed|Created|Developed|Managed|Led|Produced|Tracked|Wrote|Collaborated|Applied|Organized|Observed|Supervised|Empower|Teach|Demonstrate|Build)\b)/

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
    /\b(conducted|analyzed|built|created|developed|managed|supported|coordinated|prepared|drafted|reviewed|researched|presented|executed|optimized|led|designed|translated|closed|sold|prospected|trained|served|observed|assisted|facilitated|mentored)\b/i.test(
      line
    )
  ) score += 4

  if (/\b(with|using|for|across|including|through)\b/i.test(line)) score += 1
  if (
    /\b(client|stakeholder|campaign|portfolio|policy|regulatory|reporting|brand|content|research|analysis|sales|pipeline|hospital|surgical|surgeon|guest|fan|event|game day|coach|coach(es)?|player|parent)\b/i.test(
      line
    )
  ) score += 2
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

  if (t.length >= 20) score += 1
  if (t.length >= 30) score += 2

  if (
    /\b(responsible for|responsibilities include|you will|will be|support|conduct|analyze|develop|manage|prepare|execute|coordinate|collaborate|assist|drive|build|create|own|train|educate|cover|supervise|teach|demonstrate|observe|assess|empower)\b/i.test(
      line
    )
  ) score += 4

  if (/\b(required|preferred|must|proficient|experience with|ability to|qualifications)\b/i.test(line)) score += 2
  if (
    /\b(research|analysis|reporting|campaign|content|design|financial|client|stakeholder|policy|regulatory|operations|sales|crm|territory|hospital|surgical|surgeon|guest|fan|event|game day|coach|player|parent|customer service|sportsmanship)\b/i.test(
      line
    )
  ) score += 2

  if (/\b(equal opportunity|benefits|compensation may vary|about us|who we are|our values)\b/i.test(line)) score -= 5
  if (t.length < 16) score -= 2

  // Aspirational / learning language — these describe skills the candidate WILL GAIN,
  // not skills they must already have. Penalise so lines score below the < 2 threshold
  // and are dropped from requirement extraction entirely.
  // Examples: "you will learn Excel", "gain exposure to financial modeling",
  // "training provided on Salesforce", "develop your skills in PowerPoint"
  if (
    /\b(you will learn|you('ll| will) (gain|develop|build|grow|be (trained|taught|introduced|exposed)|acquire)|gain exposure to|exposure to|training (will be|is) provided|training provided|we('ll| will) train|on.the.job training|learn (how to|to use|the tools)|be introduced to|build your (skills|knowledge|foundation)|develop your (skills|understanding)|skills? (will be )?(taught|developed|built|gained))\b/i.test(line)
  ) score -= 6

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
    if (tag === "sales_bd") score.Sales += 6
    if (tag === "premed_clinical") score.PreMed += 4

    if (tag === "finance_corp") score.Finance += 5
    if (tag === "accounting_finops") score.Accounting += 5

    if (tag === "data_analytics_bi") score.Analytics += 3
    if (tag === "consumer_insights_research") score.Analytics += 2

    if (tag === "brand_marketing") score.Marketing += 4
    if (tag === "communications_pr") score.Marketing += 3
    if (tag === "content_social") score.Marketing += 3
    if (tag === "growth_performance") score.Marketing += 4
    if (tag === "product_marketing") score.Marketing += 5

    if (tag === "consulting_strategy") score.Consulting += 3
    if (tag === "operations_general") score.Consulting += 1

    if (tag === "legal_regulatory") score.Other += 8
    if (tag === "creative_design" || tag === "other") score.Other += 4
  }

  if (score.Sales > 0 && score.PreMed > 0) score.Sales += 2

  const ordered: JobFamily[] = [
    "Sales",
    "Marketing",
    "Consulting",
    "Finance",
    "Accounting",
    "Analytics",
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
  const l = line.toLowerCase()

  // Explicit core signals
  if (
    /\b(required|must|responsible for|you will|primary responsibility|own|lead|territory|supervise|teach|observe|assess|empower)\b/i.test(l)
  ) {
    return "core"
  }

  // Lines describing what the role does day to day are core
  if (
    /\b(assist|support|help|coordinate|manage|execute|maintain|prepare|analyze|document|translate|gather|collect|validate|review|participate|identify|perform)\b/i.test(l) &&
    l.length > 40
  ) {
    return "core"
  }

  return "supporting"
}

function profileRuleStrength(
  rule: CapabilityRule,
  cleaned: string,
  lineScore: number,
  hits: number
): number {
  const n = norm(cleaned)
  let strength = lineScore + hits + (rule.kind === "function" ? 1 : 0)

  const weakHits = countWeakHits(n, rule.profileWeakPhrases)
  const boostHits = countHits(n, rule.profileBoostPhrases || [])

  strength += boostHits
  strength -= weakHits * 3

  if (
    rule.key === "client_commercial_work" &&
    /\b(scheduling client meetings|maintaining client communication|client meetings)\b/i.test(cleaned)
  ) {
    strength -= 4
  }

  if (
    rule.key === "clinical_stakeholder_fluency" &&
    /\b(patient)\b/i.test(cleaned) &&
    !/\b(physician|surgeon|provider|clinical staff)\b/i.test(cleaned)
  ) {
    strength -= 2
  }

  return Math.max(1, Math.min(10, strength))
}

function jobRuleStrength(
  rule: CapabilityRule,
  cleaned: string,
  lineScore: number,
  hits: number
): number {
  const n = norm(cleaned)
  let strength = lineScore + hits + (rule.kind === "function" ? 1 : 0)
  const weakHits = countWeakHits(n, rule.jobWeakPhrases)
  const boostHits = countHits(n, rule.jobBoostPhrases || [])
  strength += boostHits
  strength -= weakHits * 2

  if (
    rule.key === "strategy_problem_solving" &&
    /\b(sales strategy|territory strategy|drive utilization|field strategy)\b/i.test(cleaned)
  ) {
    strength -= 2
  }

  if (
    rule.key === "analysis_reporting" &&
    /\b(salesforce|crm|territory|operating room|surgeon|hospital)\b/i.test(cleaned)
  ) {
    strength -= 2
  }

  return Math.max(1, Math.min(10, strength))
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
  let inRequiredSection = false

  for (const line of lines) {
    const cleaned = cleanLine(line)

    // Track required vs preferred sections
    if (/\b(required qualifications|key responsibilities|essential functions|must have)\b/i.test(cleaned)) {
      inRequiredSection = true
    }
    if (/\b(preferred qualifications|nice to have|about us|benefits|compensation)\b/i.test(cleaned)) {
      inRequiredSection = false
    }
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

    if (
      side === "job" &&
      (
        /\bcode of conduct\b/i.test(cleaned) ||
        /\bprivacy and confidentiality\b/i.test(cleaned) ||
        /\bacting with ethics and integrity\b/i.test(cleaned) ||
        /\breporting non-compliance\b/i.test(cleaned) ||
        /\badhering to applicable federal, state and local laws and regulations\b/i.test(cleaned) ||
        /\baccreditation and licenser requirements\b/i.test(cleaned) ||
        /\bpolicies and procedures\b/i.test(cleaned)
      )
    ) {
      continue
    }

    for (const rule of CAPABILITY_RULES) {
      const phrases = side === "job" ? rule.jobPhrases : rule.profilePhrases
      const hits = countHits(n, phrases)
      const minMatches = rule.minMatches ?? 1
      if (hits < minMatches) continue

      if (
        side === "job" &&
        rule.key === "strategy_problem_solving" &&
        (
          /\bmarketing strategy and tactics\b/i.test(cleaned) ||
          /\bsales techniques\b/i.test(cleaned) ||
          /\bsales control systems\b/i.test(cleaned) ||
          /\btargeted sales strategy\b/i.test(cleaned) ||
          /\bexecute business plans\b/i.test(cleaned)
        )
      ) {
        continue
      }

      debugHits[rule.key] = (debugHits[rule.key] || 0) + hits

      const strength =
        side === "job"
          ? jobRuleStrength(rule, cleaned, lineScore, hits)
          : profileRuleStrength(rule, cleaned, lineScore, hits)

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
            inRequiredSection ? "core" : detectRequiredness(cleaned),
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
            inRequiredSection ? "core" : detectRequiredness(cleaned)
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

function buildFallbackJobUnits(lines: string[]): {
  units: JobRequirementUnit[]
  functionTags: FunctionTag[]
  hits: Record<string, number>
} {
  const units: JobRequirementUnit[] = []
  const functionTags = new Set<FunctionTag>()
  const hits: Record<string, number> = {}

  for (const line of lines) {
    const cleaned = cleanLine(line)
    const n = norm(cleaned)
    if (!n) continue

    const baseScore = scoreJobLine(cleaned)
    if (baseScore < 1) continue

    for (const rule of FALLBACK_JOB_RULES) {
      const ruleHits = countHits(n, rule.phrases)
      if (ruleHits < 1) continue

      hits[rule.key] = (hits[rule.key] || 0) + ruleHits
      if (rule.functionTag) functionTags.add(rule.functionTag)

      units.push(
        makeJobUnit(
          rule.key,
          rule.label,
          rule.kind,
          cleaned,
          Math.max(4, Math.min(8, baseScore + ruleHits)),
          rule.requiredness || "supporting",
          rule.functionTag
        )
      )
    }
  }

  return {
    units: dedupeUnits(units),
    functionTags: Array.from(functionTags),
    hits,
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
      // 0 minimum means entry-level — treat as no meaningful requirement
      if (!Number.isNaN(v) && v > 0 && v <= 20) return v
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
  if (/\bocala\b/.test(t)) return "Ocala"
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

function detectAnalytics(jobText: string, tags: FunctionTag[], jobUnits: JobRequirementUnit[]): { isHeavy: boolean; isLight: boolean } {
  const t = norm(jobText)
  const cfg = (POLICY as any)?.extraction?.analytics || {}
  const heavyKeywords = asStringArray(cfg.heavyKeywords).map(norm)
  const lightKeywords = asStringArray(cfg.lightKeywords).map(norm)
  const optInRoleKeywords = asStringArray(cfg.optInRoleKeywords).map(norm)
  const optOutRoleKeywords = asStringArray(cfg.optOutRoleKeywords).map(norm)

  const heavyKeywordHits = heavyKeywords.filter((k) => includesPhrase(t, k)).length
  const optInHits = optInRoleKeywords.filter((k) => includesPhrase(t, k)).length
  const optOutHits = optOutRoleKeywords.filter((k) => includesPhrase(t, k)).length

  const analyticsUnitCount = jobUnits.filter(
    (u) => u.key === "analysis_reporting" || u.key === "consumer_research"
  ).length

  const heavyByTags = tags.includes("data_analytics_bi") && analyticsUnitCount >= 2
  const isHeavy = (heavyKeywordHits >= 2 || optInHits >= 1 || heavyByTags) && optOutHits === 0
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
      /\b(intern|internship|analyst|assistant|coordinator|associate|manager|emt|clerk|specialist|sales|coach|volunteer|representative|staff)\b/i.test(line)
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

function selectBestJobUnits(units: JobRequirementUnit[]): JobRequirementUnit[] {
  return Array.from(
    new Map(
      units
        .sort((a, b) => b.strength - a.strength)
        .map((u) => [u.key, u] as const)
    ).values()
  ).map((u) =>
    NEVER_CORE_KEYS.has(u.key)
      ? { ...u, requiredness: "supporting" as const }
      : u
  )
}

function mergeFunctionTagEvidence(
  base: Partial<Record<FunctionTag, string[]>>,
  extra: Partial<Record<FunctionTag, string[]>>
): Partial<Record<FunctionTag, string[]>> {
  const out: Partial<Record<FunctionTag, string[]>> = { ...base }

  for (const [tag, lines] of Object.entries(extra) as Array<[FunctionTag, string[]]>) {
    const existing = out[tag] || []
    const merged = Array.from(new Set([...(existing || []), ...(lines || [])])).slice(0, 5)
    out[tag] = merged
  }

  return out
}


// ── Finance sub-family detection ─────────────────────────────────────────────
// Classifies a Finance job or profile into a specific sub-family based on
// requirement unit keys, function tags, and keyword signals.

function inferJobFinanceSubFamily(
  normalized: string,
  requirementUnits: JobRequirementUnit[],
  functionTags: FunctionTag[]
): FinanceSubFamily {
  const unitKeys = requirementUnits.map((u) => u.key)
  const hasProspecting = unitKeys.includes("prospecting_pipeline_management")
  const hasFinancialAnalysis = unitKeys.includes("financial_analysis")
  const hasAccountingOps = unitKeys.includes("accounting_operations")
  const hasAnalysisReporting = unitKeys.includes("analysis_reporting")
  const hasPolicyRegulatory = unitKeys.includes("policy_regulatory_research")

  // IB signals: deal language + prospecting/BD + financial analysis
  const ibKeywords = /\b(investment banking|mergers and acquisitions|m&a|capital raising|ipo|leveraged buyout|lbo|deal advisory|pitch book|pitchbook|coverage group|bulge bracket|analyst program|summer analyst)\b/i
  if (ibKeywords.test(normalized) || (hasProspecting && hasFinancialAnalysis)) {
    return "ib"
  }

  // Project Finance signals: infrastructure/energy + tax equity + deal execution
  const pfKeywords = /\b(project finance|tax equity|solar|wind|battery storage|renewable energy|ppa|power purchase|infrastructure finance|tax credit|clean energy financing)\b/i
  if (pfKeywords.test(normalized) && (hasFinancialAnalysis || hasAccountingOps)) {
    return "project_finance"
  }

  // Credit signals: borrower/underwriting/default language
  const creditKeywords = /\b(credit analysis|credit analyst|underwriting|borrower|probability of default|debt capacity|loan|credit risk|credit underwriting|lending|credit memo)\b/i
  if (creditKeywords.test(normalized) || (hasAccountingOps && hasPolicyRegulatory && !hasAnalysisReporting)) {
    return "credit"
  }

  // Asset Management signals: portfolio/fund/AUM language
  const amKeywords = /\b(asset management|portfolio management|fund analysis|aum|investment management|equity research|fixed income|hedge fund|mutual fund|portfolio analyst|fund accounting)\b/i
  if (amKeywords.test(normalized)) {
    return "asset_management"
  }

  // FP&A / Corporate Finance signals: budgeting/variance/forecasting dominant
  const fpaKeywords = /\b(fp&a|fpa|financial planning|budgeting|variance analysis|forecasting|board package|board reporting|monthly close|quarterly close|corporate finance|financial controller)\b/i
  if (fpaKeywords.test(normalized) || (hasAnalysisReporting && hasAccountingOps && !hasProspecting)) {
    return "fpa"
  }

  return "other_finance"
}

function inferProfileFinanceSubFamily(
  normalized: string,
  evidenceUnits: ProfileEvidenceUnit[]
): FinanceSubFamily {
  const unitKeys = new Set(evidenceUnits.map((u) => u.key))

  // Check evidence unit keys for FP&A signals
  const hasFpaExecution = unitKeys.has("analysis_reporting") || unitKeys.has("accounting_operations")
  const hasFinancialAnalysis = unitKeys.has("financial_analysis")

  // FP&A language in profile
  const fpaKeywords = /\b(fp&a|fpa|variance analysis|board package|board reporting|monthly close|quarterly report|financial planning|budgeting|forecast accuracy|operating expense|opex|p&l|profit and loss)\b/i
  if (fpaKeywords.test(normalized) && hasFpaExecution) {
    return "fpa"
  }

  // IB language in profile
  const ibKeywords = /\b(investment banking|m&a|mergers|capital markets|ipo|lbo|deal|pitch book|pitchbook|bulge bracket|boutique bank|coverage|ibd)\b/i
  if (ibKeywords.test(normalized)) {
    return "ib"
  }

  // Project Finance in profile
  const pfKeywords = /\b(project finance|tax equity|renewable energy|solar|wind|infrastructure finance|ppa|deal execution)\b/i
  if (pfKeywords.test(normalized)) {
    return "project_finance"
  }

  // Credit in profile
  const creditKeywords = /\b(credit analysis|underwriting|borrower|loan analysis|credit risk|probability of default|debt capacity)\b/i
  if (creditKeywords.test(normalized)) {
    return "credit"
  }

  // Asset Management in profile
  const amKeywords = /\b(asset management|portfolio management|equity research|fund|aum|fixed income|hedge fund)\b/i
  if (amKeywords.test(normalized)) {
    return "asset_management"
  }

  if (hasFinancialAnalysis || hasFpaExecution) {
    return "fpa" // default for Finance profiles is FP&A if no specific signal
  }

  return null
}

// Sub-family compatibility matrix — how penalizable is each pairing?
// 0 = no penalty, 1 = light, 2 = moderate, 3 = heavy
const SUBFAMILY_DISTANCE: Record<string, Record<string, number>> = {
  ib:               { ib: 0, fpa: 2, credit: 1, project_finance: 1, asset_management: 1, other_finance: 1 },
  fpa:              { ib: 2, fpa: 0, credit: 1, project_finance: 1, asset_management: 1, other_finance: 0 },
  credit:           { ib: 1, fpa: 1, credit: 0, project_finance: 0, asset_management: 1, other_finance: 0 },
  project_finance:  { ib: 1, fpa: 1, credit: 0, project_finance: 0, asset_management: 1, other_finance: 0 },
  asset_management: { ib: 1, fpa: 1, credit: 1, project_finance: 1, asset_management: 0, other_finance: 0 },
  other_finance:    { ib: 1, fpa: 0, credit: 0, project_finance: 0, asset_management: 0, other_finance: 0 },
}

export function getFinanceSubFamilyDistance(
  jobSub: FinanceSubFamily,
  profileSub: FinanceSubFamily
): number {
  if (!jobSub || !profileSub) return 0
  return SUBFAMILY_DISTANCE[jobSub]?.[profileSub] ?? 1
}

export function extractJobSignals(jobTextRaw: string): StructuredJobSignals {
  const normalized = norm(jobTextRaw)
  const rawHash = stableHash(normalized)

  const lines = splitEvidenceLines(jobTextRaw)
  const built = buildUnitsFromLines(lines, "job")

  const fallback = built.jobUnits.length === 0 ? buildFallbackJobUnits(lines) : { units: [], functionTags: [], hits: {} }

  const mergedJobUnits = built.jobUnits.length > 0 ? built.jobUnits : fallback.units
  const mergedFunctionTags = Array.from(new Set([...(built.functionTags || []), ...(fallback.functionTags || [])]))
  const mergedDebugHits = { ...built.debugHits, ...fallback.hits }

  const functionTags = mergedFunctionTags
  const requirementUnits = selectBestJobUnits(mergedJobUnits)

  // Law firm / legal ops context overrides family classification
  const isLegalOpsContext =
    /\b(law firm|legal operations|legal ops|in-house legal|general counsel|legal department|paralegal|legal team|legal staff|legal counsel)\b/i.test(normalized)

  // Title-based family override — sparse postings often don't have enough body
  // text for tag-based classification to work correctly.
  // Check first 1500 chars (covers title + department + reporting line).
  // Note: norm() lowercases and preserves & so "FP&A" becomes "fp&a"
  const jobTitleSlice = normalized.slice(0, 1500)
  const jobTitleIsFinance =
    /\b(finance intern|financial analyst|fp&a|fpa intern|fpa analyst|treasury|investment banking|accounting intern|financial intern|finance associate|finance coordinator|corporate finance|financial planning|project finance|investor relations|investment analyst|capital markets|private equity|asset management|portfolio analyst)\b/i.test(jobTitleSlice)
  const jobTitleIsSales =
    /\b(sales intern|account executive|account manager|business development|territory manager|sales representative|sales associate)\b/i.test(jobTitleSlice)

  // Marketing title detection — prevents BD-support language in marketing roles
  // from triggering sales classification
  const jobTitleIsMarketing =
    /\b(marketing coordinator|marketing manager|marketing associate|marketing intern|marketing specialist|marketing director|brand manager|brand coordinator|content manager|communications coordinator|communications manager|growth manager|product marketing)\b/i.test(jobTitleSlice)

  // Seniority detection — check the first 300 chars (title line).
  // Manager/Director/Senior/Lead/VP in the title signals a level above early-career.
  const isSeniorRole =
    /\b(senior|lead|manager|director|vp|vice president|head of|principal|associate director|associate manager)\b/i.test(
      normalized.slice(0, 300)
    )

  // Inject default finance units when title signals Finance but body extracted nothing finance-related
  if (jobTitleIsFinance) {
    const hasFinanceUnit = requirementUnits.some(
      (u) => u.key === "financial_analysis" || u.key === "analysis_reporting" || u.key === "accounting_operations"
    )
    if (!hasFinanceUnit) {
      requirementUnits.push(
        makeJobUnit(
          "financial_analysis",
          "financial analysis and investment work",
          "function",
          "Finance role — financial analysis and reporting expected",
          8,
          "core",
          "finance_corp"
        )
      )
      requirementUnits.push(
        makeJobUnit(
          "analysis_reporting",
          "analysis, reporting, and measurement work",
          "execution",
          "Finance role — reporting and analysis expected",
          7,
          "supporting",
          "finance_corp"
        )
      )
    }
    if (!functionTags.includes("finance_corp")) {
      functionTags.push("finance_corp")
    }
  }

  const jobFamilyFromTags = familyFromFunctionTags(functionTags)
  const jobFamily: JobFamily = isLegalOpsContext
    ? "Other"
    : jobTitleIsMarketing && jobFamilyFromTags === "Sales"
      ? "Marketing"
      : jobTitleIsFinance && jobFamilyFromTags !== "Finance"
        ? "Finance"
        : jobTitleIsSales
          ? "Sales"
          : jobFamilyFromTags
  const analytics = detectAnalytics(jobTextRaw, functionTags, requirementUnits)
  const location = detectLocationMode(jobTextRaw)
  const yearsRequired = extractYearsRequired(normalized)
  const gradYearHint = extractGradYearHint(normalized)

  const mbaKeywords = asStringArray((POLICY as any)?.extraction?.mba?.keywords).map(norm)
  const govKeywords = asStringArray((POLICY as any)?.extraction?.government?.keywords).map(norm)
  const salesKeywords = asStringArray((POLICY as any)?.extraction?.sales?.keywords).map(norm)
  const contractKeywords = asStringArray((POLICY as any)?.extraction?.contract?.keywords).map(norm)
  const hourlyKeywords = asStringArray((POLICY as any)?.extraction?.hourly?.keywords).map(norm)

  const mbaRequired = includesAny(normalized, mbaKeywords)
// Credential hard requirements
  const lawSchoolKeywords = asStringArray((POLICY as any)?.extraction?.credential?.lawSchoolKeywords).map(norm)
  const medSchoolKeywords = asStringArray((POLICY as any)?.extraction?.credential?.medSchoolKeywords).map(norm)
  const cpaKeywords = asStringArray((POLICY as any)?.extraction?.credential?.cpaKeywords).map(norm)
  const gradDegreeKeywords = asStringArray((POLICY as any)?.extraction?.credential?.graduateDegreeKeywords).map(norm)

  const requiresLawSchool = includesAny(normalized, lawSchoolKeywords)
  const requiresMedSchool = includesAny(normalized, medSchoolKeywords)
  const requiresCPA = includesAny(normalized, cpaKeywords)
  const requiresGradDegree = includesAny(normalized, gradDegreeKeywords)

  const credentialRequired = requiresLawSchool || requiresMedSchool || requiresCPA || requiresGradDegree

  const credentialDetail = requiresLawSchool
    ? "law school enrollment or JD"
    : requiresMedSchool
    ? "medical school enrollment or MD/RN"
    : requiresCPA
    ? "CPA license"
    : requiresGradDegree
    ? "graduate degree"
    : null

  const isGovernment =
    includesAny(normalized, govKeywords) ||
    functionTags.includes("government_cleared") ||
    /\b(federal government|state government|county government|city government|municipal government|public sector agency|government agency|department of|ministry of)\b/i.test(normalized)

  const explicitSalesEvidence =
    requirementUnits.filter((u) =>
      [
        "prospecting_pipeline_management",
        "account_management",
        "territory_execution",
        "crm_usage",
        "post_sale_support",
        "product_training_enablement",
        "med_device_industry_knowledge",
        "client_commercial_work",
      ].includes(u.key)
    ).length >= 2

  // Hard sales keywords — quota, commission, closing, cold call are unambiguous
  // regardless of job title
  const hardSalesKeywords = ["quota", "commission", "closing", "cold call", "cold calling"]
  const hasHardSalesSignal = includesAny(normalized, hardSalesKeywords)

  // For marketing-titled roles, only flag as sales-heavy if hard sales keywords
  // are present. BD support language (pitch, proposals, leads) is normal in
  // marketing roles and should not trigger sales classification.
  const isSalesHeavy = jobTitleIsMarketing
    ? hasHardSalesSignal
    : includesAny(normalized, salesKeywords) || explicitSalesEvidence

  const isContract = includesAny(normalized, contractKeywords)
  const isHourly = includesAny(normalized, hourlyKeywords) || /\$\s*\d+(\.\d+)?\s*\/\s*(hr|hour)\b/i.test(jobTextRaw)

  const { required, preferred } = extractToolRequirements(jobTextRaw)

  // Training program detection — if the job describes skills the candidate WILL LEARN
  // rather than skills they must already have, flag it so scoring can apply a softer posture.
  const jobTextLower = norm(jobTextRaw)
  const isTrainingProgram =
    /\b(development program|training program|rotational program|advisor development|advisor training|associate development|associate training|learn and (develop|grow)|skills (you|they|we|our) (will|can) (develop|gain|build|learn)|gain (exposure|experience|skills) in|we('ll| will) teach|on-the-job (training|learning)|training is provided|hands.on training|you will (learn|be trained|be taught|develop skills))\b/i.test(
      jobTextLower
    )
  if (isTrainingProgram) {
    console.log("[extract] Training program detected — aspirational skills will not be treated as hard requirements")
  }

  // Generic industry domain requirement detection — fires when a job explicitly
  // requires experience in a domain-specific industry that a generalist
  // early-career candidate is unlikely to have.
  //
  // Detection approach: look for "[industry term] experience/background/knowledge"
  // or "experience in/with [industry term]" patterns. Industry terms are those
  // where prior domain exposure is genuinely required (not just preferred).
  //
  // AEC, healthcare, legal, financial services, biotech/pharma, real estate,
  // media/entertainment, and similar verticals all qualify.

  const DOMAIN_INDUSTRY_TERMS = [
    // AEC
    "aec",
    "architecture, engineering",
    "architecture and engineering",
    "architecture & engineering",
    "construction management",
    "construction industry",
    // Healthcare / life sciences
    "healthcare industry",
    "health care industry",
    "life sciences",
    "pharmaceutical industry",
    "biotech industry",
    "clinical",
    // Legal / professional services
    "legal industry",
    "law firm",
    "professional services industry",
    // Financial services (beyond general finance)
    "financial services industry",
    "asset management industry",
    "private equity industry",
    "investment banking industry",
    "insurance industry",
    // Real estate
    "real estate industry",
    "commercial real estate",
    // Media / entertainment / sports
    "media industry",
    "entertainment industry",
    "sports industry",
    // Manufacturing / industrial
    "manufacturing industry",
    "industrial industry",
    // Hospitality / retail
    "hospitality industry",
    "retail industry",
  ]

  // Match "[domain] experience/background/knowledge" or
  // "experience in/with/within [domain]" or
  // "background in/with [domain]"
  const domainRequirementPattern = new RegExp(
    "(" +
      DOMAIN_INDUSTRY_TERMS.map((t) =>
        t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      ).join("|") +
      ")\\s*(experience|background|knowledge|familiarity|exposure)" +
      "|" +
      "(experience|background|familiarity|exposure)\\s+(in|with|within|in the)\\s+(" +
      DOMAIN_INDUSTRY_TERMS.map((t) =>
        t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      ).join("|") +
      ")",
    "i"
  )

  const domainMatch = domainRequirementPattern.exec(jobTextLower)
  const requiresDomainIndustryExperience = !!domainMatch
  const detectedDomain = domainMatch
    ? (domainMatch[1] || domainMatch[5] || "").trim() || "industry-specific"
    : null

  // Keep requiresAECExperience as a named alias for backwards compatibility
  // with any scoring logic that references it directly
  const requiresAECExperience =
    requiresDomainIndustryExperience &&
    !!detectedDomain &&
    /aec|architecture|construction/i.test(detectedDomain)

  if (requiresDomainIndustryExperience) {
    console.log("[extract] Domain industry experience requirement detected:", detectedDomain)
  }

  const reportingStrong = requirementUnits.some(
    (u) => u.key === "analysis_reporting" && u.requiredness === "core"
  )

// Compute finance sub-family when job is Finance
  const jobFinanceSubFamily: import("./signals").FinanceSubFamily =
    jobFamily === "Finance"
      ? inferJobFinanceSubFamily(normalized, requirementUnits, functionTags)
      : null

return {
    rawHash,
    jobFamily,
    financeSubFamily: jobFinanceSubFamily,
    analytics,
    function_tags: functionTags,
    signal_debug: {
      hits: mergedDebugHits,
      notes: [
        "Requirement units are evidence-first and line-anchored.",
        "Function tags are derived from extracted requirement units, not used as the WHY source of truth.",
        "Commercial roles now split prospecting, accounts, territory, CRM, post-sale support, and product training into separate requirement keys.",
        built.jobUnits.length === 0
          ? "Weak-posting fallback extraction activated because no standard requirement units were detected."
          : "Standard extraction path used.",
      ],
    },
    location,
    isGovernment,
    isSalesHeavy,
    isContract,
    isHourly,
    yearsRequired,
    mbaRequired,
    credentialRequired,
    credentialDetail,
    gradYearHint,
    requiredTools: required,
    preferredTools: preferred,
    isSeniorRole: isSeniorRole,
    isTrainingProgram: isTrainingProgram,
    requiresAECExperience: requiresAECExperience,
    requiresDomainIndustryExperience: requiresDomainIndustryExperience,
    detectedDomain: detectedDomain,
    reportingSignals: { strong: reportingStrong },
    requirement_units: requirementUnits,
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
    targetFamilies: baseFamilies.length ? baseFamilies : ["Sales"],
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
   function_tag_evidence: overrides?.function_tag_evidence
  ? mergeFunctionTagEvidence(base.function_tag_evidence ?? {}, overrides.function_tag_evidence)
  : base.function_tag_evidence,
    profile_evidence_units:
      Array.isArray(overrides?.profile_evidence_units) && overrides.profile_evidence_units.length > 0
        ? overrides.profile_evidence_units
        : base.profile_evidence_units,
    gradYear: overrides?.gradYear ?? base.gradYear,
    statedInterests: overrides?.statedInterests || base.statedInterests,
    yearsExperienceApprox: overrides?.yearsExperienceApprox ?? base.yearsExperienceApprox,
  }

  // Infer finance sub-family from profile evidence when profile targets Finance
  const profileFinanceFamilies = (merged.targetFamilies || []).map((f: string) => f.toLowerCase())
  const profileFinanceSubFamily: import("./signals").FinanceSubFamily =
    profileFinanceFamilies.includes("finance")
      ? inferProfileFinanceSubFamily(
          normalized,
          merged.profile_evidence_units || []
        )
      : null

  return {
    ...merged,
    financeSubFamily: profileFinanceSubFamily,
  }
}