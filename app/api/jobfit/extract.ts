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
      "content marketing",
      "content production",
      "instagram",
      "tiktok",
      "social channel",
      "editorial calendar",
      "copywriting",
      "content strategy",
      "blog posts",
      "newsletter",
    ],
    jobPhrases: [
      "social media",
      "content creation",
      "content marketing",
      "content production",
      "instagram",
      "tiktok",
      "social channel",
      "editorial calendar",
      "content strategy",
      "marketing events",
      "brand events",
      "trade show",
      "brand activations",
      "channel execution",
      "blog posts",
      "newsletter",
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
      "user research",
      "qualitative research",
      "quantitative research",
      "survey research",
      "ux research",
      "focus group",
      "consumer behavior",
      "trend analysis",
      "social listening",
      "audience research",
      "brand research",
    ],
    jobPhrases: [
      "consumer insights",
      "market research",
      "user research",
      "qualitative research",
      "quantitative research",
      "survey research",
      "ux research",
      "focus group",
      "consumer behavior",
      "trend analysis",
      "audience research",
      "brand research",
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
      "regulatory analysis",
      "regulatory compliance",
      "regulatory affairs",
      "compliance officer",
      "compliance program",
      "contract review",
      "contract negotiation",
      "contract drafting",
      "litigation",
      "legislative",
      "safety standards",
    ],
