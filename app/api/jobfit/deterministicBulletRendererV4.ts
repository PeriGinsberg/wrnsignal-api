import type {
  EvalOutput,
  Decision,
  WhyCode,
  RiskCode,
} from "./signals"

export const RENDERER_V4_STAMP =
  "RENDERER_V4_STAMP__2026_03_20__ADVISOR_GRADE_BULLET_RENDERER__PHASE1_A"

type RenderCaps = { whyMax: number; riskMax: number }
type Group = "proof" | "tools" | "execution" | "other"

type SafeEvidenceContext = {
  matchKey?: string
  matchKind?: string
  matchStrength?: string
}

const TOOL_PATTERN =
  /\b(adobe(?:\s+creative\s+suite)?|photoshop|illustrator|indesign|figma|canva|excel|powerpoint|word|sql|python|r|arcgis|autocad|tableau|google analytics|meta ads|google ads|crm)\b/i

function capsForDecision(d: Decision): RenderCaps {
  if (d === "Priority Apply") return { whyMax: 6, riskMax: 3 }
  if (d === "Apply") return { whyMax: 6, riskMax: 3 }
  if (d === "Review") return { whyMax: 5, riskMax: 4 }
  return { whyMax: 2, riskMax: 4 }
}

function norm(s: unknown): string {
  return String(s ?? "")
    .replace(/Jï¿½s/g, "J's")
    .replace(/J s/g, "J's")
    .replace(/bachelorï¿½s/g, "bachelor's")
    .replace(/ï¿½/g, "'")
    .replace(/â€™/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€/g, '"')
    .replace(/â€“/g, "-")
    .replace(/â€”/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function sentence(s: string): string {
  const t = norm(s)
    .replace(/^[•\-\s]+/, "")
    .replace(/\s*[.;:]+$/, "")
    .trim()

  if (!t) return ""
  return t[0].toUpperCase() + t.slice(1)
}

function usable(s: string): boolean {
  const t = norm(s)
  if (!t) return false
  if (t.length < 18) return false
  if (/^\w+(,\s*\w+){0,3}$/.test(t)) return false
  return true
}

function cleanClause(s: string): string {
  return norm(s)
    .replace(/\.$/, "")
    .replace(/^your experience\s+/i, "")
    .replace(/^experience\s+/i, "")
    .trim()
}

function cleanProfileFact(s: string): string {
  let t = norm(s)
    .replace(/^tools:\s*/i, "")
    .replace(/\s+(including|especially|such as)\s+.*$/i, "")
    .replace(/,\s*$/, "")
    .replace(/\band\s*$/i, "")
    .replace(/\bincluding\s*$/i, "")
    .replace(/\.\s*$/, "")
    .trim()

  if (t.length > 190) {
    t = t.slice(0, 190).replace(/\s+\S*$/, "").trim()
  }

  return t
}

function cleanJobFact(s: string): string {
  let t = norm(s)
    .replace(/^what you[’'`]ll do:?\s*/i, "")
    .replace(/^responsibilities:?\s*/i, "")
    .replace(/^job description:?\s*/i, "")
    .replace(/^preferred:?\s*/i, "")
    .replace(/^required:?\s*/i, "")
    .replace(/^classes or experience in\s+/i, "")
    .replace(/^currently pursuing a bachelor.?s degree.*$/i, "")
    .replace(/^the role reports to.*$/i, "")
    .replace(/^gain foundational understanding of\s+/i, "")
    .replace(/^learn how to apply for.*$/i, "")
    .replace(/\s+(including|especially|such as)\s+.*$/i, "")
    .replace(/\.\s*$/, "")
    .trim()

  if (t.length > 150) {
    t = t.slice(0, 150).replace(/\s+\S*$/, "").trim()
  }

  return t
}

function normalizeWhyJobFact(s: string): string {
  let t = cleanClause(s)
    .replace(/^ideal candidates will have\s+/i, "")
    .replace(/^qualifications include\s+/i, "")
    .replace(/^required[:\s]+/i, "")
    .replace(/^preferred[:\s]+/i, "")
    .replace(/^the role involves\s+/i, "")
    .replace(/^under administrative direction,\s*/i, "")
    .replace(/^responsible for\s+/i, "")
    .replace(/^supporting\s+/i, "")
    .replace(/^what you[’'`]ll do[:\s]+/i, "")
    .replace(/^assist in\s+/i, "")
    .replace(/^assisting with\s+/i, "")
    .replace(/^engagement[:\s]+/i, "")
    .replace(/^essential functions include\s+/i, "")
    .replace(/^conduct\s+/i, "")
    .replace(/^partners with\s+/i, "")
    .replace(/^the legislative affairs team to\s+/i, "")
    .replace(/^as a\s+[^,.;]+(?:,|$)\s*/i, "")
    .replace(/^able to\s+/i, "")
    .replace(/^ability to\s+/i, "")
    .trim()

  if (/prepare reports on consulting services performed for clients$/i.test(t)) {
    return "client reporting and written analysis"
  }

  if (/supply portfolio of past work\/demonstrate skills$/i.test(t)) {
    return "a portfolio that demonstrates visual design range"
  }

  if (/ensuring compliance with state and federal regulations/i.test(t)) {
    return "compliance and analysis work"
  }

  if (/market research/i.test(t) && /growth opportunities/i.test(t)) {
    return "market research and growth strategy support"
  }

  t = t
    .split(/;|\s+\|\s+|,\s+(?=[a-z])/i)[0]
    .replace(/\s+(including|especially|such as)\s+.*$/i, "")
    .trim()

  if (t.length > 140) {
    t = t.slice(0, 140).replace(/\s+\S*$/, "").trim()
  }

  return t
}

function capabilityPhrase(jobFact: string): string {
  const t = cleanJobFact(jobFact)
  if (!t) return ""
if (/hands-on involvement with practices and games|practices and games|game day/i.test(t)) {
  return "hands-on game-day and event execution"
}
if (/players, parents, and coaches|superior customer service|i9 sports experience/i.test(t)) {
  return "guest experience and relationship-building"
}
if (/observing, assessing, and assisting our coaches|empower volunteer coaches|sportsmanship values/i.test(t)) {
  return "coaching support and fundamentals instruction"
}
if (/field sales calls for assigned accounts and assigned territory/i.test(t)) {
  return "territory-based field sales execution"
}
if (/clinical sales associate|drive .* utilization/i.test(t)) {
  return "clinical sales execution and utilization support"
}
  if (/collaborating with .* drive .*utilization/i.test(t)) {
    return "collaborating with the clinical sales team to drive utilization"
  }
  if (/regional sales and marketing events|system awareness|procedure adoption/i.test(t)) {
    return "supporting regional awareness and procedure adoption efforts"
  }
  if (/prepare reports on consulting services performed for clients|client reporting/i.test(t)) {
    return "client reporting and written analysis"
  }
  if (/benchmarking research|it spending|research and analysis/i.test(t)) {
    return "benchmarking research and analysis"
  }
  if (/portfolio|past work|demonstrate skills/i.test(t)) {
    return "a portfolio that demonstrates visual design range"
  }
  if (/adobe|figma|canva|illustrator|indesign|photoshop/i.test(t)) {
    return "design tool fluency"
  }
  if (/cross-functional|execute cross-functionally/i.test(t)) {
    return "cross-functional execution"
  }
  if (/market research|growth strategy/i.test(t)) {
    return "market research and growth strategy support"
  }
  if (/social media|content creation/i.test(t)) {
    return "social media and content development"
  }
  if (/campaign performance|optimization|scale/i.test(t)) {
    return "campaign analysis and performance optimization"
  }
  if (/forecasting|scenario planning|kpis|financial goals/i.test(t)) {
    return "forecasting and scenario planning"
  }
  if (/compliance|state and federal regulations/i.test(t)) {
    return "compliance and analysis work"
  }
  if (/process evaluation and design|design and document processes|process design documentation/i.test(t)) {
    return "process evaluation and design"
  }
  if (/policy analysis|planning and administering/i.test(t)) {
    return "policy analysis and program support"
  }
  if (/reporting/i.test(t)) {
    return "reporting and analytics support"
  }
  if (/research$/i.test(t)) {
    return "research"
  }

  const clipped = t.split(/;|\s+\|\s+|,\s+(?=[a-z])/i)[0].trim()
  return clipped.length > 140
    ? clipped.slice(0, 140).replace(/\s+\S*$/, "").trim()
    : clipped
}

function summarizeJobFact(jobFact: string, matchKey?: string): string {
  const k = String(matchKey || "").toLowerCase()
  const phrase = capabilityPhrase(jobFact)
if (k === "event_operations_live_execution") return "hands-on game-day and event execution"
if (k === "customer_service_guest_experience") return "guest experience and fan-facing service"
if (k === "coaching_instruction_facilitation") return "coaching, instruction, and fundamentals-based support"
  if (k === "strategy_problem_solving") return "the strategic problem-solving side of this role"
  if (k === "consumer_research") return "the research and benchmarking work in this role"
  if (k === "analysis_reporting") return "the analytical work this role requires"
  if (k === "drafting_documentation") return "client-ready presentation and documentation"
  if (k === "stakeholder_coordination") return "cross-functional coordination"
  if (k === "operations_execution") return "day-to-day execution in a fast-moving environment"
  if (k === "content_execution") return "content and campaign execution"
  if (k === "brand_messaging") return "brand and campaign work"
  if (k === "policy_regulatory_research") return "the legal and compliance-oriented part of the role"
  if (k === "visual_communication") return "visual design execution"
  if (k === "communications_writing") return "written communication work"
  if (k === "financial_analysis") return "the financial and analytical side of the role"

  if (phrase) return phrase
  return "this part of the role"
}

function isBadBulletProfileFact(s: string): boolean {
  const t = String(s || "").toLowerCase()
  if (!t) return true
  if (t.includes("paste_profile_text_here")) return true
  if (t.includes("secondary or adjacent roles you would consider")) return true
  if (t.includes("are there any roles or industries")) return true
  if (t.includes("what do you believe are your strongest skills")) return true
  if (t.includes("the idea of rotating through departments")) return true
  if (t.includes("currently pursuing a bachelor")) return true
  if (t.includes("target roles:")) return true
  if (t.includes("since beginning law school")) return true
  if (t.endsWith(",")) return true
  if (t.endsWith("and")) return true
  if (t.endsWith("including")) return true
  return false
}

function isBadBulletJobFact(s: string): boolean {
  const t = String(s || "").toLowerCase()
  if (!t) return true
  if (t.includes("learn how to apply for")) return true
  if (t.includes("currently pursuing a bachelor")) return true
  if (t.includes("degree at a u.s.-based college")) return true
  if (t.includes("participate in the matthews")) return true
  if (t.includes("gain foundational understanding")) return true
  if (t.includes("needs to be able to work on-site")) return true
  if (t.includes("the role reports to")) return true
  if (t.includes("any appropriate combination of relevant education")) return true
  if (t.startsWith("ï¿½")) return true
  return false
}

function whyGroup(w: WhyCode): string {
  if (w.code === "WHY_TOOL_PROOF") return "tools"
  if (w.code === "WHY_EXECUTION_PROOF") return "execution"

  const key = String(w.match_key || "").toLowerCase()
  const kind = String(w.match_kind || "").toLowerCase()

  if (/strategy|problem_solving/.test(key)) return "proof_strategy"
  if (/consumer_research|research/.test(key)) return "proof_research"
  if (/financial_analysis/.test(key)) return "proof_financial"
  if (/analysis_reporting/.test(key)) return "proof_analytics"
  if (/drafting_documentation|communications_writing/.test(key)) return "proof_written"
  if (/client_commercial_work|stakeholder_coordination/.test(key)) return "proof_client"

  if (kind === "tool") return "tools"
  if (kind === "execution") return "execution"
  if (kind === "deliverable") return "proof_written"
  if (kind === "stakeholder") return "proof_client"
  if (kind === "function") return `proof_function_${key || "generic"}`

  return "proof"
}

function riskGroup(code: string): Group {
  if (code === "RISK_MISSING_TOOLS") return "tools"
  if (code === "RISK_GRAD_WINDOW" || code === "RISK_MBA" || code === "RISK_GOVERNMENT") return "proof"
  if (code === "RISK_LOCATION" || code === "RISK_CONTRACT" || code === "RISK_HOURLY") return "execution"
  return "other"
}

function whyPriority(w: WhyCode): number {
  const base =
    w.code === "WHY_DIRECT_EXPERIENCE_PROOF" ? 100 :
    w.code === "WHY_EXECUTION_PROOF" ? 88 :
    w.code === "WHY_ADJACENT_EXPERIENCE_PROOF" ? 80 :
    w.code === "WHY_TOOL_PROOF" ? 68 :
    40

  const strength =
    w.match_strength === "direct" ? 8 :
    w.match_strength === "adjacent" ? 4 :
    0

  const weight = typeof w.weight === "number" ? w.weight : 0
  return base + strength + Math.min(20, Math.floor(weight / 10))
}

function riskPriority(code: string, r: RiskCode): number {
  const sevWeight =
    r.severity === "high" ? 100 :
    r.severity === "medium" ? 60 :
    30
  const toolPenalty = code === "RISK_MISSING_TOOLS" && r.severity !== "high" ? -20 : 0
  return sevWeight + toolPenalty
}

function extractTools(profileFact: string): string[] {
  const raw = cleanProfileFact(profileFact)
    .replace(/^tools:\s*/i, "")
    .split(/,|\/|\band\b/i)
    .map((x) => norm(x))
    .filter(Boolean)

  const cleaned: string[] = []
  for (const item of raw) {
    if (!TOOL_PATTERN.test(item)) continue
    const normalized = item
      .replace(/^adobe\s+creative\s+suite$/i, "Adobe Creative Suite")
      .replace(/^figma$/i, "Figma")
      .replace(/^canva$/i, "Canva")
      .replace(/^illustrator$/i, "Illustrator")
      .replace(/^indesign$/i, "InDesign")
      .replace(/^photoshop$/i, "Photoshop")
      .replace(/^excel$/i, "Excel")
      .replace(/^word$/i, "Word")
      .replace(/^powerpoint$/i, "PowerPoint")
      .replace(/^sql$/i, "SQL")
      .replace(/^python$/i, "Python")
      .replace(/^arcgis$/i, "ArcGIS")
      .replace(/^autocad$/i, "AutoCAD")
      .replace(/^crm$/i, "CRM")
      .replace(/^adobe$/i, "Adobe")

    if (!cleaned.includes(normalized)) cleaned.push(normalized)
  }
  return cleaned
}

function safeProfileLead(profileFact: string): string {
  const pf = cleanProfileFact(profileFact)
  if (!pf) return ""

  const clipped = pf.length > 160
    ? pf.slice(0, 160).replace(/\s+\S*$/, "").trim()
    : pf

  return sentence(clipped)
}

function summarizeProfileFact(profileFact: string, matchKey?: string): string {
  const p = cleanProfileFact(profileFact)
  const k = String(matchKey || "").toLowerCase()

  if (!p) return ""

  if (k === "strategy_problem_solving") {
    return "You've already done real strategy and diligence work, where you had to break down information and make sense of it"
  }
  if (k === "consumer_research") {
    return "You've already done real research and diligence work, not just surface-level information gathering"
  }
  if (k === "analysis_reporting") {
    return "You've already done analytical work where you had to turn information into usable conclusions"
  }
  if (k === "drafting_documentation") {
    return "You've already produced written and presentation-ready work that had to communicate ideas clearly"
  }
  if (k === "content_execution") {
    return "You already have hands-on content and campaign execution experience"
  }
  if (k === "brand_messaging") {
    return "You already have direct exposure to brand and messaging work"
  }
  if (k === "stakeholder_coordination") {
    return "You've already worked across people and priorities to move projects forward"
  }
  if (k === "operations_execution") {
    return "You've already shown you can execute in a structured environment with real ownership"
  }
  if (k === "policy_regulatory_research") {
    return "You already have experience working with legal and compliance-oriented material"
  }
  if (k === "visual_communication") {
    return "You've already created visual work that had to support a broader brand or campaign objective"
  }
  if (k === "communications_writing") {
    return "You've already done writing and communication work that required clarity and judgment"
  }
  if (k === "financial_analysis") {
    return "You've already done financial analysis work that required structure and judgment"
  }

  return sentence(p)
}

function interpretDirectProof(profileFact: string, jobFact: string, matchKey?: string): string {
  const literal = summarizeProfileFact(profileFact, matchKey)
  if (!literal) return ""

  const summary = summarizeJobFact("", matchKey || "") || capabilityPhrase(jobFact) || "this part of the role"

  return sentence(
    `${literal}. That maps directly to ${summary}, and gives you a concrete example you can speak to in an interview.`
  )
}

function interpretAdjacentProof(
  profileFact: string,
  jobFact: string,
  ctx?: SafeEvidenceContext
): string {
  const literal = summarizeProfileFact(profileFact, ctx?.matchKey)
  if (!literal) return ""

  const summary =
    summarizeJobFact("", ctx?.matchKey || "") ||
    capabilityPhrase(jobFact) ||
    "this part of the role"

  return sentence(
    `${literal}. It is not a perfect match, but it transfers credibly into ${summary}, especially if you explain the overlap clearly.`
  )
}

function buildInterestAlignmentClause(profileSignals?: any, jobSignals?: any): string | null {
  const roles: string[] = profileSignals?.statedInterests?.targetRoles || []
  const industries: string[] = profileSignals?.statedInterests?.targetIndustries || []

  const jobText = norm(jobSignals?.job_text || "")
  const jobFamily = norm(jobSignals?.jobFamily || jobSignals?.job_family || "")
  const roleText = roles.map((r) => norm(r).toLowerCase()).join(" | ")

  const hasAny = (phrases: string[]) => phrases.some((p) => jobText.toLowerCase().includes(p))
  const familyIs = (x: string) => jobFamily.toLowerCase() === norm(x).toLowerCase()

  if (
    hasAny(["policy analyst", "regulatory affairs", "legislative assistant", "government affairs", "compliance analyst"]) ||
    (hasAny(["policy", "regulatory", "legislative", "compliance", "government affairs"]) && (familyIs("Government") || familyIs("Other"))) ||
    /\b(policy|regulatory|legislative|compliance)\b/.test(roleText)
  ) {
    return sentence("This position aligns with your stated interest in policy and regulatory work.")
  }

  if (
    hasAny(["process improvement", "process transformation", "business operations", "operations strategy", "post-merger integration", "internal consulting"]) ||
    (hasAny(["operations", "process", "business analyst"]) && (familyIs("Consulting") || familyIs("Other"))) ||
    /\b(operations|process|business analyst|internal consulting|post-merger integration)\b/.test(roleText)
  ) {
    return sentence("This position aligns with your stated interest in operations and process-oriented work.")
  }

  if (
    hasAny(["product marketing", "brand marketing", "digital marketing", "brand management", "creative marketing"]) ||
    (hasAny(["marketing", "brand", "product marketing", "digital marketing"]) && familyIs("Marketing")) ||
    /\b(product marketing|brand management|digital marketing|creative marketing|marketing)\b/.test(roleText)
  ) {
    return sentence("This position aligns with your stated interest in marketing work.")
  }

  if (
    /\b(finance|investment|wealth management|asset management)\b/.test(roleText) ||
    (hasAny(["finance", "investment", "wealth management", "asset management", "client associate"]) && /\b(finance|investment|wealth management|asset management)\b/.test(roleText))
  ) {
    return sentence("This position aligns with your stated interest in finance work.")
  }

  const industryMatch = industries.find((i) => {
    const t = norm(i)
    return t && jobText.toLowerCase().includes(t.toLowerCase())
  })

  if (industryMatch) {
    return sentence(`This position aligns with your stated interest in the ${industryMatch} industry.`)
  }

  return null
}

function renderWhyBullet(
  w: WhyCode,
  profileSignals?: EvalOutput["profile_signals"],
  jobSignals?: EvalOutput["job_signals"]
): string | null {
  const jobFact = normalizeWhyJobFact(w.job_fact || "")
  let profileFact = cleanProfileFact(w.profile_fact || "")

  profileFact = profileFact
    .split(/;|\s+\|\s+/)[0]
    .replace(/\s+(including|especially|such as)\s+.*$/i, "")
    .trim()

  if (profileFact.length > 180) {
    profileFact = profileFact.slice(0, 180).replace(/\s+\S*$/, "").trim()
  }

  if (isBadBulletJobFact(jobFact)) return null
  if (isBadBulletProfileFact(profileFact)) return null
  if (!profileFact) return null

  if (w.code === "WHY_DIRECT_EXPERIENCE_PROOF") {
    return interpretDirectProof(profileFact, jobFact, w.match_key)
  }

  if (!usable(profileFact)) return null

  if (w.code === "WHY_ADJACENT_EXPERIENCE_PROOF") {
    return interpretAdjacentProof(profileFact, jobFact, {
      matchKey: w.match_key,
      matchKind: w.match_kind,
      matchStrength: w.match_strength,
    })
  }

  if (w.code === "WHY_EXECUTION_PROOF") {
    const lead = summarizeProfileFact(profileFact, w.match_key)
    const summary = summarizeJobFact(jobFact, w.match_key)
    if (!lead) return null
    return sentence(
      `${lead}. That matters here because this role depends on ${summary}, and you already have evidence that you can execute rather than just talk about it.`
    )
  }

  if (w.code === "WHY_TOOL_PROOF") {
    const tools = extractTools(profileFact)
    if (tools.length > 0) {
      const list = tools.length > 3
        ? `${tools.slice(0, 2).join(", ")}, and ${tools[tools.length - 1]}`
        : tools.join(", ").replace(/, ([^,]*)$/, ", and $1")
      return sentence(
        `${list} gives you relevant tool proof for this work, which helps you sound more credible when the conversation gets specific.`
      )
    }

    const lead = safeProfileLead(profileFact)
    const jf = summarizeJobFact(jobFact, w.match_key)
    if (!lead) return null
    return sentence(`${lead}. That gives you relevant tool-related proof for ${jf}.`)
  }

  const lead = safeProfileLead(profileFact)
  const jf = summarizeJobFact(jobFact, w.match_key)
  if (!lead) return null
  return sentence(`${lead}. That supports the kind of work this role expects, especially around ${jf}.`)
}

function isSoftSkillRisk(jf: string): boolean {
  const t = (jf || "").toLowerCase()
  return (
    t.includes("strategy") ||
    t.includes("problem-solving") ||
    t.includes("problem solving") ||
    t.includes("judgment") ||
    t.includes("stakeholder") ||
    t.includes("leadership") ||
    t.includes("collaboration") ||
    t.includes("cross-functional")
  )
}

function renderMissingToolRisk(jobFact: string): string {
  const t = String(jobFact || "").toLowerCase()

  const missing: string[] = []
  if (t.includes("excel")) missing.push("Excel")
  if (t.includes("word")) missing.push("Word")
  if (t.includes("powerpoint")) missing.push("PowerPoint")
  if (t.includes("crm")) missing.push("CRM")

  if (missing.length === 0) {
    return "The posting calls for tools you have not clearly shown in your profile yet."
  }
  if (missing.length === 1) {
    return `The posting calls for ${missing[0]}, and your profile does not clearly show it yet.`
  }

  const last = missing[missing.length - 1]
  const first = missing.slice(0, -1).join(", ")
  return `The posting calls for ${first} and ${last}, and your profile does not clearly show them yet.`
}

function renderRiskBullet(r: RiskCode): string | null {
  const code = norm(r.code)
  const riskText = sentence(r.risk || "")
  const jf = summarizeJobFact(r.job_fact || "", "")
  const jobFact = String(r?.job_fact || "")

  if (code === "RISK_ANALYTICS_HEAVY") {
    return sentence("This role appears more analytics-heavy than your stated preferences suggest, so you would need a strong reason for why it still fits.")
  }

  if (code === "RISK_CONTRACT") {
    return sentence("This role appears to be contract-based, which does not align with your preference for full-time roles.")
  }

  if (code === "RISK_LOCATION") {
    const jobLoc = String(r.job_fact || "").trim()
    const prefLoc = String(r.profile_fact || "").trim()

    const jobCity = jobLoc
      .replace(/^Job location indicates\s+/i, "")
      .replace(/\.$/, "")
      .trim()

    const preferredCities = prefLoc
      .replace(/^Preferred cities are\s+/i, "")
      .replace(/^Allowed cities are\s+/i, "")
      .replace(/\.$/, "")
      .trim()

    if (jobCity && preferredCities) {
      return sentence(`This role is located in ${jobCity}, which is outside your stated preferred cities of ${preferredCities}. If you are not open to relocating, that could become a real constraint later in the process.`)
    }

    if (jobCity) {
      return sentence(`This role is located in ${jobCity}, which is a practical consideration worth thinking through early.`)
    }

    return sentence("The job location does not clearly line up with your stated preferred cities.")
  }

  if (code === "RISK_SALES") {
    return sentence("This role has clear sales expectations that conflict with the constraints stated in your profile.")
  }

  if (code === "RISK_MISSING_PROOF") {
    if (isSoftSkillRisk(jf)) {
      if (/strategy|problem-solving|problem solving/i.test(jf)) {
        return sentence("Your background is relevant, but the resume does not yet make your strongest strategy and problem-solving proof especially explicit. You may need to connect those dots yourself in interviews.")
      }
      if (/client|stakeholder|communication|presentation|collaboration/i.test(jf)) {
        return sentence("Your background is relevant, but the resume does not yet make your strongest client-facing and communication proof especially explicit. That is a gap you would need to explain clearly in interviews.")
      }
      return sentence("Your background is relevant, but the resume does not yet make the most role-specific proof especially explicit.")
    }

    if (/clinical|patient|surgical|operating room|surgeon/i.test(jf)) {
      return sentence("This role leans heavily on direct clinical credibility, and your background does not yet show the strongest hands-on proof in that environment. You may need to work harder in interviews to prove you understand how that setting operates.")
    }

    if (/research|analysis|analytics|reporting/i.test(jf)) {
      return sentence("Your background shows analytical preparation, but more direct proof of client-ready research and reporting would make this case stronger.")
    }

    if (/policy|legislative|compliance|legal/i.test(jf)) {
      return sentence("This role rewards more direct policy, legal, or compliance experience than is currently visible in your background.")
    }

    if (/forecasting|scenario planning|financial/i.test(jf)) {
      return sentence("This role expects stronger direct proof in forecasting and planning work than your background currently shows.")
    }

    if (/content|social media|creative/i.test(jf)) {
      return sentence("This role requires clearer proof of day-to-day content execution than is currently visible in your background.")
    }

    return sentence(`This role emphasizes ${jf}, and your background does not yet show clear direct proof in that area.`)
  }

  if (code === "RISK_MISSING_TOOLS") {
    return sentence(renderMissingToolRisk(jobFact))
  }

  if (usable(riskText)) {
    return riskText
  }

  return null
}

export function renderBulletsV4(out: EvalOutput): {
  why: string[]
  risk: string[]
  renderer_debug: any
} {
  const { whyMax, riskMax } = capsForDecision(out.decision)

  const whyCodesIn = Array.isArray(out.why_codes) ? out.why_codes.slice() : []
  const riskCodesIn = Array.isArray(out.risk_codes) ? out.risk_codes.slice() : []

  whyCodesIn.sort((a, b) => whyPriority(b) - whyPriority(a))
  riskCodesIn.sort((a, b) => riskPriority(b.code, b) - riskPriority(a.code, a))

  const why: string[] = []
  const risk: string[] = []

  const usedWhyGroups = new Set<string>()
  const usedWhyKeys = new Set<string>()
  const usedRiskGroups = new Set<Group>()
  const usedWhyRendered = new Set<string>()
  const usedWhyJobFacts = new Set<string>()
  const usedProfileFacts = new Set<string>()
  const usedRiskRendered = new Set<string>()
  const usedRiskJobFacts = new Set<string>()
  const usedRiskProfileFacts = new Set<string>()

  const deferredWhy: Array<{
    rendered: string
    renderedKey: string
    normalizedWhyJobFactKey: string
    profileFactKey: string
    matchKey: string
    group: string
  }> = []

  const interestAlign = buildInterestAlignmentClause(out.profile_signals, out.job_signals)
  if (interestAlign && whyMax > 0) why.push(interestAlign)

  if (whyMax > 0) {
    for (const w of whyCodesIn) {
      if (why.length >= whyMax) break

      const group = String(whyGroup(w))
      const matchKey = norm(w.match_key || "")
      const rendered = renderWhyBullet(w, out.profile_signals, out.job_signals)
      const renderedKey = norm(rendered || "")
      const normalizedWhyJobFactKey = norm(normalizeWhyJobFact(w.job_fact || "")).slice(0, 180)
      const profileFactKey = norm(cleanProfileFact(w.profile_fact || "")).slice(0, 180)

      if (!rendered) continue
      if (renderedKey && usedWhyRendered.has(renderedKey)) continue

      const isDuplicateTools = group === "tools" && usedWhyGroups.has("tools")
      const isDuplicateExecution =
        group === "execution" &&
        Array.from(usedWhyGroups).filter((g) => g === "execution").length >= 2
      const isDuplicateProofGroup = group.startsWith("proof_") && usedWhyGroups.has(group)

      const isHardDuplicate =
        (normalizedWhyJobFactKey && usedWhyJobFacts.has(normalizedWhyJobFactKey)) ||
        (profileFactKey && usedProfileFacts.has(profileFactKey)) ||
        (matchKey && usedWhyKeys.has(matchKey))

      if (isDuplicateTools || isDuplicateExecution || isDuplicateProofGroup || isHardDuplicate) {
        deferredWhy.push({
          rendered,
          renderedKey,
          normalizedWhyJobFactKey,
          profileFactKey,
          matchKey,
          group,
        })
        continue
      }

      why.push(rendered)
      if (renderedKey) usedWhyRendered.add(renderedKey)
      if (normalizedWhyJobFactKey) usedWhyJobFacts.add(normalizedWhyJobFactKey)
      if (profileFactKey) usedProfileFacts.add(profileFactKey)
      if (matchKey) usedWhyKeys.add(matchKey)
      usedWhyGroups.add(group)
    }
  }

  const whyMin =
    out.decision === "Priority Apply" || out.decision === "Apply" ? 3 : 1

  if (why.length < whyMin) {
    for (const item of deferredWhy) {
      if (why.length >= whyMax) break
      if (why.length >= whyMin) break
      if (item.renderedKey && usedWhyRendered.has(item.renderedKey)) continue
      if (item.normalizedWhyJobFactKey && usedWhyJobFacts.has(item.normalizedWhyJobFactKey)) continue
      if (item.profileFactKey && usedProfileFacts.has(item.profileFactKey)) continue
      if (item.matchKey && usedWhyKeys.has(item.matchKey)) continue

      why.push(item.rendered)
      if (item.renderedKey) usedWhyRendered.add(item.renderedKey)
      if (item.normalizedWhyJobFactKey) usedWhyJobFacts.add(item.normalizedWhyJobFactKey)
      if (item.profileFactKey) usedProfileFacts.add(item.profileFactKey)
      if (item.matchKey) usedWhyKeys.add(item.matchKey)
      usedWhyGroups.add(item.group)
    }
  }

  const requiredWhyCount =
    out.decision === "Priority Apply" ? 3 :
    out.decision === "Apply" ? 3 :
    out.decision === "Review" ? 2 :
    1

  if (why.length < requiredWhyCount) {
    for (const item of deferredWhy) {
      if (why.length >= whyMax) break
      if (why.length >= requiredWhyCount) break
      if (item.renderedKey && usedWhyRendered.has(item.renderedKey)) continue

      why.push(item.rendered)
      if (item.renderedKey) usedWhyRendered.add(item.renderedKey)
      if (item.normalizedWhyJobFactKey) usedWhyJobFacts.add(item.normalizedWhyJobFactKey)
      if (item.profileFactKey) usedProfileFacts.add(item.profileFactKey)
      if (item.matchKey) usedWhyKeys.add(item.matchKey)
      usedWhyGroups.add(item.group)
    }
  }

  if (riskMax > 0) {
    for (const r of riskCodesIn) {
      if (risk.length >= riskMax) break

      const group = riskGroup(r.code)
      const rendered = renderRiskBullet(r)
      const renderedKey = norm(rendered || "")
      const jobFactKey = norm(capabilityPhrase(r.job_fact || "")).slice(0, 180)
      const profileFactKey = norm(cleanProfileFact(r.profile_fact || "")).slice(0, 180)

      if (usedRiskGroups.has(group) && group !== "other") continue
      if (r.code === "RISK_MISSING_TOOLS" && risk.length >= 2 && r.severity !== "high") continue
      if (!rendered || !usable(rendered)) continue
      if (renderedKey && usedRiskRendered.has(renderedKey)) continue
      if (jobFactKey && usedRiskJobFacts.has(jobFactKey)) continue
      if (profileFactKey && usedRiskProfileFacts.has(profileFactKey)) continue

      risk.push(rendered)
      if (renderedKey) usedRiskRendered.add(renderedKey)
      if (jobFactKey) usedRiskJobFacts.add(jobFactKey)
      if (profileFactKey) usedRiskProfileFacts.add(profileFactKey)
      usedRiskGroups.add(group)
    }
  }

  return {
    why,
    risk,
    renderer_debug: {
      renderer_stamp: RENDERER_V4_STAMP,
      decision: out.decision,
      why_codes_in: whyCodesIn.map((x) => ({
        code: x.code,
        match_key: x.match_key,
        match_kind: x.match_kind,
        match_strength: x.match_strength,
        weight: x.weight ?? null,
      })),
      risk_codes_in: riskCodesIn.map((x) => ({
        code: x.code,
        severity: x.severity,
      })),
      why_count: why.length,
      risk_count: risk.length,
    },
  }
}
