export type ClusterDef = {
  id: string
  label: string
  definition: string
  example_phrases: string[]
}

export const TAXONOMY: ClusterDef[] = [
  // Analytical + Quant
  {
    id: "CLUSTER_QUANT_ANALYSIS",
    label: "Quantitative analysis",
    definition: "Analyzing numeric data to find patterns, insights, or conclusions.",
    example_phrases: ["quantitative", "analyze data", "data analysis", "metrics", "kpi", "insights"],
  },
  {
    id: "CLUSTER_FIN_MODELING",
    label: "Financial modeling and valuation",
    definition: "Building models to evaluate financial performance, value, or investment decisions.",
    example_phrases: ["financial model", "dcf", "valuation", "underwriting", "sources and uses", "cash flow model"],
  },
  {
    id: "CLUSTER_REPORTING_DASHBOARDS",
    label: "Reporting and dashboards",
    definition: "Tracking, reporting, and summarizing performance through reports or dashboards.",
  example_phrases: [
  "dashboard",
  "dashboards",
  "reporting",
  "weekly report",
  "monthly report",
  "track",
  "tracker",
  "scorecard",
  "database updates",
  "manage database",
  "database",
  "data entry",
  "property listings",
  "listings",
  "rfp",
  "rfp's",
  "proposals",
  "format proposals",
  "correspondence",
],
  },
  {
    id: "CLUSTER_MARKET_RESEARCH",
    label: "Market and competitive research",
    definition: "Researching markets, competitors, customers, or industries to support decisions.",
  example_phrases: [
  "market research",
  "competitive analysis",
  "swot",
  "industry research",
  "due diligence",
  "availability",
  "ownership",
  "zoning",
  "tenant",
  "transaction information",
  "survey calling",
  "market evaluation",
  "sales comps",
  "comps",
  "restrictions",
  "property research",
  "internal and external resources",
],
  },
  {
    id: "CLUSTER_RISK_DILIGENCE",
    label: "Risk assessment and diligence",
    definition: "Evaluating risks, constraints, or diligence questions for decisions.",
    example_phrases: ["risk assessment", "diligence", "credit memo", "memorandum", "risk analysis"],
  },

  // Strategy + Problem solving
  {
    id: "CLUSTER_STRUCTURED_PROBLEM_SOLVING",
    label: "Structured problem solving",
    definition: "Breaking down ambiguous problems into clear steps and recommendations.",
    example_phrases: ["problem solving", "structured", "hypothesis", "framework", "recommendation"],
  },
  {
    id: "CLUSTER_PROCESS_IMPROVEMENT",
    label: "Process improvement",
    definition: "Improving workflows, processes, speed, accuracy, or quality.",
    example_phrases: ["process improvement", "optimize", "streamline", "workflow", "refine process"],
  },

  // Ops + Execution
  {
    id: "CLUSTER_PROJECT_COORDINATION",
    label: "Project coordination and timelines",
    definition: "Coordinating people, timelines, tasks, deliverables, and project tracking.",
    example_phrases: ["project coordination", "timeline", "project plan", "monday.com", "asana", "airtable", "jira"],
  },
  {
    id: "CLUSTER_STAKEHOLDER_COLLAB",
    label: "Cross functional collaboration",
    definition: "Working across teams and stakeholders to deliver outcomes.",
    example_phrases: ["cross-functional", "stakeholders", "partner with", "collaborate", "work with teams"],
  },
  {
    id: "CLUSTER_IMPL_ROLLOUT",
    label: "Implementation and rollout support",
    definition: "Supporting deployment, adoption, training, or rollout of tools/processes.",
    example_phrases: ["rollout", "implementation", "adoption", "enablement", "training materials"],
  },
{
  id: "CLUSTER_QA_TESTING",
  label: "Software / System Testing",
  definition: "Testing software systems, applications, or technical implementations to ensure quality and performance.",
  example_phrases: [
    "quality assurance",
    "qa ",
    "test cases",
    "test plans",
    "user acceptance testing",
    "uat",
    "regression testing",
    "bug tracking",
    "defect",
    "issue tracking",
    "jira",
    "automation testing",
    "manual testing"
  ],
},

  // Communication + client work
  {
    id: "CLUSTER_EXEC_PRESENTATION",
    label: "Executive communication and decks",
    definition: "Creating decks, summaries, and communicating progress or recommendations.",
    example_phrases: ["presentation", "deck", "powerpoint", "communicate progress", "summarize"],
  },
  {
    id: "CLUSTER_WRITING_DOCS",
    label: "Writing and documentation",
    definition: "Professional writing, documentation, briefs, reports, and written communication.",
    example_phrases: ["write", "author", "report", "brief", "documentation", "communications"],
  },
  {
    id: "CLUSTER_CLIENT_FACING",
    label: "Client facing support",
    definition: "Interacting with clients, supporting client needs, or delivering client work.",
    example_phrases: ["client", "client-facing", "customer", "stakeholder management", "service"],
  },

  // Creative + Brand
  {
    id: "CLUSTER_CONTENT_CREATION",
    label: "Content creation",
    definition: "Creating content for social, digital, campaigns, or brand communications.",
    example_phrases: ["content", "social media", "tiktok", "instagram", "campaign", "copywriting"],
  },
  {
    id: "CLUSTER_VISUAL_DESIGN",
    label: "Visual design",
    definition: "Design work across graphics, layout, brand assets, or visual production.",
    example_phrases: [
  "photoshop",
  "illustrator",
  "indesign",
  "figma",
  "adobe creative cloud",
  "graphic design",
  "brand assets",
  "creative assets",
  "visual design",
  "layout",
  "typography"
]
  },

  // Commercial
  {
    id: "CLUSTER_SALES_PROSPECTING",
    label: "Sales and prospecting",
    definition: "Prospecting, selling, outreach, pipeline work, or revenue-driving activity.",
    example_phrases: ["sales", "prospecting", "cold call", "outreach", "pipeline", "lead generation"],
  },
  {
    id: "CLUSTER_CRM_PIPELINE",
    label: "CRM and pipeline management",
    definition: "Using CRM tools and managing pipeline, contacts, or account activity.",
    example_phrases: ["crm", "salesforce", "hubspot", "seismic", "pipeline", "accounts"],
  },

  // Leadership signals
  {
    id: "CLUSTER_LEADERSHIP_OWNERSHIP",
    label: "Leadership and ownership",
    definition: "Leading teams, owning outcomes, managing operations, or running an org/function.",
 example_phrases: [
  "president",
  "executive board",
  "assistant captain",
  "captain",
  "team lead",
  "managed a team",
  "managed",
  "supervised",
  "directed",
  "hired",
  "recruited",
  "oversaw",
  "led a",
  "led an",
  "founded",
  "co-founder",
  "chair"
],
  },
  {
    id: "CLUSTER_BUDGET_OWNERSHIP",
    label: "Budget ownership",
    definition: "Owning budgets, financial stewardship, allocation, or funding decisions.",
    example_phrases: ["budget", "allocated", "funding", "operating budget", "financial stewardship"],
  },
]

export const TAXONOMY_BY_ID: Record<string, ClusterDef> = Object.fromEntries(
  TAXONOMY.map((c) => [c.id, c])
)