jobPhrases: [
      "legal research",
      "policy research",
      "policy analysis",
      "regulatory analysis",
      "regulatory compliance",
      "regulatory affairs",
      "compliance officer",
      "compliance program",
      "contract review",
      "contract negotiation",
      "contract drafting",
      "litigation",
      "legislative",
      "safety standards",
      "regulatory filings",
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
      "investment portfolio",
      "portfolio management",
      "portfolio analysis",
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
      "investment portfolio",
      "portfolio management",
      "portfolio analysis",
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
"budgeting",
"budget management",
"financial forecast",
"forecasting models",
"cash flow",
"profitability analysis",
"balance sheet",
"revenue reporting",
"financial package",
"board-level reporting",
"board level reporting",
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
      "financial audit",
      "tax preparation",
      "tax filing",
      "tax accounting",
      "financial reporting",
    ],
    jobPhrases: [
      "accounting",
      "reconciliation",
      "journal entry",
      "general ledger",
      "financial audit",
      "audit support",
      "tax preparation",
      "tax filing",
      "tax accounting",
      "financial reporting",
      "management reporting",
      "ad hoc financial analysis",
      "planning and forecasting",
      "cash application",
      "accounts payable",
      "accounts receivable",
      "treasury operations",
      "financial regulatory",
      "sox compliance",
      "gaap",
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
      "medical device",
      "medical research",
      "medical records",
      "medical practice",
      "medical staff",
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

  // ── Engineering / Technical ──────────────────────────────────────
  {
    key: "structural_engineering",
    label: "Structural Engineering",
    kind: "function" as EvidenceKind,
    functionTag: "engineering_technical" as FunctionTag,
    profilePhrases: ["structural analysis", "structural design", "load analysis", "finite element", "steel design", "concrete design", "foundation design"],
    jobPhrases: ["structural analysis", "structural design", "load calculations", "finite element", "steel structures", "concrete structures", "foundation design", "foundation engineering", "structural engineering"],
    adjacentKeys: [],
  },
  {
    key: "mechanical_engineering",
    label: "Mechanical Engineering",
    kind: "function" as EvidenceKind,
    functionTag: "engineering_technical" as FunctionTag,
    profilePhrases: ["mechanical design", "thermodynamics", "fluid mechanics", "cad design", "manufacturing engineering", "tolerance analysis"],
    jobPhrases: ["mechanical design", "thermodynamics", "fluid mechanics", "manufacturing engineering", "tolerance analysis", "mechanical engineering", "product design engineering"],
    adjacentKeys: [],
  },
  {
    key: "civil_engineering",
    label: "Civil Engineering",
    kind: "function" as EvidenceKind,
    functionTag: "engineering_technical" as FunctionTag,
    profilePhrases: ["civil engineering", "site design", "grading", "stormwater", "transportation engineering", "geotechnical"],
    jobPhrases: ["civil engineering", "site design", "site grading", "stormwater", "transportation engineering", "transportation planning", "transportation design", "geotechnical", "land development engineering"],
    adjacentKeys: ["structural_engineering"],
  },
  {
    key: "electrical_engineering",
    label: "Electrical Engineering",
    kind: "function" as EvidenceKind,
    functionTag: "engineering_technical" as FunctionTag,
    profilePhrases: ["electrical design", "circuit design", "power systems", "control systems", "pcb design", "embedded systems"],
    jobPhrases: ["electrical design", "circuit design", "power systems engineering", "control systems engineering", "pcb design", "embedded systems", "electrical engineering"],
    adjacentKeys: [],
  },
  {
    key: "chemical_engineering",
    label: "Chemical Engineering",
    kind: "function" as EvidenceKind,
    functionTag: "engineering_technical" as FunctionTag,
    profilePhrases: ["chemical engineering", "process engineering", "reaction kinetics", "mass transfer", "distillation"],
    jobPhrases: ["chemical engineering", "process engineering", "reaction kinetics", "mass transfer", "distillation", "chemical process"],
    adjacentKeys: [],
  },
  {
    key: "software_engineering",
    label: "Software Engineering",
    kind: "function" as EvidenceKind,
    functionTag: "software_it" as FunctionTag,
    profilePhrases: ["software development", "full stack", "backend", "frontend", "api development", "microservices", "devops", "cloud infrastructure"],
    jobPhrases: ["software engineer", "software development", "full stack", "backend", "frontend", "api", "microservices", "devops", "cloud", "software developer"],
    adjacentKeys: [],
  },
  {
    key: "nursing_clinical",
    label: "Nursing / Clinical",
    kind: "function" as EvidenceKind,
    functionTag: "healthcare_clinical" as FunctionTag,
    profilePhrases: ["patient care", "nursing", "clinical assessment", "vital signs", "medication administration", "triage", "registered nurse", "bedside care"],
    jobPhrases: ["patient care", "registered nurse", "nurse practitioner", "lpn", "rn", "cna", "clinical assessment", "vital signs", "medication administration", "triage", "bedside", "hands-on patient"],
    adjacentKeys: [],
  },
  {
    key: "trades_construction",
    label: "Skilled Trades",
    kind: "function" as EvidenceKind,
    functionTag: "trades_skilled" as FunctionTag,
    profilePhrases: ["welding", "plumbing", "hvac", "carpentry", "electrical wiring", "machining", "cnc"],
    jobPhrases: ["welding", "plumbing", "hvac", "carpentry", "electrician", "machinist", "cnc", "journeyman", "apprentice"],
    adjacentKeys: [],
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
  autocad: ["autocad", "auto cad"],
  crm: ["crm", "customer relationship management"],

  // Engineering tools
  revit: ["revit", "autodesk revit"],
  solidworks: ["solidworks", "solid works"],
  catia: ["catia"],
  "staad pro": ["staad", "staad pro", "staad.pro"],
  sap2000: ["sap2000", "sap 2000"],
  etabs: ["etabs"],
  risa: ["risa"],
  ansys: ["ansys"],
  abaqus: ["abaqus"],
  matlab: ["matlab"],
  microstation: ["microstation"],
  civil3d: ["civil 3d", "civil3d"],
  tekla: ["tekla"],
  primavera: ["primavera", "p6"],
  procore: ["procore"],
  bluebeam: ["bluebeam"],

  // Software / IT tools
  aws: ["aws", "amazon web services"],
  azure: ["azure", "microsoft azure"],
  gcp: ["gcp", "google cloud"],
  docker: ["docker"],
  kubernetes: ["kubernetes", "k8s"],
  terraform: ["terraform"],
  jenkins: ["jenkins"],
  git: ["git", "github", "gitlab"],
  jira: ["jira"],
  react: ["react", "reactjs", "react.js"],
  node: ["node", "nodejs", "node.js"],
  java: ["java"],
  "c++": ["c++", "cpp"],
  golang: ["golang", "go lang"],
  typescript: ["typescript"],
  swift: ["swift"],
  kotlin: ["kotlin"],
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

  if (/\b(equal opportunity|benefits|compensation may vary|about us|who we are|our values|401\(?k\)?|health plan|dental|vision insurance|life insurance|disability|paid time off|pto|tuition reimbursement|employee stock|sign.on (payment|bonus)|commissions? (generated|schedule|in accordance)|money.back guarantee|cancel anytime)\b/i.test(line)) score -= 5
  if (t.length < 16) score -= 2

  // Aspirational / learning language — these describe skills the candidate WILL GAIN,
  // not skills they must already have. Penalise so lines score below the < 2 threshold
  // and are dropped from requirement extraction entirely.
  // Examples: "you will learn Excel", "gain exposure to financial modeling",
  // "training provided on Salesforce", "develop your skills in PowerPoint"
  if (
    /\b(you will learn|you('ll| will) (gain|develop|build|grow|be (trained|taught|introduced|exposed)|acquire)|gain exposure to|exposure to|training (will be|is) provided|training provided|we('ll| will) (train|teach)|on.the.job (training|learning)|learn (how to|to use|the tools|about)|be introduced to|build your (skills|knowledge|foundation)|develop your (skills|understanding|expertise)|develop (an |a )?(understanding|knowledge|expertise)|skills? (will be )?(taught|developed|built|gained)|will (receive|get) training|study time (for|to)|dedicated study|we (provide|offer) (training|study|licensing|certification)|no (prior )?experience (required|necessary|needed)|no (certification|license) required|will (prepare|equip) you)\b/i.test(line)
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

  // Suite-level expansions. A candidate who writes "Microsoft Office Suite"
  // should be credited for the individual apps the suite implies, otherwise
  // jobs that list "Excel" as a required tool will incorrectly penalize
  // them with RISK_MISSING_TOOLS. Same logic for Google Workspace / G Suite
  // and Adobe Creative Cloud / Creative Suite.
  if (/\b(microsoft office suite|ms office suite|ms office|microsoft office|office 365|o365|office suite)\b/i.test(t)) {
    out.add("excel")
    out.add("powerpoint")
    out.add("word")
  }
  if (/\b(google workspace|g ?suite|google g ?suite)\b/i.test(t)) {
    out.add("google sheets")
    out.add("google docs")
    out.add("google slides")
  }
  if (/\b(adobe creative cloud|creative cloud|adobe creative suite|creative suite)\b/i.test(t)) {
    out.add("photoshop")
    out.add("illustrator")
    out.add("indesign")
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
    Engineering: 0,
    IT_Software: 0,
    Healthcare: 0,
    Legal: 0,
    Trades: 0,
    Other: 0,
  }

  for (const tag of tags) {
    if (tag === "government_cleared") score.Government += 5
    if (tag === "sales_bd") score.Sales += 6
    if (tag === "premed_clinical") score.PreMed += 4

    if (tag === "finance_corp") score.Finance += 5
    if (tag === "accounting_finops") score.Accounting += 5

    if (tag === "data_analytics_bi") score.Analytics += 3
    // Consumer/market research is fundamentally Marketing work — it lives
    // inside marketing teams, advertising agencies, and brand orgs.
    // Give Marketing the larger share so market research analyst roles
    // classify correctly instead of falling to Analytics or Finance.
    if (tag === "consumer_insights_research") {
      score.Marketing += 4
      score.Analytics += 2
    }

    if (tag === "brand_marketing") score.Marketing += 4
    if (tag === "communications_pr") score.Marketing += 3
    if (tag === "content_social") score.Marketing += 3
    if (tag === "growth_performance") score.Marketing += 4
    if (tag === "product_marketing") score.Marketing += 5

    if (tag === "consulting_strategy") score.Consulting += 5
    // Operations roles (Chief of Staff, BusinessOps, Strategy & Ops) route
    // to Consulting because there is no dedicated Operations family. Bumped
    // from +1 to +4 so a job with heavy operations signal can beat stray
    // finance_corp / accounting_finops tags that pick up on budget and
    // reporting language in the body.
    if (tag === "operations_general") score.Consulting += 4

    if (tag === "engineering_technical") score.Engineering += 8
    if (tag === "software_it") score.IT_Software += 8
    if (tag === "healthcare_clinical") score.Healthcare += 6
    if (tag === "trades_skilled") score.Trades += 8

    if (tag === "legal_regulatory") score.Legal += 8
    if (tag === "creative_design" || tag === "other") score.Other += 4
  }

  if (score.Sales > 0 && score.PreMed > 0) score.Sales += 2

  // When BOTH healthcare_clinical and premed_clinical fire, the role is
  // clearly in the medical/life-sciences space. Boost Healthcare so it
  // beats accidental Marketing/Consulting tag pollution.
  if (score.Healthcare > 0 && score.PreMed > 0) {
    score.Healthcare += 5
    score.PreMed += 3
  }

  const ordered: JobFamily[] = [
    "Engineering",
    "IT_Software",
    "Healthcare",
    "Legal",
    "Trades",
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

  // Check for remote but exclude false positives from:
  //   1. "remote-work technology/tools/solutions" — describes tools, not the role
  //   2. "partial remote", "occasional remote", "some remote work" — these are hybrid/perk language
  //   3. JDs that explicitly mention an office location with "in our X office"
  const rawHasRemote = includesAny(t, remotePhrases)
  const remoteIsTechContext = /\bremote[\s-]?(work )?(technology|tools|solutions|software|platform|access)\b/i.test(t) && !/(fully |100% |position is |role is |this is a )remote\b/i.test(t)
  const remoteIsPartial = /\b(partial(ly)?|occasional(ly)?|some|hybrid|flexible|optional)\s+remote\b/i.test(t)
  const mentionsOfficeLocation = /\bin\s+(our|the)\s+[^.]{0,40}\boffice\b/i.test(jobText)
  const hasRemote = rawHasRemote && !remoteIsTechContext && !remoteIsPartial && !mentionsOfficeLocation
  // "Partial remote" / "flexible remote" / mention of an office signals HYBRID
  const inferredHybrid = (rawHasRemote && remoteIsPartial) || (rawHasRemote && mentionsOfficeLocation && !remoteIsTechContext)
  const hasHybrid = includesAny(t, hybridPhrases) || inferredHybrid
  const hasInPerson = includesAny(t, onsitePhrases) || t.includes("in-person") || t.includes("in person") || mentionsOfficeLocation

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

  const isInternship = internshipKeywords.some((k) => new RegExp("\\b" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(t))
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

// Only treat a year as a graduation year when it appears adjacent to an
// explicit graduation or degree keyword. Previously this function returned
// the latest year found anywhere in the profile, which meant any candidate
// with a recent work entry like "Jan 2025 – Present" got their gradYear
// set to 2025 — painting senior candidates as recent grads and inflating
// RISK_EXPERIENCE against them.
function inferProfileGradYear(text: string): number | null {
  if (!text) return null

  // Pattern A: "class of 2025", "graduated 2019", "expected graduation 2026"
  const grad = text.match(
    /\b(class of|graduat(?:e|ed|ing|ion)|expected graduation|anticipated graduation)\b[^\n\d]{0,30}(20\d{2})\b/i
  )
  if (grad?.[2]) {
    const y = parseInt(grad[2], 10)
    if (Number.isFinite(y) && y >= 2000 && y <= 2035) return y
  }

  // Pattern B: "B.S., Marketing, 2024" or "Bachelor of Science 2022" —
  // a degree keyword followed by a year on the same line, within a short
  // span. Bounded to avoid matching a year from the next job entry.
  const degree = text.match(
    /\b(b\.?\s*[as]\.?|bachelor'?s?|m\.?\s*[as]\.?|master'?s?|mba|ph\.?d|m\.?d\.?|j\.?d\.?)\b[^\n]{0,80}?\b(20\d{2})\b/i
  )
  if (degree?.[2]) {
    const y = parseInt(degree[2], 10)
    if (Number.isFinite(y) && y >= 2000 && y <= 2035) return y
  }

  // Pattern C: "year → degree" ordering, e.g. "2024, B.S. Biology"
  const degreeAfter = text.match(
    /\b(20\d{2})\b[^\n]{0,20}?\b(b\.?\s*[as]\.?|bachelor'?s?|m\.?\s*[as]\.?|master'?s?|mba|ph\.?d)\b/i
  )
  if (degreeAfter?.[1]) {
    const y = parseInt(degreeAfter[1], 10)
    if (Number.isFinite(y) && y >= 2000 && y <= 2035) return y
  }

  return null
}

// Deterministic years-of-experience estimator.
// See inferYearsExperienceApprox in profile-intake/route.ts for the full
// rationale. This is the extract.ts copy kept in sync so that downstream
// scoring gets the same answer regardless of which code path built the
// profile signals.
//
// Handles (in order):
//   1. Explicit "10+ years" self-report
//   2. Month-Year date ranges, merged to handle concurrent roles
//   3. Bare Year-Year date ranges as a fallback
//   4. Role-signal heuristic as a final fallback for resumes without
//      machine-readable dates
function inferYearsExperienceApprox(profileText: string): number | null {
  if (!profileText || profileText.trim().length === 0) return null

  // ── 1. Explicit self-report ─────────────────────────────────────────────
  const explicit = profileText.match(
    /\b(\d{1,2})\+?\s+years?\b(?!\s+(ago|old))/i
  )
  if (explicit?.[1]) {
    const v = parseInt(explicit[1], 10)
    if (Number.isFinite(v) && v >= 1 && v <= 50) return v
  }

  // ── 2. Month Year – Month Year (or Present) ranges ──────────────────────
  const monthMap: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sept: 8, sep: 8, oct: 9, nov: 10, dec: 11,
  }

  const now = new Date()
  const currentMonthsAbs = now.getUTCFullYear() * 12 + now.getUTCMonth()

  const ranges: Array<{ start: number; end: number }> = []

  const monthRangeRx =
    /(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})\s*(?:[-–—]|to)\s*(?:(jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?\s+(\d{4})|present|current|now|today)/gi

  let m: RegExpExecArray | null
  while ((m = monthRangeRx.exec(profileText)) !== null) {
    const startM = monthMap[m[1].toLowerCase()] ?? 0
    const startY = parseInt(m[2], 10)
    if (!Number.isFinite(startY) || startY < 1970 || startY > 2100) continue
    const startAbs = startY * 12 + startM

    let endAbs: number
    if (m[3] && m[4]) {
      const endM = monthMap[m[3].toLowerCase()] ?? 0
      const endY = parseInt(m[4], 10)
      if (!Number.isFinite(endY) || endY < 1970 || endY > 2100) continue
      endAbs = endY * 12 + endM
    } else {
      endAbs = currentMonthsAbs
    }
    if (endAbs >= startAbs) ranges.push({ start: startAbs, end: endAbs })
  }

  // ── 3. Bare "2019 – 2022" / "2019 to Present" ranges ────────────────────
  const yearRangeRx =
    /\b(19[89]\d|20\d{2})\s*(?:[-–—]|to)\s*(?:(19[89]\d|20\d{2})|present|current|now|today)\b/gi
  while ((m = yearRangeRx.exec(profileText)) !== null) {
    const startY = parseInt(m[1], 10)
    if (!Number.isFinite(startY)) continue
    const startAbs = startY * 12

    let endAbs: number
    if (m[2]) {
      const endY = parseInt(m[2], 10)
      if (!Number.isFinite(endY)) continue
      endAbs = endY * 12 + 11
    } else {
      endAbs = currentMonthsAbs
    }
    if (endAbs >= startAbs) ranges.push({ start: startAbs, end: endAbs })
  }

  if (ranges.length > 0) {
    ranges.sort((a, b) => a.start - b.start)
    let totalMonths = 0
    let curStart = ranges[0].start
    let curEnd = ranges[0].end
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i].start <= curEnd) {
        curEnd = Math.max(curEnd, ranges[i].end)
      } else {
        totalMonths += curEnd - curStart
        curStart = ranges[i].start
        curEnd = ranges[i].end
      }
    }
    totalMonths += curEnd - curStart
    const years = Math.round(totalMonths / 12)
    if (years >= 0 && years <= 50) return years
  }

  // ── 4. Role-signal fallback for resumes without parseable dates ─────────
  // Kept as a last resort so entry-level profiles without date ranges
  // still get a rough 0/1/2 estimate, matching legacy behavior.
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
    hardNoSales: t.includes("no sales") || t.includes("no sales roles"),
    hardNoGovernment: t.includes("no government"),
    hardNoContract: t.includes("no contract") || t.includes("no temporary") || t.includes("no temp"),
    hardNoHourlyPay: t.includes("no hourly"),
    hardNoFullyRemote: t.includes("no remote") || t.includes("no fully remote") || t.includes("no fully-remote"),
    prefFullTime: wantsInternship ? false : t.includes("full-time") || t.includes("full time"),
    preferNotAnalyticsHeavy:
      t.includes("no heavy analytical") || t.includes("no heavy analytics") || t.includes("not analytics heavy"),
    hardNoContentOnly:
      t.includes("no pure social media") ||
      t.includes("no content only") ||
      t.includes("no pure content") ||
      t.includes("no coordinator role") ||
      t.includes("no social media content roles"),
    hardNoPartTime:
      t.includes("no part time") ||
      t.includes("no part-time") ||
      t.includes("full time only") ||
      t.includes("full-time only"),
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

// ── Job title & company name extraction ─────────────────────────────────────

function extractJobTitle(rawLines: string[]): string | null {
  // First pass: find a line that looks like a real job title (has role keywords)
  const roleWords = /\b(intern|analyst|associate|manager|director|coordinator|specialist|engineer|consultant|developer|designer|strategist|assistant|representative|officer|lead|head|fellow)\b/i
  const prefixStrip = /^(?:Title|Position|Role|Job Title)\s*[:]\s*/i
  const sectionWords = /^(position overview|about|overview|description|summary|responsibilities|qualifications|requirements|key responsibilities|how to apply|benefits|compensation|job details|role overview|company description|job description|role description)\b/i
  for (const line of rawLines.slice(0, 10)) {
    let trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.length > 120 || looksLikeLocation(trimmed)) continue
    // Strip "Title: " prefix if present
    trimmed = trimmed.replace(prefixStrip, "").trim()
    if (trimmed.length === 0 || sectionWords.test(trimmed)) continue
    if (roleWords.test(trimmed)) return trimmed
  }
  // Second pass: first non-empty line that isn't a location or section header
  for (const line of rawLines.slice(0, 5)) {
    let trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.length > 120 || looksLikeLocation(trimmed)) continue
    trimmed = trimmed.replace(prefixStrip, "").trim()
    if (trimmed.length === 0 || sectionWords.test(trimmed)) continue
    return trimmed
  }
  return null
}

