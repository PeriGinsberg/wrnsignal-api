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
      // NOTE: "marketing events" removed — too weak. Support roles
      // (Client Associate, Executive Assistant, Office Manager) use
      // "plan marketing events" for admin logistics, while real marketing
      // roles use more specific phrases below (brand events, trade shows,
      // brand activations). Keeping this in the list produced false-
      // positive content_execution requirements on wealth management and
      // banking support postings.
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
    // Bare "optimize" matched lab "design optimization", "talent acquisition"
    // matched "molecular acquisition", "retention" matched "employee retention"
    // and "data retention". Every phrase now requires explicit marketing/
    // growth context.
    profilePhrases: [
      "performance marketing",
      "growth marketing",
      "campaign optimization",
      "optimize campaign",
      "optimize spend",
      "optimize conversion",
      "customer acquisition",
      "user acquisition",
      "customer retention",
      "user retention",
      "conversion rate",
      "conversion funnel",
      "a/b testing",
      "ab testing",
      "roas",
      "cpc",
      "cpm",
    ],
    jobPhrases: [
      "performance marketing",
      "growth marketing",
      "campaign optimization",
      "optimize campaign",
      "optimize spend",
      "optimize conversion",
      "customer acquisition",
      "user acquisition",
      "customer retention",
      "user retention",
      "conversion rate",
      "conversion funnel",
      "a/b testing",
      "ab testing",
      "roas",
      "cpc",
      "cpm",
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
    // jobPhrases broadened to include pharmaceutical / medical / field
    // sales vocabulary. Previous list only matched SDR-style cold-call
    // language, so pharma JDs (which use "partner with HCPs", "gain
    // access to customers", "achieve sales growth", "product expert",
    // "tailor solutions for therapy") produced zero sales requirement
    // units even with a very explicit sales_bd tag.
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
      // Pharma / field sales language
      "partner with health care professionals",
      "partner with healthcare professionals",
      "partner with hcps",
      "gain access to the customers",
      "gain access to customers",
      "customer access",
      "achieve sales growth",
      "deliver on strong sales results",
      "deliver sales results",
      "drive sales growth",
      "sell in a changing",
      "sell in a",
      "product expert",
      "tailor solutions",
      "detail product",
      "product detailing",
      "physician call",
      "physician calls",
      "hcp engagement",
      "call on physicians",
      "call on accounts",
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
    // Broadened to include HCP / customer relationship language that
    // pharma and medical-device sales JDs use in place of generic
    // "account management" phrasing.
    jobPhrases: [
      "account management",
      "account support",
      "support accounts",
      "maintain accounts",
      "account growth",
      "customer accounts",
      "book of business",
      "relationships with physicians",
      "relationships with health care professionals",
      "relationships with healthcare professionals",
      "build relationships with customers",
      "patient care as a product expert",
      "those involved with patient care",
      "alliance partners",
      "partner with team members and alliance partners",
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
      "sales territory",
      "pharmaceutical sales territory",
      "your own territory",
      "your own pharmaceutical sales territory",
      "field sales",
      "assigned territory",
      "regional sales",
      "drive utilization",
      "grow utilization",
      "onsite account visits",
      "cover cases",
      "work in your own",
    ],
    adjacentKeys: ["account_management", "hospital_or_environment"],
  },
  {
    key: "crm_usage",
    label: "crm usage and sales system hygiene",
    kind: "tool",
    functionTag: "sales_bd",
    profilePhrases: [
      "salesforce",
      "hubspot",
      "lead tracking",
      "opportunity tracking",
      "pipeline tracking",
      "customer database",
      "crm usage",
      "crm system",
    ],
    profileWeakPhrases: ["excel", "spreadsheets"],
    // Bare "crm" removed from jobPhrases — it matched generic "CRM
    // systems" in boilerplate tool lists even on non-sales JDs (e.g.
    // Richemont Legal Intern). Now requires a product name (Salesforce,
    // HubSpot) or an unambiguously sales CRM phrase.
    jobPhrases: [
      "salesforce",
      "hubspot",
      "crm usage",
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
    // "surgical" removed from jobPhrases — it matches metaphorical business
    // language like "surgical follow-through" / "surgical precision" in
    // strategy/ops JDs. Other phrases here are concrete medical-context
    // terms that don't appear outside clinical settings. "surgical" remains
    // in profilePhrases above because resumes use it unambiguously
    // ("Surgical Technologist", "surgical experience").
    jobPhrases: [
      "operating room",
      "orthopedic",
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
      // Legal internship / pre-law signals — the kind of writing pre-law
      // undergrads actually do that transfers to legal work
      "reviewed proposals",
      "review proposals",
      "policy briefs",
      "policy brief",
      "drafted policies",
      "drafted policy",
      "pre law",
      "pre-law",
      "argument and persuasion",
      "legal writing",
      "legal assistant",
      "paralegal",
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
      "compliance initiatives",
      "applicable laws",
      "applicable laws and regulations",
      "contract review",
      "contract negotiation",
      "contract drafting",
      "contract lifecycle management",
      "clm tool",
      "clm specialist",
      "commercial agreements",
      "commercial agreement",
      "customer release letters",
      "third-party subpoena",
      "third party subpoena",
      "subpoena requests",
      "corporate governance",
      "corporate governance platform",
      "governance records",
      "governance platform",
      "entity data validation",
      "legal hub",
      "legal department",
      "legal team",
      "litigation",
      "legislative",
      "safety standards",
      "regulatory filings",
    ],
    adjacentKeys: ["communications_writing", "drafting_documentation", "analysis_reporting"],
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
    // Bare-word "patient", "clinical", "medical" removed from both
    // phrase lists — they matched pharma sales and generic healthcare
    // marketing JDs on phrases like "patient therapy", "clinical
    // environment", "medical teams". Now requires compound clinical-
    // action language that only appears in real hands-on clinical
    // contexts.
    profilePhrases: [
      "patient care",
      "clinical assessment",
      "clinical experience",
      "clinical rotation",
      "direct patient care",
      "patient intake",
      "clinical research",
      "clinical trial",
      "research assistant",
      "emt",
      "scribe",
      "care team",
    ],
    jobPhrases: [
      "direct patient care",
      "hands-on patient",
      "clinical experience",
      "clinical rotation",
      "clinical assessment",
      "clinical trial",
      "clinical research coordinator",
      "medical research",
      "research assistant",
      "scribe",
      "care team",
      "bedside",
    ],
    adjacentKeys: ["hospital_or_environment", "clinical_stakeholder_fluency"],
    suppressAnalyticsHeavy: true,
  },
  {
    key: "operations_execution",
    label: "operations, process, and workflow execution",
    kind: "execution",
    functionTag: "operations_general",
    // All single-word "operations" / "workflow" / "process" phrases removed.
    // They were matching lab "experimental workflows" (Lily Stein) and
    // factory "production process" (any manufacturing JD) as if they were
    // ops execution work. Only compound phrases that clearly mean
    // business/program operations remain.
    profilePhrases: [
      "business operations",
      "process improvement",
      "process optimization",
      "program management",
      "project management",
      "cross-functional program",
      "event operations",
      "event logistics",
      "game day execution",
      "staff coordination",
      "operational execution",
      "operating cadence",
    ],
    jobPhrases: [
      "business operations",
      "process improvement",
      "process optimization",
      "program management",
      "project management",
      "cross-functional program",
      "event logistics",
      "event operations",
      "game day",
      "supervise team",
      "supervise staff",
      "staff scheduling",
      "weekends and evenings",
      "operating cadence",
      "operational rigor",
      "drive operational",
      // HR management / people operations phrases — added so HR-heavy
      // JDs (Director of People Services, HR Generalist, HRBP) produce
      // requirement units that HR candidates' profile operations_execution
      // work can match. These are unambiguous HR vocabulary that does not
      // appear in lab / sales / engineering JDs.
      "human resources activities",
      "implement policies",
      "enforcing company policies",
      "enforcing policies",
      "employee relations",
      "compensation programs",
      "compensation and benefits",
      "benefits administration",
      "performance management",
      "talent acquisition",
      "workforce planning",
      "hr operations",
      "hr policies",
      "people operations",
      "people services",
      "training and development programs",
      "employee recognition",
      "recruitment, selection",
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
    // IMPORTANT: all phrases must be COMPOUND or contain specific domain
    // context. Bare "stakeholder" / "collaboration" / "coordination" /
    // "cross-functional" match every generic business resume line (e.g.
    // "design based on stakeholder feedback") and produced false-positive
    // direct matches for Lily Stein (lab scientist) against an HR Director
    // role. Generic tokens are removed; only compound phrases remain.
    profilePhrases: [
      "cross-functional team",
      "cross-functional collaboration",
      "stakeholder management",
      "stakeholder engagement",
      "stakeholder alignment",
      "cross-functional coordination",
      "partnered with leadership",
      "partnered with executives",
      "partnered with cross-functional",
      "presented to leadership",
      "presented to stakeholders",
      "coordinated across teams",
      "players and families",
      "media, operations staff, and event personnel",
      "sponsor needs",
      "volunteer coaches",
      "coaches and parents",
    ],
    jobPhrases: [
      "cross-functional team",
      "cross-functional collaboration",
      "stakeholder management",
      "stakeholder engagement",
      "stakeholder alignment",
      "cross-functional partner",
      "partner with leadership",
      "partner with cross-functional",
      "present to leadership",
      "present to executives",
      "build relationships with",
      "collaborate across functions",
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
      "drafting",
      "draft written",
      "draft summaries",
      "draft press",
      "draft policies",
      "drafts of",
      "prepared",
      "wrote",
      "written summaries",
      "documentation",
      "memo",
      "brief",
      "report",
      "presentation deck",
    ],
    // Bare "draft", "prepare", "write" removed — they matched pharma
    // and training-program language like "prepare to take the exams"
    // and "write code". Now requires the verb to be paired with a
    // concrete written-deliverable object (memo, report, press release,
    // briefing, bylined article, pitch, material, policy, brief, etc.)
    // so we fire on PR/writing roles without over-firing on generic
    // "prepare"/"write"/"draft" language.
    jobPhrases: [
      // draft + written output
      "draft memos",
      "draft documents",
      "draft reports",
      "draft briefs",
      "draft press",
      "draft materials",
      "draft content",
      "draft communications",
      "draft policies",
      "draft commercial",
      "draft agreements",
      "draft contracts",
      "draft legal",
      "drafting documentation",
      "drafting and reviewing",
      "drafting commercial",
      "drafting contracts",
      "drafting agreements",
      "drafting legal",
      "drafting press",
      "drafting content",
      "drafting correspondence",
      "first draft",
      "drafts of written",
      "draft of written",
      // write + written output
      "write press",
      "write reports",
      "write briefs",
      "write memos",
      "write materials",
      "write content",
      "write articles",
      "write bylined",
      "write policies",
      "write documentation",
      "written content",
      "written communications",
      "written documentation",
      "written materials",
      // prepare + written output
      "prepare reports",
      "prepare memos",
      "prepare briefs",
      "prepare documentation",
      "prepare presentations",
      "prepare written",
      "prepare communications",
      "prepare policies",
      // direct nouns
      "press materials",
      "press releases",
      "briefing book",
      "briefing books",
      "briefing documents",
      "bylined articles",
      "opinion pieces",
      "documentation",
      "memo",
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
    // "patient care" and "triage" removed from jobPhrases. Pharma sales
    // JDs use "patient care" in a support-the-patient sense ("partner
    // with healthcare professionals involved in patient care") that is
    // NOT hands-on nursing work. Job side now requires unambiguously
    // hands-on nursing vocabulary (RN, LPN, vitals, bedside, IV,
    // medication administration). Profile side keeps "patient care"
    // because nurse resumes use it in the concrete sense.
    jobPhrases: ["registered nurse", "nurse practitioner", "lpn", "rn", "cna", "clinical assessment", "vital signs", "medication administration", "bedside", "hands-on patient"],
    adjacentKeys: [],
  },
  {
    key: "trades_construction",
    label: "Skilled Trades",
    kind: "function" as EvidenceKind,
    functionTag: "trades_skilled" as FunctionTag,
    profilePhrases: ["welding", "plumbing", "hvac", "carpentry", "electrical wiring", "machining", "cnc"],
    // "apprentice" removed — it matches metaphorical "intern/apprentice" language
    // in PR/marketing JDs (e.g., "Preferred experience as an intern/apprentice in
    // public relations"), misclassifying them as Trades. All remaining phrases are
    // concrete trade vocabulary that doesn't appear outside skilled-trades contexts.
    jobPhrases: ["welding", "plumbing", "hvac", "carpentry", "electrician", "machinist", "cnc", "journeyman"],
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

// NEVER_CORE_KEYS was a hard-coded set of requirement keys that got auto-
// demoted to "supporting" in selectBestJobUnits() regardless of context.
// Removed 2026-05-07 (Fix B) — see selectBestJobUnits comment for history.
// Replaced with downstream weighting in scoring.ts (supporting = 0.5 × core).

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

// ── Section-aware JD parsing ────────────────────────────────────────────────
//
// Before this, the requirement unit extractor treated every line in the
// JD equally — including lines under "About the company" or "Benefits"
// headers. That was the root cause of several recurring bugs:
//
//   - Ryan vs Raymond James: a `financial_analysis` direct match fired
//     from "Founded in 1962... investment and financial planning, in
//     addition to capital markets and asset management" — the About the
//     company paragraph, not a requirement.
//   - Maybern SWE: produced zero sales requirement units because the
//     JD body was mostly company blurb.
//   - Josselyn vs Fanatics and others: company-context phrases getting
//     credit as if they were job responsibilities.
//
// This pass segments the JD into sections based on explicit headers and
// drops lines from `company`, `benefits`, and `how_to_apply` sections
// before running unit detection. Everything else (title-based family
// detectors, training-program detection, hourly / location detection,
// advisory-background detection) still uses the full raw body because
// those are ambient context signals, not requirement extraction.

type SectionKind =
  | "overview"
  | "responsibilities"
  | "qualifications"
  | "benefits"
  | "company"
  | "how_to_apply"
  | "other"

type JobSection = {
  kind: SectionKind
  headerText: string | null
  lines: string[]
}

// Each entry is a regex tested against the lowercased + trailing-colon-
// stripped header line. Order matters: more specific entries first.
const SECTION_HEADER_RULES: Array<{ pattern: RegExp; kind: SectionKind }> = [
  // COMPANY — About the company, Who we are, Our story
  { pattern: /^(about (the )?company|about us|who we are|our story|our mission|company (overview|description|profile|background))$/, kind: "company" },

  // BENEFITS — what we offer, perks, compensation
  { pattern: /^(benefits|perks( and benefits)?|what('s| is) in it for you|why (join|work at|work for|us)|compensation( and benefits)?|our offer|we offer|pay range|salary range|(base )?compensation)$/, kind: "benefits" },

  // HOW TO APPLY
  { pattern: /^(how to apply|application (process|instructions)|to apply|next steps)$/, kind: "how_to_apply" },

  // RESPONSIBILITIES — must come before generic "overview" rules
  { pattern: /^(key )?responsibilities$/, kind: "responsibilities" },
  { pattern: /^essential (duties|job functions|responsibilities)( and responsibilities)?$/, kind: "responsibilities" },
  { pattern: /^(your|core|main|primary|position) responsibilities$/, kind: "responsibilities" },
  { pattern: /^(the )?(day.to.day|day to day)( responsibilities| activities)?$/, kind: "responsibilities" },
  { pattern: /^what (you'll|you will|you are going to|you would|you can expect to) (do|be doing|work on)$/, kind: "responsibilities" },
  { pattern: /^how (you('ll| will| would)?|we) (contribute|help|spend (your|the) (day|time|days))$/, kind: "responsibilities" },
  { pattern: /^in this role( you will| you'll)?$/, kind: "responsibilities" },
  { pattern: /^job (duties|responsibilities|functions)$/, kind: "responsibilities" },
  { pattern: /^(role and responsibilities|duties and responsibilities)$/, kind: "responsibilities" },
  { pattern: /^what you('ll| will) achieve$/, kind: "responsibilities" },

  // QUALIFICATIONS
  { pattern: /^(qualifications|requirements)$/, kind: "qualifications" },
  { pattern: /^(required|basic|minimum|preferred|additional|desired) (qualifications|requirements|skills|experience)$/, kind: "qualifications" },
  { pattern: /^what we('re| are) (looking for|seeking|after)$/, kind: "qualifications" },
  { pattern: /^your profile$/, kind: "qualifications" },
  { pattern: /^(about you|who you are|who we('re| are) looking for)$/, kind: "qualifications" },
  { pattern: /^(must have|nice to have|nice.to.have|must.have|must haves|nice.to.haves)$/, kind: "qualifications" },
  { pattern: /^(education|work experience|education\/previous experience|education\/experience|experience)$/, kind: "qualifications" },
  { pattern: /^(skill in|knowledge of|ability to)$/, kind: "qualifications" },
  { pattern: /^what you('ll| will) bring$/, kind: "qualifications" },
  { pattern: /^what you need$/, kind: "qualifications" },

  // OVERVIEW — role-level, placed after more specific rules
  { pattern: /^(role|position|job) (overview|summary|description)$/, kind: "overview" },
  { pattern: /^(overview|summary|description)$/, kind: "overview" },
  { pattern: /^(about (the )?(job|role|position|opportunity|internship|team))$/, kind: "overview" },
  { pattern: /^(the role|the opportunity|the position|the job)$/, kind: "overview" },
  { pattern: /^job description summary$/, kind: "overview" },
  { pattern: /^(your (internship|role) experience|internship experience)$/, kind: "overview" },
  { pattern: /^(opportunity|what we do)$/, kind: "overview" },

  // COMPANY — corporate-marketing headers that don't match the canonical
  // "About Us" / "Our Story" shape. Placed LAST so the specific rules
  // above (especially "about you" → qualifications, "about (the )?team"
  // → overview) win first.
  //
  // We deliberately do NOT include a generic `about <name>` catch-all here
  // because it caused too much regression drift on cases where headers like
  // "About the Brand" or company-specific tokens were previously
  // unclassified and content was kept under overview. The targeted
  // "being part of the team" rule below catches the most common offender
  // without the generic-rule blast radius.
  { pattern: /^being part of (the )?(team|company|family|crew)$/, kind: "company" },
]

function classifyHeader(line: string): SectionKind | null {
  const clean = String(line || "")
    .trim()
    .toLowerCase()
    // Strip trailing colon / dash / em-dash
    .replace(/[:：\-–—]\s*$/, "")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim()
  if (!clean || clean.length > 80) return null
  for (const rule of SECTION_HEADER_RULES) {
    if (rule.pattern.test(clean)) return rule.kind
  }
  return null
}

export function segmentJobText(raw: string): JobSection[] {
  const rawLines = String(raw || "").split(/\r?\n/)
  const sections: JobSection[] = []
  // Default for content before the first header is "overview" — most JDs
  // open with an intro paragraph describing the role, and treating that
  // as overview (kept, full weight) is conservative.
  let current: JobSection = {
    kind: "overview",
    headerText: null,
    lines: [],
  }

  for (const line of rawLines) {
    const newKind = classifyHeader(line)
    if (newKind) {
      // close previous section if it has any content
      if (current.lines.length > 0 || current.headerText !== null) {
        sections.push(current)
      }
      current = {
        kind: newKind,
        headerText: line.trim(),
        lines: [],
      }
    } else {
      current.lines.push(line)
    }
  }
  if (current.lines.length > 0 || current.headerText !== null) {
    sections.push(current)
  }
  return sections
}

// Sections whose content should NOT feed requirement unit extraction.
// Company blurbs and benefits / compensation / how-to-apply text aren't
// job requirements, so they shouldn't produce requirement_units.
const REQUIREMENT_SKIP_KINDS: Set<SectionKind> = new Set([
  "company",
  "benefits",
  "how_to_apply",
])

// Build a filtered job-text containing only the sections that describe
// what the role actually requires / involves. Used as input to
// splitEvidenceLines + buildUnitsFromLines. The full raw JD is still
// used by ambient detectors (title family, training program, hourly,
// location, advisory background, etc.).
export function filterJobTextToRequirements(raw: string): {
  filteredText: string
  sections: JobSection[]
  droppedKinds: Set<SectionKind>
} {
  const sections = segmentJobText(raw)
  const droppedKinds = new Set<SectionKind>()
  const kept: string[] = []

  for (const s of sections) {
    if (REQUIREMENT_SKIP_KINDS.has(s.kind)) {
      droppedKinds.add(s.kind)
      continue
    }
    // Keep the header itself as an anchor line (some detectors may key
    // off header-adjacent text when searching for context).
    if (s.headerText) kept.push(s.headerText)
    kept.push(...s.lines)
  }

  // Safety net: if filtering left us with almost nothing (< 3 non-empty
  // lines), fall back to the raw text. This avoids silently gutting JDs
  // whose headers don't match our rules — we'd rather extract noisy
  // units from the whole body than zero units from an over-filtered body.
  const nonEmptyKeptLines = kept.map((l) => l.trim()).filter(Boolean)
  if (nonEmptyKeptLines.length < 3) {
    return {
      filteredText: String(raw || ""),
      sections,
      droppedKinds: new Set(),
    }
  }

  return {
    filteredText: kept.join("\n"),
    sections,
    droppedKinds,
  }
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

  if (/\b(education|coursework|gpa|dean'?s list|honors|scholarship|university)\b/i.test(line)) score -= 2
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
    Operations: 0,
    HR: 0,
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
    if (tag === "sales_bd") score.Sales += 5
    if (tag === "premed_clinical") score.PreMed += 4

    if (tag === "finance_corp") score.Finance += 6
    if (tag === "accounting_finops") score.Accounting += 6

    if (tag === "data_analytics_bi") score.Analytics += 4
    // Consumer/market research is fundamentally Marketing work — it lives
    // inside marketing teams, advertising agencies, and brand orgs.
    if (tag === "consumer_insights_research") {
      score.Marketing += 4
      score.Analytics += 2
    }

    if (tag === "brand_marketing") score.Marketing += 5
    if (tag === "communications_pr") score.Marketing += 3
    if (tag === "content_social") score.Marketing += 3
    if (tag === "growth_performance") score.Marketing += 4
    if (tag === "product_marketing") score.Marketing += 6

    if (tag === "consulting_strategy") score.Consulting += 7
    // Operations scores toward Operations when consulting_strategy is absent,
    // toward Consulting when both fire
    if (tag === "operations_general") {
      score.Operations += 5
      score.Consulting += 3
    }

    if (tag === "engineering_technical") score.Engineering += 8
    if (tag === "software_it") score.IT_Software += 8
    if (tag === "healthcare_clinical") score.Healthcare += 6
    if (tag === "trades_skilled") score.Trades += 8

    if (tag === "legal_regulatory") score.Legal += 8
    if (tag === "creative_design" || tag === "other") score.Other += 4
  }

  if (score.Sales > 0 && score.PreMed > 0) score.Sales += 2

  // When BOTH healthcare_clinical and premed_clinical fire, the role is
  // clearly in the medical/life-sciences space.
  if (score.Healthcare > 0 && score.PreMed > 0) {
    score.Healthcare += 5
    score.PreMed += 3
  }

  // When consulting_strategy fires, Consulting should beat Operations
  if (score.Consulting > 0 && score.Operations > 0 && tags.includes("consulting_strategy")) {
    score.Consulting += 3
  }

  const ordered: JobFamily[] = [
    "Engineering",
    "IT_Software",
    "Healthcare",
    "Legal",
    "Trades",
    "Finance",
    "Sales",
    "Marketing",
    "Consulting",
    "Operations",
    "HR",
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

  // Minimum threshold — prevents single weak-tag noise from winning.
  // Strong single-tag families (Engineering/IT/Legal/Trades at +8) always pass.
  if (bestScore < 4) return "Other"

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
      /\bideal candidates will have\b/i.test(cleaned)
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
    // Boilerplate tool-list guard: when a single line has 4+ tool
    // mentions and uses generic "computer skills / proficient with /
    // including / such as" wording, it's a company template paragraph
    // that lists common office tools without those being actual job
    // requirements. Demote everything on this line to supporting so
    // RISK_MISSING_TOOLS and missing-tool unit matching don't fire.
    const isBoilerplateToolList =
      tools.length >= 4 &&
      /\b(computer skills|technologically proficient|familiarity with|such as|e\.g\.|including)\b/i.test(cleaned)
    for (const tool of tools) {
      debugHits[`tool:${tool}`] = (debugHits[`tool:${tool}`] || 0) + 1
      if (side === "job") {
        const req: "core" | "supporting" = isBoilerplateToolList
          ? "supporting"
          : inRequiredSection ? "core" : detectRequiredness(cleaned)
        jobUnits.push(
          makeJobUnit(
            tool,
            `${tool} tool usage`,
            "tool",
            cleaned,
            Math.min(10, lineScore + 2),
            req
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

// Expand written number words to digits before regex matching so phrasings
// like "four years of experience" or "Minimum of four (4) years" parse.
// Covers one-ten only — anything higher in a JD's tenure clause is rare and
// already typically written numerically.
const WRITTEN_NUMBER_MAP: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
}
const WRITTEN_NUMBER_RE = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi

function expandWrittenNumbers(text: string): string {
  return text.replace(WRITTEN_NUMBER_RE, (m) => WRITTEN_NUMBER_MAP[m.toLowerCase()] || m)
}

function extractYearsRequired(jobText: string): number | null {
  const patterns: RegExp[] = Array.isArray((POLICY as any)?.extraction?.years?.patterns)
    ? ((POLICY as any).extraction.years.patterns as RegExp[])
    : []

  // Expand written numbers ("four" → "4") so written-form tenure clauses
  // ("four years of experience") match the digit-anchored regex patterns.
  // Phrasings with parenthetical digits ("four (4) years") are caught either
  // way — the parenthetical pattern consumes the parens and reads "(4)", and
  // the expansion gives the patterns a second shot at the bare "4".
  const matchText = expandWrittenNumbers(jobText)

  for (const r of patterns) {
    const m = matchText.match(r)
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

    // Template / boilerplate guard: when a SINGLE line mentions 4+ tools
    // AND uses generic "computer skills / familiarity with / including /
    // such as" wording, it's almost always a company template paragraph
    // that lists common office tools without them being actual job
    // requirements. Example: "Technologically proficient with strong
    // computer skills, including Microsoft Office Suite, Adobe Creative
    // Suite, CRM systems" (Richemont Legal Intern). A legal intern does
    // not actually need Adobe Creative Suite or CRM — that's the
    // company's catch-all boilerplate. Demote everything on the line
    // from required to preferred so RISK_MISSING_TOOLS doesn't fire.
    const isBoilerplateList =
      tools.length >= 4 &&
      /\b(computer skills|technologically proficient|familiarity with|such as|e\.g\.|including)\b/i.test(line)

    for (const tool of tools) {
      if (requiredLine && !isBoilerplateList) required.add(tool)
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

function inferCandidateDegreeStatus(
  profileText: string,
  gradYear: number | null,
  currentYear: number
): "has_degree" | "in_progress" | "no_degree" | "unknown" {
  // Completed degree: gradYear in the past
  if (gradYear && gradYear < currentYear) return "has_degree"

  // Degree keywords in profile
  const hasDegreeKeyword =
    /\b(b\.?\s*[as]\.?|bachelor'?s?|bachelor of|graduated|alumnus|alumni)\b/i.test(profileText) ||
    /\b(m\.?\s*[as]\.?|master'?s?|mba|ph\.?d|m\.?d\.?|j\.?d\.?)\b/i.test(profileText)

  if (hasDegreeKeyword && (!gradYear || gradYear <= currentYear)) return "has_degree"

  // In progress: gradYear in the future
  if (gradYear && gradYear > currentYear) return "in_progress"

  // In-progress keywords
  if (/\b(pursuing|candidate for|expected graduation|currently enrolled|junior|senior|sophomore|freshman|rising|expected\s+\d{4})\b/i.test(profileText)) {
    return "in_progress"
  }

  return "unknown"
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
// Extract only the professional experience portions of a resume.
// Walks the text line by line, tracking which section header is currently
// in scope. Lines under professional headers (EXPERIENCE, WORK EXPERIENCE,
// PROFESSIONAL EXPERIENCE, EMPLOYMENT, CAREER HISTORY, RELEVANT EXPERIENCE)
// are kept. Lines under non-professional headers (LEADERSHIP, INVOLVEMENT,
// EXTRACURRICULAR, ACTIVITIES, VOLUNTEER, COMMUNITY, AFFILIATIONS,
// CERTIFICATIONS, EDUCATION, SKILLS, INTERESTS, AWARDS, HONORS, HOBBIES)
// are dropped — their date ranges reflect club officer tenure, camp
// counselor summers, or fraternity membership, not professional tenure.
//
// If the resume has no recognizable section headers at all, returns the
// full text unchanged so the caller's range parser still has something to
// work with. Better to slightly over-estimate for an unstructured resume
// than to return null and trigger the "zero experience" fallback.
function extractProfessionalExperienceText(profileText: string): string {
  if (!profileText) return ""

  const PRO_HEADERS =
    /^\s*(?:professional experience|relevant experience|work experience|employment(?: history)?|experience|career history|career experience|internships?)\s*:?\s*$/i
  const NON_PRO_HEADERS =
    /^\s*(?:leadership(?:\s*[&and]+\s*involvement)?|involvement|extracurricular(?:\s*activities)?|activities|volunteer(?:\s*experience|\s*work)?|community(?:\s*service|\s*involvement)?|affiliations?|certifications?|education(?:\s*[&and]+\s*certifications?)?|skills(?:\s*[&and]+\s*interests)?|tools(?:\s*[&and]+\s*systems)?|interests|awards(?:\s*[&and]+\s*honors)?|honors(?:\s*[&and]+\s*awards)?|hobbies|core competencies|summary|objective|profile|references|publications|projects|coursework|training)\s*[:&]?\s*$/i

  const lines = profileText.split(/\r?\n/)
  let inProfessional = true // default true so content BEFORE any header is kept
  let sawAnyHeader = false
  const kept: string[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      kept.push(raw)
      continue
    }

    if (PRO_HEADERS.test(line)) {
      sawAnyHeader = true
      inProfessional = true
      kept.push(raw)
      continue
    }
    if (NON_PRO_HEADERS.test(line)) {
      sawAnyHeader = true
      inProfessional = false
      continue
    }

    if (inProfessional) kept.push(raw)
  }

  // No headers found at all → return original text. The resume is either
  // unstructured or too short to segment, and over-filtering risks returning
  // an empty string.
  if (!sawAnyHeader) return profileText

  const joined = kept.join("\n").trim()
  // If section filtering produced nothing meaningful, fall back to full text.
  return joined.length > 20 ? joined : profileText
}

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
  // Range parsing runs against the professional-experience-only slice of
  // the resume. Volunteer, camp, fraternity, and club membership date
  // ranges under LEADERSHIP / INVOLVEMENT / VOLUNTEER headers are excluded
  // so student candidates with long-running extracurriculars don't get
  // counted as having 5+ years of professional experience.
  const professionalText = extractProfessionalExperienceText(profileText)

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
  while ((m = monthRangeRx.exec(professionalText)) !== null) {
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
  while ((m = yearRangeRx.exec(professionalText)) !== null) {
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
  // Fix B (2026-05-07): the NEVER_CORE_KEYS blanket demotion was removed
  // here. It was auto-downgrading analysis_reporting, drafting_documentation,
  // communications_writing, consumer_research, strategy_problem_solving, and
  // clinical_patient_work to supporting regardless of context — but for jobs
  // where these ARE the core function (content writers, marketing analysts,
  // clinical roles, etc.), the auto-demotion was eating the actual core
  // requirements. Caused 37% of prod runs to have ALL requirements marked
  // supporting, which broke coreCoverageCount-gated floor rules in scoring.
  // Replacement: scoring.ts now weights supporting at 0.5 × core, so a
  // strength-10 supporting still counts but doesn't dominate a strength-10
  // core. Net effect: requirements keep the requiredness assigned by
  // detectRequiredness() at extraction time, with no across-the-board
  // override at selection time.
  return Array.from(
    new Map(
      units
        .sort((a, b) => b.strength - a.strength)
        .map((u) => [u.key, u] as const)
    ).values()
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

  // IB signals: require role-specific language, not boilerplate mentions.
  // Previously bare "investment banking" matched any firm About Us section
  // that listed their business lines (e.g. "wealth management advisory,
  // investment banking and asset management"), which misclassified every
  // UBS / JPM / Morgan Stanley wealth management support posting as IB.
  //
  // The fix: "investment banking" must appear adjacent to a role-context
  // word (analyst, associate, division, group, team, role, department,
  // vice president, VP, summer analyst). Other strong IB keywords below
  // stand alone because they're specific enough not to appear in broad
  // firm descriptions.
  const ibRoleContext = /\binvestment banking\s+(analyst|associate|vice president|vp|division|group|team|role|department|intern|internship|summer|full.?time)\b|\b(analyst|associate|vp|vice president|intern)\s+(in|at|within|for)\s+investment banking\b/i
  const ibKeywords = /\b(mergers and acquisitions|m&a advisory|capital raising|pitch book|pitchbook|coverage group|bulge bracket|leveraged buyout|lbo modeling|deal execution|ib analyst|ib associate|ib intern|ibd\b)\b/i
  // Previously had a `(hasProspecting && hasFinancialAnalysis)` fallback
  // that fired IB on any wealth-management support role whose JD
  // included client prospecting language AND a company About Us blurb
  // mentioning financial services (e.g., Raymond James Client Service
  // Associate in Boca Raton). The fallback is removed — IB classification
  // now requires explicit IB vocabulary or role context.
  if (ibRoleContext.test(normalized) || ibKeywords.test(normalized)) {
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

// ── Sales sub-family inference ───────────────────────────────────────────────
// Sales is not monolithic. A candidate who targets medical device sales
// (OR exposure, surgical implants, trauma/spinal/prosthetic) treats
// pharmaceutical sales as a different job. This classifier splits sales
// JDs into concrete sub-segments so we can detect mismatch against a
// candidate's stated target sub-segment.
function inferJobSalesSubFamily(
  jobTextRaw: string,
  userTitleNorm: string
): import("./signals").SalesSubFamily {
  const t = jobTextRaw.toLowerCase()
  const title = userTitleNorm.toLowerCase()
  const combined = title + " " + t.slice(0, 2000)

  // Medical device: OR coverage, surgical instruments, implants,
  // orthopedic / trauma / spinal / prosthetic product lines. These JDs
  // typically emphasize case coverage and surgeon relationships.
  const medDeviceRe =
    /\b(medical device|orthopedic (sales|rep|territory)|trauma (sales|rep|implants?)|spinal (sales|rep|implants?|products?)|prosthetic (sales|rep)|surgical (instrument|implant|device) (sales|rep)|case coverage|operating room (coverage|support|rep)|implant sales|clinical specialist.{0,40}(device|implant|orthopedic|trauma|spinal)|associate (sales|clinical) (rep|representative|specialist).{0,40}(device|implant|orthopedic|trauma)|capital equipment sales)\b/i
  if (medDeviceRe.test(combined)) return "medical_device"

  // Pharmaceutical: pharma rep, drug sampling, formulary, CSO, prescriber
  // calls. These JDs emphasize product detailing to physicians.
  const pharmaRe =
    /\b(pharmaceutical sales|pharma (sales|rep|representative)|pharmaceutical rep|drug rep|pharmaceutical cso|pharmaceutical product expert|therapeutic area specialist|specialty pharmaceutical|oncology sales|cns sales|biotech sales rep|primary care rep|prescriber (call|engagement)|formulary access|pharmaceutical territory)\b/i
  if (pharmaRe.test(combined)) return "pharmaceutical"

  // Financial services sales: wealth management, insurance, client advisor
  const finSalesRe =
    /\b(wealth management (sales|advisor)|financial advisor.{0,20}(sales|client acquisition)|insurance (sales|producer|agent)|registered representative|client advisor|private banker|personal banker|relationship banker)\b/i
  if (finSalesRe.test(combined)) return "financial_services"

  // SaaS / tech sales: SDR, BDR, AE, quota tech sales
  const saasRe =
    /\b(saas sales|software sales|technology sales|tech sales|sdr\b|bdr\b|account executive.{0,20}(saas|software|technology)|sales development representative|business development representative|inside sales.{0,20}(saas|software|technology)|enterprise software sales|cloud sales|platform sales)\b/i
  if (saasRe.test(combined)) return "saas_tech"

  // Advertising / media sales
  const adMediaRe =
    /\b(advertising sales|media sales|ad sales|digital advertising sales|publisher sales|programmatic sales|brand partnerships sales|sponsorship sales)\b/i
  if (adMediaRe.test(combined)) return "advertising_media"

  // Real estate sales
  const reSalesRe =
    /\b(real estate (sales|agent|broker)|commercial real estate (sales|broker)|leasing (agent|sales)|residential real estate|cre sales)\b/i
  if (reSalesRe.test(combined)) return "real_estate"

  // Industrial / B2B distribution
  const industrialRe =
    /\b(industrial (sales|distribution)|manufacturing sales|distributor sales|wholesale sales|outside sales.{0,20}(industrial|manufacturing|equipment)|territory manager.{0,30}(industrial|manufacturing|distribution))\b/i
  if (industrialRe.test(combined)) return "industrial_b2b"

  // Retail / consumer goods
  const retailRe =
    /\b(retail sales|consumer (goods|products) sales|cpg sales|consumer packaged goods sales|in-store sales)\b/i
  if (retailRe.test(combined)) return "retail_consumer"

  return "other_sales"
}

// ── Profile-side sales sub-segment inference ─────────────────────────────────
// Parse the candidate's target_roles / profile_text for explicit
// sub-segment signals so the scoring layer can detect mismatch with the
// job-side salesSubFamily.
export function inferProfileSalesSubsegments(
  targetRoles: string | null | undefined,
  profileText: string | null | undefined
): import("./signals").SalesSubFamily[] {
  const tr = String(targetRoles || "").toLowerCase()
  const pt = String(profileText || "").toLowerCase()
  const combined = tr + " " + pt
  const out: import("./signals").SalesSubFamily[] = []

  // Medical device — strong signals. We check targetRoles primarily
  // because profileText may describe clinical work (not a sales target).
  if (
    /\b(medical device|orthopedic sales|trauma sales|spinal sales|prosthetic sales|prostetic sales|clinical sales|associate sales rep|clinical specialist|implant sales|surgical (equipment|device) sales|case coverage|operating room)\b/.test(tr) ||
    /\b(operating room|surgical equipment|orthopedic|trauma|spinal|prosthetic)\b/.test(pt) && /\b(sales)\b/.test(tr)
  ) {
    out.push("medical_device")
  }

  if (/\b(pharmaceutical sales|pharma sales|pharma rep|drug rep|prescriber)\b/.test(combined)) {
    out.push("pharmaceutical")
  }

  if (/\b(saas sales|tech sales|software sales|sdr|bdr|account executive)\b/.test(combined)) {
    out.push("saas_tech")
  }

  if (/\b(advertising sales|media sales|ad sales)\b/.test(combined)) {
    out.push("advertising_media")
  }

  if (/\b(wealth management|financial advisor|insurance sales|client advisor|private banker)\b/.test(combined)) {
    out.push("financial_services")
  }

  if (/\b(real estate sales|commercial real estate|cre sales|leasing agent)\b/.test(combined)) {
    out.push("real_estate")
  }

  if (/\b(industrial sales|manufacturing sales|distributor sales|wholesale sales)\b/.test(combined)) {
    out.push("industrial_b2b")
  }

  // Deduplicate
  return Array.from(new Set(out))
}

function inferProfileFinanceSubFamily(
  normalized: string,
  evidenceUnits: ProfileEvidenceUnit[]
): FinanceSubFamily {
  const unitKeys = new Set(evidenceUnits.map((u) => u.key))

  const hasFpaExecution = unitKeys.has("analysis_reporting") || unitKeys.has("accounting_operations")
  const hasFinancialAnalysis = unitKeys.has("financial_analysis")

  // IB language — strongest signal, check first.
  const ibKeywords = /\b(investment banking|m&a analysis|mergers and acquisitions|capital markets|ipo|lbo model|pitch book|pitchbook|bulge bracket|boutique bank|coverage group|ibd)\b/i
  if (ibKeywords.test(normalized)) {
    return "ib"
  }

  // Asset Management — moved BEFORE FP&A so a candidate with strong
  // investment/portfolio/valuation signals is not miscategorized as
  // corporate finance. The old order put FPA first, and the FPA regex
  // included bare "budgeting", which matched both "Capital Budgeting"
  // (an investment-analysis technique) and fraternity "Oversee
  // budgeting" work — miscategorizing an investments-intern candidate
  // as FPA and firing a false-positive RISK_SUBFAMILY_MISMATCH.
  const amKeywords = /\b(asset management|portfolio management|equity research|aum|fixed income|hedge fund|endowment|stock portfolio|investments intern|investment intern|investment analysis|capital calls|asset allocation|securities analysis|wealth management|dcf|discounted cash flow|capm|wacc|npv and irr|valuation models?)\b/i
  if (amKeywords.test(normalized)) {
    return "asset_management"
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

  // FP&A language — tightened to require concrete corporate FP&A
  // vocabulary rather than bare "budgeting" which is a generic finance
  // word. "Capital budgeting", "project budgeting", "event budgeting"
  // etc. all contain "budgeting" but are not FPA.
  const fpaKeywords = /\b(fp&a|fpa|variance analysis|board package|board reporting|monthly close|quarterly report|financial planning and analysis|budget variance|variance to budget|operating budget|opex budget|forecast accuracy|rolling forecast|p&l ownership|profit and loss statement)\b/i
  if (fpaKeywords.test(normalized) && hasFpaExecution) {
    return "fpa"
  }

  if (hasFinancialAnalysis || hasFpaExecution) {
    // Default for Finance profiles with no specific signal: other_finance
    // rather than FPA. Previously we defaulted to FPA which forced a
    // sub-family mismatch penalty on any non-FPA finance job.
    return "other_finance"
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

// Defensive JD normalizer. Some clipboard sources (LinkedIn, PDFs, Word
// docs rendered to plain text, certain rich-text editors) preserve
// paragraph breaks but collapse inline bullets — turning
//   "Event Setup: ... On-Site Ops: ... Visitor Experience: ..."
// into one paragraph. Our line-anchored extraction can't see those as
// distinct units, so it falls back to stray keyword matches and produces
// near-empty requirement_units. Confirmed Aiden case 2026-05-04: a
// LinkedIn paste with run-on bullets produced 1 false-positive
// requirement_unit and 0 why_codes, scoring Pass/36 instead of the
// Review/64 the same JD with line breaks produced.
//
// All transforms are idempotent on top of existing newlines — running
// this on a well-formatted JD inserts no extra breaks because every
// pattern requires mid-line context (preceded by a sentence-end or
// non-newline whitespace).
function normalizeJobDescription(jobText: string): string {
  let t = jobText

  // Insert \n before bullet characters when they appear mid-line.
  // Covers • · ▪ ◦ ‣ and similar visual bullet markers that LinkedIn /
  // PDF clipboard text often preserves but inlines.
  t = t.replace(/([^\n])\s*([•·▪◦‣])\s*/g, "$1\n$2 ")

  // Insert \n before "Title Case Phrase: " patterns that appear after a
  // sentence-ending character — the structural shape of run-on bullets
  // ("Event Setup: ... On-Site Ops: ..."). Phrase = 1–5 Title Case words,
  // optionally joined with "&", "and", or "or". Requires immediate
  // [.!?] before to avoid breaking legitimate prose mid-sentence.
  t = t.replace(
    /(?<=[.!?]\s+)([A-Z][a-zA-Z]+(?:\s+(?:&|and|or)\s+[A-Z][a-zA-Z]+|\s+[A-Z][a-zA-Z]+){0,4}:\s)/g,
    "\n$1"
  )

  // Collapse runs of 3+ horizontal whitespace chars into "\n\n". Common
  // in PDF-extracted text where layout columns produce big space runs.
  t = t.replace(/[ \t]{3,}/g, "\n\n")

  return t
}

export function extractJobSignals(
  jobTextRaw: string,
  opts?: { userJobTitle?: string }
): StructuredJobSignals {
  // Pre-normalize before any extraction reads jobTextRaw. All downstream
  // line-anchored detectors see properly-broken JD text.
  jobTextRaw = normalizeJobDescription(jobTextRaw)

  const normalized = norm(jobTextRaw)
  const rawHash = stableHash(normalized)
  // Prepend the user-provided title (if any) so all the title-based
  // detectors below (jobTitleIsSoftware, jobTitleIsFinance, etc.) see
  // the authoritative title rather than relying on whether the JD body
  // happens to contain the title in its first 1500 chars. Real JDs
  // frequently bury the title below a long "About Us" company blurb,
  // which causes title-based family inference to silently no-op.
  const userTitleNorm = opts?.userJobTitle ? norm(opts.userJobTitle) : ""

  const rawLines = jobTextRaw.split(/\r?\n/)
  const jobTitle = extractJobTitle(rawLines)
  const companyName = extractCompanyName(jobTextRaw, rawLines)

  // Section-aware extraction: filter out "About the company", "Benefits",
  // and "How to apply" sections before building requirement units so
  // company blurbs and compensation language don't pollute the
  // requirement_units stream. The full raw body is still used by
  // ambient detectors (title family, training program, hourly, etc.)
  // later in this function.
  const { filteredText: filteredJobText, droppedKinds } = filterJobTextToRequirements(jobTextRaw)
  if (droppedKinds.size > 0) {
    console.log(`[extract] Section filter dropped: ${Array.from(droppedKinds).join(", ")}`)
  }

  const lines = splitEvidenceLines(filteredJobText)
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
  //
  // When a user-provided title is available, we prepend it so the
  // title-based regex detectors can match against the authoritative value
  // instead of hunting through the JD body. This is critical for short /
  // company-heavy JDs where the actual title never appears in the first
  // 1500 chars of the body.
  const jobTitleSlice = userTitleNorm
    ? userTitleNorm + "\n" + normalized.slice(0, 1500)
    : normalized.slice(0, 1500)
  const jobTitleIsFinance =
    /\b(finance intern|financial analyst|fp&a|fpa intern|fpa analyst|fpa associate|treasury analyst|treasury associate|treasury|investment banking|accounting intern|financial intern|finance associate|finance coordinator|corporate finance|financial planning|financial reporting|project finance|investor relations|investment analyst|investment associate|capital markets|private equity analyst|private equity associate|private equity|venture capital analyst|vc analyst|asset management analyst|asset management|portfolio analyst|portfolio associate|wealth management|wealth advisor|financial advisor|financial professional|financial consultant|financial planner|client associate|client service associate|advisor development|wealth relationship|relationship manager|series 7|finra|securities|broker dealer|credit analyst|credit associate|risk analyst|risk associate|controller|assistant controller|budget analyst|financial coordinator)\b/i.test(jobTitleSlice)
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
    /\b(chief of staff|strategy (and|&) (business )?operations|business operations|business ops|strategy (and|&) operations|strategic operations|strategy manager|strategy director|strategy associate|strategy consultant|management consultant|management consulting|operations manager|operations director|director of operations|head of operations|vp of operations|business strategy|corporate strategy|internal operations|people operations|hr business partner|hrbp)\b/i.test(jobTitleSlice) ||
    // "Associate to the Chairman / CEO / Founder / President" — these are
    // Chief-of-Staff archetype roles at founder-led or privately-held
    // companies. The title doesn't literally say "Chief of Staff" but the
    // JD describes exactly that: executing the principal's operational
    // and strategic priorities, cross-functional project ownership, and
    // decision enablement. Route to Consulting family so CoS candidates
    // match them instead of falling through to accidental family inference.
    /\b(associate|assistant|executive assistant|chief assistant) to the (chairman|ceo|founder|president|managing partner|executive chairman|chairwoman)\b/i.test(jobTitleSlice) ||
    /\b(chairman|ceo|founder|president)'s (associate|assistant|right hand|chief of staff)\b/i.test(jobTitleSlice)

  // Life sciences / chemistry / pharma lab titles. Route these to the
  // Engineering family because the scoring engine has no dedicated
  // Healthcare-Science family and Engineering is the closest fit for
  // lab-based work (vs. Healthcare which is reserved for clinical /
  // nursing / patient-facing roles). Without this, scientist / chemist /
  // analytical / biologist roles fall through to tag-based inference
  // and misclassify as Marketing (from "research" / "communications"
  // keywords) or IT_Software (from "technical" / "analysis" keywords).
  const jobTitleIsLifeSciences =
    /\b(scientist( i| ii| iii)?|chemist( i| ii| iii)?|biologist( i| ii| iii)?|biochemist|microbiologist|analytical scientist|analytical chemist|research scientist|research associate|laboratory (technician|scientist|analyst)|lab technician|lab analyst|quality control (analyst|scientist|chemist|technician)|qc analyst|qc chemist|qc scientist|qc technician|process development (scientist|engineer|associate)|formulation (scientist|chemist)|analytical development|bioinformatics|cell biologist|molecular biologist|clinical trials associate|clinical research associate|vaccines associate|pharmacology|toxicology)\b/i.test(
      jobTitleSlice
    )

  // Cybersecurity / InfoSec titles. Route to IT_Software family because
  // the scoring engine has no dedicated security family and cybersecurity
  // work sits in the same technical/IT space as software engineering.
  // Without this, short cybersecurity JDs (SOC Analyst, Security Engineer,
  // Cyber Intelligence Analyst) fall through to tag-based inference and
  // get misclassified as Marketing because their body text is heavy on
  // "communicate", "report", "analyze" language.
  const jobTitleIsCyberSecurity =
    /\b(cyber security|cybersecurity|cyber intelligence|information security|info\s?sec|network security|application security|cloud security|security (engineer|analyst|architect|consultant|specialist|associate|operations|administrator|engineer ii|engineer i)|security operations center|soc analyst|threat intelligence analyst|penetration tester|pen tester|pentester|vulnerability analyst|grc analyst|siem|incident response|red team|blue team|ethical hacker|malware analyst|forensics analyst)\b/i.test(
      jobTitleSlice
    )

  // Legal titles — in-house counsel, law firm roles, legal interns, and
  // compliance counsel all route to Legal family. Without this, Legal
  // Intern / Corporate Counsel / Paralegal JDs with generic corporate
  // body text ("platforms", "team", "operations") fall through to
  // tag-based inference and classify as Other / Consulting / Marketing.
  // Covers both law-firm-side (associate, partner) and in-house-side
  // (counsel, general counsel) ladders.
  const jobTitleIsLegal =
    /\b(legal intern|legal internship|legal counsel|general counsel|assistant general counsel|associate general counsel|corporate counsel|commercial counsel|compliance counsel|deputy general counsel|attorney|paralegal|law clerk|legal assistant|legal secretary|legal operations|legal ops|contracts (manager|counsel|attorney)|contract lifecycle management|clm specialist|legal analyst|legal associate|law firm associate|litigation (associate|partner|paralegal)|regulatory counsel|legal affairs|chief legal officer|cLo|privacy counsel|ip counsel|intellectual property counsel)\b/i.test(
      jobTitleSlice
    )

  // HR / people leadership titles. Route to "Other" family (scoring
  // engine has no HR family) so they don't get matched as Consulting
  // via the operations_general tag bare-word matching. Without this,
  // a "Director of Human Resources" JD matches any Consulting candidate
  // just because its body uses the word "operations".
  const jobTitleIsHR =
    /\b(human resources|hr director|hr manager|hr coordinator|hr associate|hr generalist|hr specialist|hr analyst|hr intern|hrbp|hr business partner|director of (people|hr|human resources)|head of (people|hr|human resources)|chief (people|human resources) officer|people operations|people ops|talent acquisition|talent coordinator|talent development|recruiter|recruiting coordinator|compensation and benefits|compensation analyst|benefits coordinator|labor relations|employee relations|dei coordinator|learning and development|l&d coordinator|onboarding specialist)\b/i.test(
      jobTitleSlice
    )

  // PR / communications agency "account" titles. At a PR or comms
  // agency, "Account Coordinator / Executive / Supervisor / Director"
  // is the standard career ladder — these are PR/media-relations roles,
  // NOT sales roles. Without this detector, the body's "pitches",
  // "new business research", and "account" language fires sales_bd,
  // and metaphorical "apprentice / builder" language can even push the
  // role into Trades. We require BOTH an account-title phrase AND
  // unambiguous PR/comms agency context in the first 1500 chars so this
  // does not over-fire on genuine sales Account Executive roles.
  const hasAccountTitle =
    /\b(account coordinator|account executive|account supervisor|account director|account manager)\b/i.test(jobTitleSlice)
  const hasPRCommsAgencyContext =
    /\b(public relations|communications practice|pr agency|pr firm|communications agency|media relations|press release|press outreach|media pitch|media pitching|earned media|editorial placements|influencer relations|client communications|comms practice)\b/i.test(jobTitleSlice)
  const jobTitleIsPRCommsAgency = hasAccountTitle && hasPRCommsAgencyContext

  const jobTitleIsOperations =
    /\b(operations analyst|operations associate|operations coordinator|operations manager|operations specialist|operations intern|ops analyst|ops associate|supply chain analyst|supply chain coordinator|supply chain manager|logistics coordinator|logistics analyst|logistics manager|program coordinator|program manager|project coordinator|project manager|process analyst|process improvement|business operations|biz ops)\b/i.test(jobTitleSlice)

  const jobTitleIsAnalytics =
    /\b(data analyst|business analyst|business intelligence|bi analyst|bi developer|analytics analyst|analytics associate|analytics engineer|analytics coordinator|analytics intern|data scientist|quantitative analyst|quant analyst|research analyst|insights analyst|insights associate|reporting analyst|decision science)\b/i.test(jobTitleSlice)

  const jobTitleIsConsulting =
    /\b(consultant|consulting analyst|management consultant|strategy consultant|associate consultant|business consultant|advisory analyst|advisory associate|strategy analyst|strategy associate|transformation analyst|change management|process consultant|implementation consultant)\b/i.test(jobTitleSlice)

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
  if (jobTitleIsPRCommsAgency && !functionTags.includes("communications_pr")) {
    functionTags.push("communications_pr")
  }
  if (jobTitleIsCyberSecurity && !functionTags.includes("software_it")) {
    functionTags.push("software_it")
  }
  if (jobTitleIsLegal && !functionTags.includes("legal_regulatory")) {
    functionTags.push("legal_regulatory")
  }

  const jobFamilyFromTags = familyFromFunctionTags(functionTags)

  // Family assignment cascade — title overrides beat tag-based inference.
  // Priority order: hard-field titles first, then business-field titles,
  // then tag-based fallback.
  const jobFamily: JobFamily = jobTitleIsLegal
    ? "Legal"
    : isLegalOpsContext
    ? "Other"
    : jobTitleIsLifeSciences
      ? "Engineering"
      : jobTitleIsEngineering
        ? "Engineering"
        : jobTitleIsSoftware
          ? "IT_Software"
          : jobTitleIsCyberSecurity
            ? "IT_Software"
          : jobTitleIsHealthcare
            ? "Healthcare"
            : jobTitleIsTrades
              ? "Trades"
              : jobTitleIsHR
                ? "HR"
                : jobTitleIsPRCommsAgency
                  ? "Marketing"
                  : jobTitleIsMarketing
                    ? "Marketing"
                    : jobTitleIsConsulting
                      ? "Consulting"
                      : jobTitleIsStrategyOps
                        ? "Consulting"
                        : jobTitleIsFinance
                          ? "Finance"
                          : jobTitleIsAnalytics
                            ? "Analytics"
                            : jobTitleIsOperations
                              ? "Operations"
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

  // Bachelor's degree detection
  const bachelorRequired =
    /\b(bachelor'?s?\s*(degree)?|b\.?s\.?|b\.?a\.?)\s*(degree)?\s*(required|minimum|plus|and\s+above)/i.test(jobTextRaw) ||
    /\brequires?\s+a?\s*(bachelor'?s?|undergraduate)\s*degree/i.test(jobTextRaw) ||
    /\bdegree\s+required/i.test(jobTextRaw) ||
    /\beducation[:\s]+bachelor/i.test(jobTextRaw) ||
    /\bminimum\s+[^.]{0,30}bachelor/i.test(jobTextRaw) ||
    /\bbachelor'?s?\s+(or\s+(higher|above|equivalent))/i.test(jobTextRaw)
  const bachelorPreferred =
    !bachelorRequired &&
    /\bbachelor'?s?\s*(degree)?\s*preferred/i.test(jobTextRaw)
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
  const isSalesHeavy = (jobTitleIsMarketing || jobTitleIsPRCommsAgency)
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

  // ── Advisory / consulting / banking background requirement ─────────────
  // Many senior Strategy/Ops and Finance roles require prior experience
  // specifically AT a top management consulting firm or investment bank.
  // This is a hard screen gate that human recruiters apply but that the
  // tag-based extractor doesn't catch, because the JD body uses language
  // like "management consulting" or "top advisory firm" as REQUIREMENTS,
  // not as tag-matchable unit phrases.
  //
  // When detected, we also check whether the profile text has matching
  // evidence — either the word "management consulting" / "investment
  // banking" / "top advisory" itself, or one of the well-known firm names
  // (McKinsey, Bain, BCG, Big 4, bulge-bracket banks). Absence → risk.
  const advisoryBackgroundPatterns: RegExp[] = [
    /\b(within|at|from|experience (?:at|in|with))\s+(?:a\s+)?(?:top|leading|premier|elite|tier[-\s]?1|bulge[-\s]?bracket|big\s*4|big\s*five)\s+(?:advisory|consulting|management consulting|investment bank|bank|strategy consulting|strategy firm)\b/i,
    /\b(?:prior|previous)\s+experience\s+(?:at|in|with)\s+(?:a\s+)?(management consulting|investment banking|strategy consulting)\b/i,
    /\brole\s+within\s+(?:a\s+)?top\s+(advisory|consulting|investment bank|bank)\b/i,
    /\b(3|4|5|6|7|8)\s*[-–]\s*(5|6|7|8|9|10)\+?\s*years?\s+(?:of\s+)?(?:relevant\s+)?experience\s+in\s+(?:a\s+)?(management consulting|financial analyst|investment banking|consulting)\b/i,
    /\bmanagement consulting\s+or\s+(financial analyst|investment banking|banking)\b/i,
    /\b(financial analyst|investment banking associate|analyst\/associate)\s+role\s+within\s+(?:a\s+)?top\b/i,
  ]
  const requiresAdvisoryBackground = advisoryBackgroundPatterns.some((re) =>
    re.test(jobTextRaw)
  )
  // Check if the profile has matching advisory/consulting/banking evidence.
  // Looks for the discipline name itself OR well-known firm names.
  const ADVISORY_FIRM_REGEX = /\b(mckinsey|bain\b|bcg|boston consulting|deloitte|pwc|pricewaterhouse|ey|ernst\s*&\s*young|kpmg|accenture|oliver wyman|ll?ek|l\.e\.k\.|roland berger|goldman sachs|morgan stanley|j\.?p\.?\s*morgan|jpmorgan|citi(group)?|bank of america|barclays|credit suisse|ubs|deutsche bank|lazard|evercore|moelis|centerview|rothschild|houlihan lokey|guggenheim|jefferies|perella|blackstone|kkr|carlyle)\b/i
  const ADVISORY_DISCIPLINE_REGEX = /\b(management consulting|strategy consulting|investment banking|financial analyst|investment banking analyst|banking analyst|equity research|m&a advisory|corporate finance advisory|restructuring advisory|transaction advisory)\b/i
  // This is evaluated after profile extraction — we stash a flag for the
  // scoring layer to consume since the extractor only sees the JD side.
  if (requiresAdvisoryBackground) {
    console.log("[extract] Advisory/consulting/banking background requirement detected")
  }

  // ── Financial modeling / valuations / public filings requirement ──────
  // Distinct from generic "analysis and reporting" — this is concrete
  // financial modeling work (3-statement models, DCF, valuations, M&A
  // models, SEC public filings) that requires corporate finance or
  // investment banking proof on the profile side. Without this, the
  // extractor lumps it into analysis_reporting which any ops candidate
  // can satisfy with "operating cadence" language.
  const financialModelingPatterns: RegExp[] = [
    /\bfinancial\s+model(s|ing)?\b/i,
    /\bthree[-\s]?statement\s+model/i,
    /\b3[-\s]?statement\s+model/i,
    /\bdcf\s+model|discounted cash flow/i,
    /\bvaluation(s|\s+analysis|\s+modeling)?\b/i,
    /\bforecasting\s+(models?|analysis)/i,
    /\b(public|sec)\s+filings\b/i,
    /\b10[-\s]?k\b|\b10[-\s]?q\b/i,
    /\bcompany reporting documents\b/i,
    /\bm&a\s+(model|analysis|due diligence)/i,
    /\bcapital allocation\b/i,
    /\bleveraged\s+buyout|\blbo\s+model/i,
  ]
  const requiresFinancialModeling = financialModelingPatterns.some((re) =>
    re.test(jobTextRaw)
  )
  if (requiresFinancialModeling) {
    console.log("[extract] Financial modeling requirement detected")
  }

  const reportingStrong = requirementUnits.some(
    (u) => u.key === "analysis_reporting" && u.requiredness === "core"
  )

// Compute finance sub-family when job is Finance
  const jobFinanceSubFamily: import("./signals").FinanceSubFamily =
    jobFamily === "Finance"
      ? inferJobFinanceSubFamily(normalized, requirementUnits, functionTags)
      : null

  // Compute sales sub-family when job is Sales (or has sales_bd tag).
  // Fires even for non-Sales families because a "Clinical Specialist"
  // role may route to Healthcare but still be fundamentally a sales
  // sub-segment (medical device) we want to distinguish.
  const jobSalesSubFamily: import("./signals").SalesSubFamily =
    jobFamily === "Sales" || functionTags.includes("sales_bd")
      ? inferJobSalesSubFamily(jobTextRaw, userTitleNorm)
      : null

  // Territory-based role with no disclosed location. Pharmaceutical and
  // medical device sales JDs frequently say "live within territory /
  // territory boundaries / 30 miles of territory" without specifying
  // where the territory is. Surface as a risk so the candidate confirms
  // location before applying.
  const hasTerritoryLanguage =
    /\b(within (?:the )?territory|territory boundaries?|within \d+ miles? of territory|live within|territory-?based)\b/i.test(
      jobTextRaw
    )
  // We consider the territory disclosed if the JD mentions any specific
  // US city, state name, or common region descriptor tied to the role.
  const hasDisclosedLocation =
    !!(location && (location.city || location.mode !== "unclear")) ||
    /\b(new york|nyc|manhattan|brooklyn|los angeles|san francisco|chicago|boston|miami|fort lauderdale|dallas|houston|austin|atlanta|seattle|denver|philadelphia|washington dc|washington, d\.?c\.?|san diego|phoenix|minneapolis|portland|northeast|southeast|midwest|west coast|east coast|tri[-\s]state|bay area)\b/i.test(
      jobTextRaw
    )
  const territoryUndisclosed = hasTerritoryLanguage && !hasDisclosedLocation

  // Pharmaceutical sales training preference — fire a soft risk when the
  // JD mentions it and the profile has no pharma or med-sales exposure.
  // This gets checked against the profile at scoring time; here we just
  // stash the JD-side signal.
  const mentionsPharmaTraining =
    /\b(pharmaceutical sales training|pharma sales training|pharmaceutical sales (?:education|certification|rep training))\b/i.test(
      jobTextRaw
    )

return {
    rawHash,
    jobTitle,
    companyName,
    jobFamily,
    financeSubFamily: jobFinanceSubFamily,
    salesSubFamily: jobSalesSubFamily,
    // Territory-without-location and pharma-training-preference are
    // stashed on the signals object as any-typed properties consumed by
    // the scoring layer. They intentionally are not on StructuredJobSignals
    // because they are purely risk inputs, not core signals.
    ...(territoryUndisclosed ? { territoryUndisclosed: true } : {}),
    ...(mentionsPharmaTraining ? { mentionsPharmaTraining: true } : {}),
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
    bachelorRequired,
    bachelorPreferred,
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
    requiresAdvisoryBackground,
    requiresFinancialModeling,
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
    // Was ["Sales"] — silent assertion that any sparse-resume candidate
    // is targeting Sales. Now [] so the family-mismatch penalty
    // (scoring.ts:802 checks length > 0) and GATE_FIELD_MISMATCH gate
    // (constraints.ts:67 checks length > 0) treat "no family signal" as
    // honestly unknown rather than as an asserted Sales preference.
    targetFamilies: baseFamilies.length ? baseFamilies : [],
    locationPreference: { mode: "unclear", constrained: false, allowedCities: undefined },
    constraints: defaultConstraintsFromText(profileTextRaw, wantsInternship),
    tools: extractedTools,
    gradYear: inferProfileGradYear(profileTextRaw),
    degreeStatus: inferCandidateDegreeStatus(profileTextRaw, inferProfileGradYear(profileTextRaw), new Date().getFullYear()),
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

  // Infer sales sub-segment targeting from target_roles + profile_text.
  // Always runs so that even non-Sales-family profiles get annotated
  // when they mention a sales sub-segment (e.g., a pre-med candidate
  // targeting medical device sales gets salesTargetSubsegments set).
  const targetRolesRaw = (merged as any).targetRolesRaw as string | undefined
  const salesTargetSubsegments = inferProfileSalesSubsegments(
    targetRolesRaw || null,
    profileTextRaw
  )

  return {
    ...merged,
    financeSubFamily: profileFinanceSubFamily,
    ...(salesTargetSubsegments.length > 0 ? { salesTargetSubsegments } : {}),
  }
}