function looksLikeLocation(s: string): boolean {
  const t = s.trim()
  // "City, ST" or "City, State" patterns
  if (/^[A-Z][a-zA-Z\s.'-]+,\s*[A-Z]{2}\b/.test(t)) return true
  // "City, State Name"
  if (/^[A-Z][a-zA-Z\s.'-]+,\s*[A-Z][a-z]/.test(t) && t.length < 40) return true
  // Common location keywords
  if (/\b(remote|hybrid|on-site|onsite)\s*$/i.test(t)) return true
  // Just a US state abbreviation pair like "New York, NY 10001"
  if (/\b[A-Z]{2}\s+\d{5}\b/.test(t)) return true
  return false
}

function extractCompanyName(rawText: string, rawLines: string[]): string | null {
  // Pattern: "About [Company]" section header (case-insensitive for "The")
  const aboutMatch = rawText.match(/\bAbout\s+([A-Z][A-Za-z0-9 &'.,-]{1,60})(?:\s*\n|$)/m)
  if (aboutMatch) {
    const candidate = aboutMatch[1].trim()
    if (!/^(the company|the role|the team|the position|the opportunity|us|you)\b/i.test(candidate) &&
        !looksLikeLocation(candidate)) {
      return candidate
    }
  }

  // Pattern: "Company: X" or "Employer: X"
  const companyFieldMatch = rawText.match(/(?:^|\n)\s*(?:Company|Employer|Organization)\s*[:]\s*(.+)/im)
  if (companyFieldMatch) {
    const val = companyFieldMatch[1].trim()
    if (val.length > 0 && val.length <= 80 && !looksLikeLocation(val)) return val
  }

  // Pattern: "At [Company]," in opening sentences
  const atMatch = rawText.match(/\bAt\s+([A-Z][A-Za-z0-9 &'.,-]{1,60}),/)
  if (atMatch) {
    const candidate = atMatch[1].trim()
    if (!looksLikeLocation(candidate)) return candidate
  }

  // Pattern: "the [Company]" or "The [Company]" followed by specific verbs
  const theCompanyMatch = rawText.match(/\b[Tt]he\s+([A-Z][A-Za-z0-9 &'.,-]{2,50})\s+(?:is\s+(?:seeking|hiring|looking)|seeks|offers|provides|has an opening)\b/)
  if (theCompanyMatch) {
    const candidate = theCompanyMatch[0].replace(/\s+(?:is\s+(?:seeking|hiring|looking)|seeks|offers|provides|has an opening).*/, "").replace(/^[Tt]he\s+/, "The ").trim()
    if (!looksLikeLocation(candidate)) return candidate
  }

  // Fallback: second non-empty line (many postings put company name on line 2)
  const sectionHeaderPattern = /^(position|about|overview|description|summary|responsibilities|qualifications|requirements|who we are|what you|what we|the role|the team|the position|the opportunity|job details|role overview|key responsibilities|how to apply|benefits|compensation|title|location|department|reports to|job type|employment type|company description|job description|role description)\b/i
  let nonEmptyCount = 0
  for (const line of rawLines) {
    const trimmed = line.trim()
    if (trimmed.length > 0) {
      nonEmptyCount++
      if (nonEmptyCount === 2 && trimmed.length <= 80) {
        if (/^[A-Z]/.test(trimmed) && !/^[-•●*]/.test(trimmed) && !looksLikeLocation(trimmed) && !sectionHeaderPattern.test(trimmed)) return trimmed
      }
    }
    if (nonEmptyCount > 3) break
  }

  return null
}

export function extractJobSignals(jobTextRaw: string): StructuredJobSignals {
  const normalized = norm(jobTextRaw)
  const rawHash = stableHash(normalized)

  const rawLines = jobTextRaw.split(/\r?\n/)
  const jobTitle = extractJobTitle(rawLines)
  const companyName = extractCompanyName(jobTextRaw, rawLines)

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
    /\b(finance intern|financial analyst|fp&a|fpa intern|fpa analyst|treasury|investment banking|accounting intern|financial intern|finance associate|finance coordinator|corporate finance|financial planning|project finance|investor relations|investment analyst|capital markets|private equity|asset management|portfolio analyst|wealth management|wealth advisor|financial advisor|financial professional|financial consultant|financial planner|client associate|client service associate|advisor development|wealth relationship|relationship manager|series 7|finra|securities|broker dealer)\b/i.test(jobTitleSlice)
  const jobTitleIsSales =
    /\b(sales intern|account executive|account manager|business development|territory manager|sales representative|sales associate)\b/i.test(jobTitleSlice)

  // Marketing title detection — prevents BD-support language in marketing roles
  // from triggering sales classification
  // Marketing title detection — matches both simple and compound titles
  // e.g. "Marketing Coordinator", "Marketing and Business Development Coordinator"
  const jobTitleIsMarketing =
    /\b(marketing coordinator|marketing manager|marketing associate|marketing intern|marketing specialist|marketing director|marketing and business development|brand manager|brand coordinator|content manager|content coordinator|communications coordinator|communications manager|communications specialist|growth manager|product marketing|marketing operations|media coordinator|marketing analyst)\b/i.test(jobTitleSlice) ||
    // Compound: starts with Marketing + any other words + Coordinator/Manager/etc
    /^marketing\b.{0,40}\b(coordinator|manager|associate|specialist|director|analyst)\b/i.test(jobTitleSlice.trim())

  // Engineering / technical title detection
  const jobTitleIsEngineering =
    /\b(structural engineer|civil engineer|mechanical engineer|electrical engineer|chemical engineer|environmental engineer|aerospace engineer|biomedical engineer|industrial engineer|manufacturing engineer|process engineer|design engineer|project engineer|field engineer|engineering intern|engineering co-?op|engineer i|engineer ii|engineer iii|staff engineer|structural analysis|structural design)\b/i.test(jobTitleSlice)
  const jobTitleIsSoftware =
    /\b(software engineer|software developer|full stack|frontend engineer|backend engineer|devops engineer|sre|site reliability|data engineer|ml engineer|machine learning engineer|cloud engineer|ios developer|android developer|web developer|systems engineer)\b/i.test(jobTitleSlice)
  const jobTitleIsHealthcare =
    /\b(registered nurse|nurse practitioner|physician assistant|medical assistant|clinical nurse|lpn|rn|cna|dental hygienist|physical therapist|occupational therapist|respiratory therapist|pharmacist|pharmacy tech)\b/i.test(jobTitleSlice)
  const jobTitleIsTrades =
    /\b(electrician|plumber|welder|hvac technician|carpenter|machinist|cnc operator|pipefitter|millwright|sheet metal worker|boilermaker|ironworker)\b/i.test(jobTitleSlice)

  // Strategy / business operations / chief of staff title detection.
  // These roles sit in an awkward zone: the body often mentions financial
  // modeling, analysis, and cross-functional coordination, which pulls the
  // tag-based classifier toward Finance or Analytics. The actual job is
  // strategic/operational, so we force Consulting when the title says so.
  // Consulting is the closest family in the current JobFamily type; a
  // dedicated Operations family would be better but is out of scope here.
  const jobTitleIsStrategyOps =
    /\b(chief of staff|strategy (and|&) (business )?operations|business operations|business ops|strategy (and|&) operations|strategic operations|strategy manager|strategy director|strategy associate|strategy consultant|management consultant|management consulting|operations manager|operations director|director of operations|head of operations|vp of operations|business strategy|corporate strategy|internal operations|people operations|hr business partner|hrbp)\b/i.test(jobTitleSlice)

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

  // Inject engineering function tag when title is clearly technical
  if (jobTitleIsEngineering && !functionTags.includes("engineering_technical")) {
    functionTags.push("engineering_technical")
  }
  if (jobTitleIsSoftware && !functionTags.includes("software_it")) {
    functionTags.push("software_it")
  }
  if (jobTitleIsHealthcare && !functionTags.includes("healthcare_clinical")) {
    functionTags.push("healthcare_clinical")
  }
  if (jobTitleIsTrades && !functionTags.includes("trades_skilled")) {
    functionTags.push("trades_skilled")
  }

  const jobFamilyFromTags = familyFromFunctionTags(functionTags)
  const jobFamily: JobFamily = isLegalOpsContext
    ? "Other"
    : jobTitleIsEngineering
      ? "Engineering"
      : jobTitleIsSoftware
        ? "IT_Software"
        : jobTitleIsHealthcare
          ? "Healthcare"
          : jobTitleIsTrades
            ? "Trades"
            : jobTitleIsMarketing
              ? "Marketing"
              // Strategy/BusinessOps/CoS titles force Consulting even when
              // the body has finance/analytics noise. Placed BEFORE the
              // Finance check so "Strategy and Business Operations" doesn't
              // lose to "financial modeling" bullets in the body.
              : jobTitleIsStrategyOps
                ? "Consulting"
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

  // ── Hard-gate credential detection ────────────────────────────────────────
  // These are legal/licensing requirements the candidate cannot work around.
  // Each category reads from policy keywords so they can be updated without
  // changing this file.

  // Already detected above: requiresLawSchool, requiresMedSchool, requiresCPA,
  // requiresGradDegree

  // Securities / FINRA registrations + SAFE Act / NMLS
  const finraKeywords = asStringArray(
    (POLICY as any)?.extraction?.credential?.finraKeywords
  ).map(norm)
  const requiresFinraLicense = finraKeywords.length
    ? includesAny(normalized, finraKeywords)
    : /\b(series [0-9]+|finra registration|finra license|securities license|registered representative|safe act|nmls|mortgage loan originator|sie required)\b/i.test(normalized)

  // Life / P&C insurance licenses
  const insuranceLicenseKeywords = asStringArray(
    (POLICY as any)?.extraction?.credential?.insuranceLicenseKeywords
  ).map(norm)
  const requiresInsuranceLicense = insuranceLicenseKeywords.length
    ? includesAny(normalized, insuranceLicenseKeywords)
    : /\b(life insurance license required|insurance license required|p&c license|property and casualty license)\b/i.test(normalized)

  // Real estate license
  const realEstateLicenseKeywords = asStringArray(
    (POLICY as any)?.extraction?.credential?.realEstateLicenseKeywords
  ).map(norm)
  const requiresRealEstateLicense = realEstateLicenseKeywords.length
    ? includesAny(normalized, realEstateLicenseKeywords)
    : /\b(real estate license required|real estate licensed|real estate broker license)\b/i.test(normalized)

  // Teaching credential
  const teachingCredentialKeywords = asStringArray(
    (POLICY as any)?.extraction?.credential?.teachingCredentialKeywords
  ).map(norm)
  const requiresTeachingCredential = teachingCredentialKeywords.length
    ? includesAny(normalized, teachingCredentialKeywords)
    : /\b(teaching certificate required|teaching license required|state teaching credential|teacher certification required)\b/i.test(normalized)

  // Professional Engineer license
  const engineeringLicenseKeywords = asStringArray(
    (POLICY as any)?.extraction?.credential?.engineeringLicenseKeywords
  ).map(norm)
  const requiresPELicense = engineeringLicenseKeywords.length
    ? includesAny(normalized, engineeringLicenseKeywords)
    : /\b(pe license|professional engineer required|licensed professional engineer|p\.e\. required)\b/i.test(normalized)

  // CDL
  const cdlKeywords = asStringArray(
    (POLICY as any)?.extraction?.credential?.cdlKeywords
  ).map(norm)
  const requiresCDL = cdlKeywords.length
    ? includesAny(normalized, cdlKeywords)
    : /\b(cdl required|commercial driver.s license|class [ab] cdl)\b/i.test(normalized)

  // ── Sponsorship / training-provided exemption ─────────────────────────
  // When a credential keyword appears but the surrounding context indicates
  // the employer will sponsor, train, or provide the credential, do NOT
  // classify it as a hard requirement.
  const SPONSOR_PHRASES = [
    "will sponsor",
    "will provide",
    "sponsor certification",
    "sponsor finra",
    "sponsor series",
    "sponsor licensing",
    "sponsorship for",
    "sponsorship of",
    "training provided",
    "not required",
    "preferred but not required",
    // Preference/aspiration language — when the credential appears under a
    // "Your expertise" / "ideal candidate" section with these modifiers, it
    // is describing the preferred profile, not a hard requirement. Common
    // in wealth management Client Associate and banking support postings
    // where firms sponsor post-hire licensing.
    "ideally",
    "ideal candidate",
    "ideal candidates",
    "the ideal",
    "preferred qualifications",
    "desired qualifications",
    "desired skills",
    "nice to have",
    "a plus",
    "would be a plus",
    "is a plus",
    "are a plus",
    "bonus",
    "bonus points",
    "helpful but not required",
    "but not required",
    "we will help you obtain",
    "will assist in obtaining",
    "will help you get",
    "will help you earn",
    "upon hire",
    "after joining",
    "after start",
    "obtain within",
    "expected to obtain",
    "opportunity to earn",
    "opportunity to obtain",
    "ability to obtain",
    "must obtain",
    "must pass",
    "must be obtained",
    "must be passed",
    "required to obtain",
    "required to pass",
    "required during",
    "during first",
    "during the first",
    "within first",
    "within the first",
    "first twelve months",
    "first 12 months",
    "first six months",
    "first 6 months",
    "first year",
    "within 12 months",
    "within twelve months",
    "within 6 months",
    "within six months",
    "within 90 days",
    "within 180 days",
    "company timeline",
    "mandated company timeline",
    "mandated timeline",
    "prepare for and pass",
    "prepare for and obtain",
    "we provide training",
    "we provide study",
    "company sponsored",
    "company-sponsored",
    "firm will sponsor",
    "firm-sponsored",
    "paid training",
    "paid study",
    "dedicated study time",
    "study time provided",
    "licensing training",
    "license training",
    "will train you",
    "will be trained",
    "training and certification",
    "training & certification",
  ]

  function isCredentialSponsored(credKeywords: string[], text: string): boolean {
    const lower = text.toLowerCase()
    for (const kw of credKeywords) {
      const idx = lower.indexOf(kw.toLowerCase())
      if (idx === -1) continue
      // Check a window of ~400 chars around the keyword match
      const windowStart = Math.max(0, idx - 200)
      const windowEnd = Math.min(lower.length, idx + kw.length + 200)
      const context = lower.slice(windowStart, windowEnd)
      if (SPONSOR_PHRASES.some((sp) => context.includes(sp))) return true
    }
    return false
  }

  let credentialSponsored = false

  // Role-title convention override for wealth management / banking support
  // roles. Client Associate, Service Associate, Relationship Associate, and
  // Wealth Management Associate titles are almost universally post-hire
  // licensed: firms sponsor Series 7/66 during the first 120 days. Treating
  // the Series requirement as a hard gate on these postings generates
  // false passes for every early-career candidate targeting wealth
  // management support roles.
  const isSupportAssociateTitle =
    /\b(client associate|service associate|relationship associate|wealth management associate|financial services associate|client service associate|branch associate|investment associate|advisor associate|registered client associate|registered service associate|sales associate|operations associate)\b/i.test(
      jobTitleSlice
    )
  if (requiresFinraLicense && isSupportAssociateTitle) {
    credentialSponsored = true
  }

  // Check each detected hard credential against sponsorship context
  if (!credentialSponsored && requiresFinraLicense && isCredentialSponsored(finraKeywords.length ? finraKeywords : ["series", "finra", "sie", "nmls", "securities license"], normalized)) {
    credentialSponsored = true
  } else if (requiresInsuranceLicense && isCredentialSponsored(insuranceLicenseKeywords.length ? insuranceLicenseKeywords : ["insurance license"], normalized)) {
    credentialSponsored = true
  } else if (requiresRealEstateLicense && isCredentialSponsored(realEstateLicenseKeywords.length ? realEstateLicenseKeywords : ["real estate license"], normalized)) {
    credentialSponsored = true
  } else if (requiresCPA && isCredentialSponsored(cpaKeywords.length ? cpaKeywords : ["cpa"], normalized)) {
    credentialSponsored = true
  } else if (requiresCDL && isCredentialSponsored(cdlKeywords.length ? cdlKeywords : ["cdl"], normalized)) {
    credentialSponsored = true
  } else if (requiresTeachingCredential && isCredentialSponsored(teachingCredentialKeywords.length ? teachingCredentialKeywords : ["teaching"], normalized)) {
    credentialSponsored = true
  } else if (requiresPELicense && isCredentialSponsored(engineeringLicenseKeywords.length ? engineeringLicenseKeywords : ["pe license"], normalized)) {
    credentialSponsored = true
  }

  // ── Risk-flag credential detection (not gates, but significant gaps) ────
  const cfaKeywords = asStringArray(
    (POLICY as any)?.extraction?.credential?.cfaKeywords
  ).map(norm)
  const requiresCFA = cfaKeywords.length
    ? includesAny(normalized, cfaKeywords)
    : /\b(cfa required|cfa charterholder required|chartered financial analyst required)\b/i.test(normalized)

  const cfpKeywords = asStringArray(
    (POLICY as any)?.extraction?.credential?.cfpKeywords
  ).map(norm)
  const requiresCFP = cfpKeywords.length
    ? includesAny(normalized, cfpKeywords)
    : /\b(cfp required|certified financial planner required)\b/i.test(normalized)

  const pmpKeywords = asStringArray(
    (POLICY as any)?.extraction?.credential?.pmpKeywords
  ).map(norm)
  const requiresPMP = pmpKeywords.length
    ? includesAny(normalized, pmpKeywords)
    : /\b(pmp required|pmp certification required|project management professional required)\b/i.test(normalized)

  const socialWorkKeywords = asStringArray(
    (POLICY as any)?.extraction?.credential?.socialWorkLicenseKeywords
  ).map(norm)
  const requiresSocialWorkLicense = socialWorkKeywords.length
    ? includesAny(normalized, socialWorkKeywords)
    : /\b(lcsw required|lmsw required|licensed clinical social worker|social work license required)\b/i.test(normalized)

  // ── Aggregate flags ──────────────────────────────────────────────────────

  // Hard gate — any of these = candidate cannot legally do the job
  const requiresHardCredential =
    requiresLawSchool ||
    requiresMedSchool ||
    requiresCPA ||
    requiresGradDegree ||
    requiresFinraLicense ||
    requiresInsuranceLicense ||
    requiresRealEstateLicense ||
    requiresTeachingCredential ||
    requiresPELicense ||
    requiresCDL

  // Soft credential — significant gap, surface as risk flag not gate
  const requiresSoftCredential =
    requiresCFA || requiresCFP || requiresPMP || requiresSocialWorkLicense

  // If the credential is sponsored/training-provided, do not treat as hard requirement
  let credentialRequired = requiresHardCredential && !credentialSponsored

  const credentialDetail = requiresLawSchool
    ? "law school enrollment or JD"
    : requiresMedSchool
    ? "medical school enrollment or MD/RN"
    : requiresCPA
    ? "CPA license"
    : requiresGradDegree
    ? "graduate degree"
    : requiresFinraLicense
    ? "FINRA registration or securities license"
    : requiresInsuranceLicense
    ? "insurance license (life, P&C, or health)"
    : requiresRealEstateLicense
    ? "real estate license"
    : requiresTeachingCredential
    ? "teaching certificate or credential"
    : requiresPELicense
    ? "Professional Engineer (PE) license"
    : requiresCDL
    ? "Commercial Driver's License (CDL)"
    : requiresCFA
    ? "CFA charterholder designation"
    : requiresCFP
    ? "CFP certification"
    : requiresPMP
    ? "PMP certification"
    : requiresSocialWorkLicense
    ? "social work license (LCSW/LMSW)"
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
  // Training program detection — fires when the job itself is structured as a
  // learning/development program (not when the company mentions learning benefits).
  //
  // Key distinction: "you will receive dedicated study time for your SIE" = training program
  // vs "learning stipends so you can continue to learn and grow" = company benefit, not a program.
  //
  // We require either an explicit program name OR structured training language
  // that is specific to the role, not generic company culture/benefits boilerplate.
  const isTrainingProgram = (() => {
    // Explicit program names — high confidence
    if (/\b(development program|training program|rotational program|advisor development program|advisor training program|associate development program|associate training program|analyst program|scholar program|apprentice|apprenticeship)\b/i.test(jobTextLower)) return true
    // Role-specific structured training language (not benefits boilerplate)
    if (/\b(you will (learn|be trained|be taught|develop skills)|we('ll| will) (teach you|train you|prepare you)|dedicated (study|training) time|on-the-job (training|learning)|training is provided|hands.on training|will receive training|receive dedicated training|study time (for|to)|will sponsor.{0,20}(certification|license|series|finra|sie))\b/i.test(jobTextLower)) return true
    // Credential sponsorship language — strong indicator of training program
    if (/\b(sponsor.{0,15}(certification|license|series|finra|sie|nmls)|certification.{0,15}sponsor|we (provide|offer|cover).{0,20}(licensing|certification|training))\b/i.test(jobTextLower)) return true
    // Skills the candidate WILL gain as part of the role progression
    if (/\bskills (you|they|we|our) (will|can) (develop|gain|build|learn)\b/i.test(jobTextLower)) return true
    if (/\bgain (exposure|experience|skills) in\b/i.test(jobTextLower)) return true
    // No experience required language in entry-level context
    if (/\bno (prior )?(experience|certification|license) (required|necessary|needed)\b/i.test(jobTextLower)) return true
    return false
  })()
  if (isTrainingProgram) {
    console.log("[extract] Training program detected — aspirational skills will not be treated as hard requirements")
    // Training programs provide credentials as part of the role — never gate on them
    if (credentialRequired) {
      console.log("[extract] Suppressing credentialRequired for training program")
      credentialRequired = false
    }
  }

  // ── Job archetype detection ─────────────────────────────────────────────────
  // Classifies what kind of work this role actually requires day-to-day.
  // Used to detect mismatches with the candidate's stated role preferences.

  // Content/execution signals — coordinator, content, events, social, operations
  const contentExecutionHits = [
    "coordinate posts", "social media calendar", "content calendar",
    "develop content", "content creation", "social media content",
    "event coordination", "event planning", "event logistics",
    "manage social", "community management", "influencer",
    "blog content", "email newsletter", "graphic design",
    "canva", "copy", "copywriting",
  ].filter(term => jobTextLower.includes(term)).length

  const isContentExecutionHeavy = contentExecutionHits >= 3

  // Analytical signals — data, research, measurement, modeling
  const analyticalHits = [
    "sql", "python", "tableau", "power bi", "data analysis",
    "statistical", "regression", "modeling", "quantitative",
    "market research", "consumer research", "survey", "a/b test",
    "attribution", "analytics", "reporting", "insights",
    "data-driven", "kpi", "metrics", "measurement",
  ].filter(term => jobTextLower.includes(term)).length

  // Strategic signals — planning, brand, GTM, consulting
  const strategicHits = [
    "brand strategy", "go-to-market", "gtm", "market strategy",
    "strategic planning", "competitive analysis", "positioning",
    "consulting", "advisory", "market entry", "business strategy",
    "product strategy", "growth strategy", "brand management",
  ].filter(term => jobTextLower.includes(term)).length

  // Classify job archetype
  const jobArchetype: "analytical" | "strategic" | "execution" | "mixed" | "unclear" = (() => {
    const total = analyticalHits + strategicHits + contentExecutionHits
    if (total === 0) return "unclear"
    if (analyticalHits >= 5 && analyticalHits > strategicHits && analyticalHits > contentExecutionHits) return "analytical"
    if (strategicHits >= 3 && strategicHits > analyticalHits && strategicHits > contentExecutionHits) return "strategic"
    if (contentExecutionHits >= 3 && contentExecutionHits > analyticalHits && contentExecutionHits > strategicHits) return "execution"
    if (analyticalHits >= 2 || strategicHits >= 2 || contentExecutionHits >= 2) return "mixed"
    return "unclear"
  })()

  // ── Job industry detection ──────────────────────────────────────────────────
  // Detects the industry vertical of the role for interest alignment scoring
  const jobIndustry: string | null = (() => {
    if (/(nba|nfl|mlb|nhl|mls|sports league|athletic|espn|sports marketing|sports industry|professional sports|team sports)/i.test(jobTextLower)) return "sports"
    if (/(entertainment|music industry|film|streaming|gaming|media entertainment)/i.test(jobTextLower)) return "entertainment"
    if (/(fashion|luxury|beauty|lifestyle brand|apparel|footwear)/i.test(jobTextLower)) return "luxury/fashion"
    if (/(consumer goods|cpg|fmcg|packaged goods|food and beverage|beverage brand)/i.test(jobTextLower)) return "consumer goods"
    if (/(saas|software company|tech company|technology company|startup|fintech)/i.test(jobTextLower)) return "technology"
    if (/(private equity|investment bank|asset management|hedge fund|venture capital)/i.test(jobTextLower)) return "finance"
    if (/(healthcare company|hospital|health system|pharmaceutical|biotech)/i.test(jobTextLower)) return "healthcare"
    if (/(real estate firm|property management|commercial real estate|reit)/i.test(jobTextLower)) return "real estate"
    return null
  })()

  if (jobArchetype !== "unclear") {
    console.log("[extract] Job archetype:", jobArchetype, "| Content hits:", contentExecutionHits, "| Analytical hits:", analyticalHits, "| Strategic hits:", strategicHits)
  }
  if (jobIndustry) {
    console.log("[extract] Job industry detected:", jobIndustry)
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
  // Pattern allows for an optional qualifying word between the industry term
  // and experience/background — e.g. "AEC industry experience" has "industry"
  // between "AEC" and "experience". Allow up to 2 words in between.
  const domainRequirementPattern = new RegExp(
    "(" +
      DOMAIN_INDUSTRY_TERMS.map((t) =>
        t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      ).join("|") +
      ")\\s*(?:\\w+\\s+)?(?:\\w+\\s+)?(experience|background|knowledge|familiarity|exposure)" +
      "|" +
      "(experience|background|familiarity|exposure)\\s+(?:in|with|within|in the)\\s+(?:\\w+\\s+)?(" +
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
    jobTitle,
    companyName,
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
    credentialSponsored,
    gradYearHint,
    requiredTools: required,
    preferredTools: preferred,
    isSeniorRole: isSeniorRole,
    isTrainingProgram: isTrainingProgram,
    requiresAECExperience: requiresAECExperience,
    requiresDomainIndustryExperience: requiresDomainIndustryExperience,
    detectedDomain: detectedDomain,
    requiresSoftCredential: requiresSoftCredential,
    softCredentialDetail: requiresSoftCredential ? (credentialDetail || null) : null,
    jobArchetype: jobArchetype,
    isContentExecutionHeavy: isContentExecutionHeavy,
    jobIndustry: jobIndustry,
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