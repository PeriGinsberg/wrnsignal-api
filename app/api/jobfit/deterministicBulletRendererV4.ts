import type {
  EvalOutput,
  Decision,
  WhyCode,
  RiskCode,
} from "./signals"

export const RENDERER_V4_STAMP =
  "RENDERER_V4_STAMP__2026_03_09__PREMIUM_EVIDENCE_RENDERER__A"

type RenderCaps = { whyMax: number; riskMax: number }
type Group = "proof" | "tools" | "execution" | "other"

const TOOL_PATTERN =
  /\b(adobe(?:\s+creative\s+suite)?|photoshop|illustrator|indesign|figma|canva|excel|powerpoint|sql|python|r|arcgis|autocad|tableau|google analytics|meta ads|google ads)\b/i

function capsForDecision(d: Decision): RenderCaps {
  if (d === "Priority Apply") return { whyMax: 6, riskMax: 3 }
  if (d === "Apply") return { whyMax: 6, riskMax: 3 }
  if (d === "Review") return { whyMax: 5, riskMax: 4 }
  return { whyMax: 0, riskMax: 4 }
}

function whyGroup(w: WhyCode): Group {
  if (w.code === "WHY_TOOL_PROOF") return "tools"
  if (w.code === "WHY_EXECUTION_PROOF") return "execution"
  return "proof"
}

function riskGroup(code: string): Group {
  if (code === "RISK_MISSING_TOOLS") return "tools"

  if (
    code === "RISK_GRAD_WINDOW" ||
    code === "RISK_MBA" ||
    code === "RISK_GOVERNMENT"
  ) {
    return "proof"
  }

  if (
    code === "RISK_LOCATION" ||
    code === "RISK_CONTRACT" ||
    code === "RISK_HOURLY"
  ) {
    return "execution"
  }

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

function norm(s: unknown): string {
  return String(s ?? "")
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

function stripLeadingVerbNoise(s: string): string {
  return norm(s)
    .replace(/^supports\s+/i, "")
    .replace(/^supporting\s+/i, "")
    .replace(/^as a\s+/i, "")
    .replace(/^as an\s+/i, "")
    .replace(/^is adjacent evidence that can transfer into\s+/i, "")
    .replace(/^gives you adjacent experience that should translate well to\s+/i, "")
    .replace(/^provides practical experience that supports\s+/i, "")
    .replace(/^tools:\s*/i, "")
    .trim()
}

function cleanProfileFact(s: string): string {
  let t = stripLeadingVerbNoise(cleanClause(s))

  t = t
    .replace(/^TOOLS:\s*/i, "")
    .replace(/^what you.?ll do:?/i, "")
    .replace(/^responsibilities:?/i, "")
    .replace(/^job description:?/i, "")
    .replace(/^able to\s+/i, "")
    .replace(/^ability to\s+/i, "")
    .replace(/^proficiency (?:and creativity )?in\s+/i, "")
    .replace(/\s+(including|especially|such as)\s+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()

  return t
}

function cleanJobFact(s: string): string {
  let t = norm(s)

  if (!t) return ""

  t = t
    .replace(/what\s+you.?ll\s+do:?/gi, "")
    .replace(/responsibilities:?/gi, "")
    .replace(/job description:?/gi, "")
    .replace(/primary function of position:?/gi, "")
    .replace(/you will:?/gi, "")
    .replace(/^as\s+[^,.;]+(?:,|$)\s*/i, "")
    .replace(/^be\s+/i, "")
    .replace(/^responsible for\s+/i, "")
    .replace(/^supporting with\s+/i, "supporting ")
    .replace(/^able to\s+/i, "")
    .replace(/^ability to\s+/i, "")
    .replace(/^proficiency (?:and creativity )?in\s+/i, "")
    .replace(/^work with\s+/i, "collaborating with ")
    .replace(/^support\s+/i, "supporting ")
    .replace(/^assist\s+/i, "assisting ")
    .replace(/^help\s+/i, "helping ")
    .replace(/^manage\s+/i, "managing ")
    .replace(/^develop\s+/i, "developing ")
    .replace(/^analyze\s+/i, "analyzing ")
    .replace(/^conduct\s+/i, "conducting ")
    .replace(/^execute\s+/i, "executing ")
    .replace(/^perform\s+/i, "performing ")
    .replace(/^prepare\s+/i, "preparing ")
    .replace(/^contribute to\s+/i, "contributing to ")
    .replace(/^plan and administer\s+/i, "planning and administering ")
    .replace(/\s+(including|especially|such as)\s+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()

  return t
}

function capabilityPhrase(jobFact: string): string {
  const t = cleanJobFact(jobFact)
  if (!t) return ""

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

  const clipped = t
    .split(/;|\s+\|\s+|,\s+(?=[a-z])/i)[0]
    .trim()

  return clipped.length > 140
    ? clipped.slice(0, 140).replace(/\s+\S*$/, "").trim()
    : clipped
}

function capitalizeClause(s: string): string {
  const t = norm(s)
  if (!t) return ""
  return t[0].toUpperCase() + t.slice(1)
}

function isToolFact(s: string): boolean {
  const t = cleanProfileFact(s)
  if (!t) return false

  const stripped = t
    .replace(/^your fluency with\s+/i, "")
    .replace(/^tools:\s*/i, "")
    .trim()

  const looksLikeList = /,/.test(stripped) && !/[.!?]/.test(stripped)
  const toolHits = stripped.match(new RegExp(TOOL_PATTERN.source, "gi")) || []

  return toolHits.length >= 2 || (toolHits.length >= 1 && looksLikeList)
}

function extractTools(profileFact: string): string[] {
  const raw = cleanProfileFact(profileFact)
    .replace(/^tools:\s*/i, "")
    .split(/,|\/|\band\b/)
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
      .replace(/^powerpoint$/i, "PowerPoint")
      .replace(/^sql$/i, "SQL")
      .replace(/^python$/i, "Python")
      .replace(/^arcgis$/i, "ArcGIS")
      .replace(/^autocad$/i, "AutoCAD")
.replace(/^adobe$/i, "Adobe")
.replace(/^adobe creative suite$/i, "Adobe Creative Suite")

    if (!cleaned.includes(normalized)) cleaned.push(normalized)
  }

  return cleaned
}

function extractEvidenceSource(profileFact: string): string {
  const pf = profileFact || ""

  const atMatch = pf.match(/\bat\s+([A-Z][A-Za-z0-9&.\-\s]{2,})/)
  if (atMatch) return `at ${atMatch[1].trim()}`

  const withMatch = pf.match(/\bwith\s+([A-Z][A-Za-z0-9&.\-\s]{2,})/)
  if (withMatch) return `with ${withMatch[1].trim()}`

  if (/capstone/i.test(pf)) return "in a capstone project"
  if (/research project/i.test(pf)) return "in a research project"
  if (/university/i.test(pf)) return "in an academic project"

  return ""
}

function evidenceLead(profileFact: string): string {
  const pf = cleanProfileFact(profileFact)
  const src = extractEvidenceSource(profileFact)

  if (!pf) return ""

  if (/emt experience|emergency medical technician|special events emt/i.test(pf)) {
    return src ? `Your EMT experience ${src}` : "Your EMT experience"
  }

  if (/physicians|medical teams|operating room|orthopedic surgical|patient consultations|medical equipment|hospital settings|physical therapy intern/i.test(pf)) {
    return "Your clinical exposure"
  }

  if (/pipeline|cold calls|outbound|prospects|accounts|sales presentations|client communication|outreach|b2b sales/i.test(pf)) {
    return src ? `Your high-volume B2B sales experience ${src}` : "Your high-volume B2B sales experience"
  }

  if (/influencer|consumer behavior|advertising strategy/i.test(pf)) {
    return src ? `Your consumer behavior research ${src}` : "Your consumer behavior research"
  }

if (/campaign|digital marketing|growth marketing|paid media/i.test(pf)) {
  return "Your marketing campaign execution experience"
}

  if (/market research|policy research|analytics|data|financial analysis|quantitative analysis|written report|benchmark/i.test(pf)) {
    return "Your research and analytical experience"
  }

  if (/cross-functional|coordinating|stakeholder|teams|leadership/i.test(pf)) {
    return "Your cross-functional execution experience"
  }

  if (/designed end-to-end brand identity|visual systems/i.test(pf)) {
    return "Your portfolio-level design work"
  }

  if (/produced pitch decks|trade show booths|banners|print collateral/i.test(pf)) {
    return "Your experience producing real-world brand and marketing assets"
  }

  if (/communications audit|communications|marketing/i.test(pf)) {
    return "Your marketing and communications experience"
  }

  if (/conducting financial analysis/i.test(pf)) {
    return "Your financial analysis background"
  }

  if (/conducting quantitative analysis|detailed written report/i.test(pf)) {
    return "Your quantitative project work, including written analytical reporting"
  }

  return capitalizeClause(pf)
}

function interpretDirectProof(profileFact: string, jobFact: string): string {
  const lead = evidenceLead(profileFact)
  const jf = capabilityPhrase(jobFact)

  if (!lead) return ""
  if (!jf) return sentence(lead)

  if (lead.toLowerCase().includes(jf.toLowerCase())) {
    return sentence(`${lead} is directly relevant to this role.`)
  }

  if (/EMT experience|clinical exposure/i.test(lead)) {
    return sentence(`${lead} gives you credible clinical context for ${jf}.`)
  }

  if (/B2B sales experience/i.test(lead)) {
    return sentence(`${lead} shows you can operate in a real commercial environment, which matters for ${jf}.`)
  }

  if (/research and analytical experience/i.test(lead)) {
    return sentence(`${lead} maps well to the structured analytical work this role depends on.`)
  }

  if (/portfolio-level design work/i.test(lead)) {
    return sentence(`${lead} shows the kind of execution discipline this team expects from a designer who can contribute immediately.`)
  }

  if (/financial analysis background/i.test(lead)) {
    return sentence(`${lead} gives you relevant proof of ${jf} in business decision contexts.`)
  }

  if (/quantitative project work/i.test(lead)) {
    return sentence(`${lead} supports the client-ready research and reporting demands of this role.`)
  }

  if (/marketing and communications experience/i.test(lead)) {
    return sentence(`${lead} gives you relevant proof of ${jf} in a client-facing project environment.`)
  }

  if (/cross-functional execution experience/i.test(lead)) {
    return sentence(`${lead} shows execution strength that supports ${jf}.`)
  }

  return sentence(`${lead} gives you relevant proof of ${jf}.`)
}

function interpretAdjacentProof(profileFact: string, jobFact: string): string {
  const lead = evidenceLead(profileFact)
  const jf = capabilityPhrase(jobFact)

  if (!lead) return ""
  if (!jf) return sentence(lead)

  if (/experience producing real-world brand and marketing assets/i.test(lead)) {
    return sentence(`${lead} shows range across deliverables that should translate well to the portfolio expectations of this role.`)
  }

  if (/research and analytical experience/i.test(lead)) {
    return sentence(`${lead} gives you relevant analytical proof that should translate well to ${jf}.`)
  }

  if (/marketing and communications experience|cross-functional execution experience|clinical exposure|EMT experience/i.test(lead)) {
    return sentence(`${lead} should translate well to ${jf}.`)
  }

return sentence(`${lead} should translate well to the ${jf} this role emphasizes.`)
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
    .replace(/^prepare reports on consulting services performed for clients$/i, "client reporting and written analysis")
    .replace(/^supply portfolio of past work\/demonstrate skills$/i, "a portfolio that demonstrates visual design range")
    .trim()

  if (/ensuring compliance with state and federal regulations/i.test(t)) {
    return "perform compliance and analysis work"
  }

  if (/market research/i.test(t) && /growth opportunities/i.test(t)) {
    return "conduct market research and support growth strategy"
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

function buildInterestAlignmentClause(profileSignals?: any, jobSignals?: any): string | null {
  const roles: string[] = profileSignals?.statedInterests?.targetRoles || []
  const industries: string[] = profileSignals?.statedInterests?.targetIndustries || []

  const jobText = norm(jobSignals?.job_text || "")
  const jobFamily = norm(jobSignals?.jobFamily || jobSignals?.job_family || "")

  const roleText = roles.map((r) => norm(r)).join(" | ")

  const hasAny = (phrases: string[]) => phrases.some((p) => jobText.includes(p))
  const familyIs = (x: string) => jobFamily === norm(x)

  if (
    hasAny(["policy analyst", "regulatory affairs", "legislative assistant", "government affairs", "compliance analyst"]) ||
    (hasAny(["policy", "regulatory", "legislative", "compliance", "government affairs"]) && (familyIs("Government") || familyIs("Other"))) ||
    /\b(policy|regulatory|legislative|compliance)\b/.test(roleText)
  ) {
    return sentence("This position aligns with your stated interest in policy and regulatory roles.")
  }

  if (
    hasAny(["process improvement", "process transformation", "business operations", "operations strategy", "post-merger integration", "internal consulting"]) ||
    (hasAny(["operations", "process", "transformation", "business analyst"]) && (familyIs("Consulting") || familyIs("Other"))) ||
    /\b(operations|process|transformation|business analyst|internal consulting|post-merger integration)\b/.test(roleText)
  ) {
    return sentence("This position aligns with your stated interest in operations and transformation roles.")
  }

  if (
    hasAny(["product marketing", "brand marketing", "digital marketing", "brand management", "creative marketing"]) ||
    (hasAny(["marketing", "brand", "product marketing", "digital marketing"]) && familyIs("Marketing")) ||
    /\b(product marketing|brand management|digital marketing|creative marketing|marketing)\b/.test(roleText)
  ) {
    return sentence("This position aligns with your stated interest in marketing roles.")
  }

  if (
    /\b(finance|investment|wealth management|asset management)\b/.test(roleText) ||
    (hasAny(["finance", "investment", "wealth management", "asset management", "client associate"]) && /\b(finance|investment|wealth management|asset management)\b/.test(roleText))
  ) {
    return sentence("This position aligns with your stated interest in finance roles.")
  }

  const industryMatch = industries.find((i) => {
    const t = norm(i)
    return t && jobText.includes(t)
  })

  if (industryMatch) {
    return sentence(`This position aligns with your stated interest in the ${industryMatch} industry.`)
  }

  return null
}

function toGerundStart(s: string): string {
  let t = cleanProfileFact(s)

  t = t.replace(/^Gathered and analyzed\b/i, "gathering and analyzing")
  t = t.replace(/^Conducted\b/i, "conducting")
  t = t.replace(/^Prepared\b/i, "preparing")
  t = t.replace(/^Led\b/i, "leading")
  t = t.replace(/^Developed\b/i, "developing")
  t = t.replace(/^Coordinated\b/i, "coordinating")
  t = t.replace(/^Supported\b/i, "supporting")
  t = t.replace(/^Gathered\b/i, "gathering")
  t = t.replace(/^Analyzed\b/i, "analyzing")
  t = t.replace(/^Engaged\b/i, "engaging")
  t = t.replace(/^Partnered\b/i, "partnering")
  t = t.replace(/^Spearheaded\b/i, "spearheading")
  t = t.replace(/^Standardized\b/i, "standardizing")

  return t
}

function renderWhyBullet(
  w: WhyCode,
  profileSignals?: EvalOutput["profile_signals"],
  jobSignals?: EvalOutput["job_signals"]
): string | null {
  const jobFact = normalizeWhyJobFact(w.job_fact || "")

  let profileFact = toGerundStart(w.profile_fact || "")
  profileFact = profileFact
    .split(/;|\s+\|\s+/)[0]
    .replace(/\s+(including|especially|such as)\s+.*$/i, "")
    .trim()

  if (profileFact.length > 180) {
    profileFact = profileFact.slice(0, 180).replace(/\s+\S*$/, "").trim()
  }

  if (
    /^(what you'll do|what you will do|major responsibilities include|ideal qualifications include|this job reports to|major in\b|duties include\b|the intern reports directly\b|throughout your work with\b|two years of equivalent education\b|2-4 years\b|[0-9]+\+?\s*years\b|work as a member of\b|small sized commercial litigation law firm\b)/i.test(jobFact)
  ) {
    return null
  }

  if (!usable(jobFact) || !usable(profileFact)) return null

  if (w.code === "WHY_DIRECT_EXPERIENCE_PROOF") {
    return interpretDirectProof(profileFact, jobFact)
  }

  if (w.code === "WHY_ADJACENT_EXPERIENCE_PROOF") {
    return interpretAdjacentProof(profileFact, jobFact)
  }

  if (w.code === "WHY_EXECUTION_PROOF") {
    const lead = evidenceLead(profileFact)
    if (/portfolio-level design work/i.test(lead)) {
      return sentence("Your portfolio-level design work shows the kind of execution discipline this team expects from a designer who can contribute immediately.")
    }
    return sentence(`${lead || capitalizeClause(profileFact)} shows the kind of execution discipline this team will expect from someone stepping into the role.`)
  }

  if (w.code === "WHY_TOOL_PROOF") {
    const tools = extractTools(profileFact)
    if (tools.length > 0) {
      const list = tools.length > 3
        ? `${tools.slice(0, 2).join(", ")}, and ${tools[tools.length - 1]}`
        : tools.join(", ").replace(/, ([^,]*)$/, ", and $1")
      return sentence(`Your fluency with ${list} gives you the tool readiness this design workflow depends on.`)
    }

    const lead = evidenceLead(profileFact)
    const jf = capabilityPhrase(jobFact)
    return sentence(`${lead || capitalizeClause(profileFact)} gives you relevant proof that should translate well to ${jf}.`)
  }

  const lead = evidenceLead(profileFact)
  const jf = capabilityPhrase(jobFact)
  return sentence(`${lead || capitalizeClause(profileFact)} supports the capabilities this role expects, particularly around ${jf}.`)
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

function renderRiskBullet(r: RiskCode): string | null {
  const code = norm(r.code)
  const jobEv = sentence(r.job_fact || "")
  const profileEv = sentence(r.profile_fact || "")
  const riskText = sentence(r.risk || "")
  const jf = capabilityPhrase(r.job_fact || "")

  if (!usable(jobEv)) return null

  if (code === "RISK_ANALYTICS_HEAVY") {
    return sentence("This role appears more analytics-heavy than your stated preferences suggest.")
  }

  if (code === "RISK_CONTRACT") {
    return sentence("This role appears to be contract-based, which does not align with your preference for full-time roles.")
  }

  if (code === "RISK_LOCATION") {
    return sentence("This role appears location-constrained, and your stated preferences do not clearly line up with that requirement.")
  }

  if (code === "RISK_SALES") {
    return sentence("This role has clear sales expectations that conflict with the constraints stated in your profile.")
  }

  if (code === "RISK_MISSING_PROOF") {
    if (isSoftSkillRisk(jf)) {
      return sentence(`Your resume does not yet make ${jf} especially explicit, which may matter in a competitive review process.`)
    }

    if (/clinical|patient|surgical|operating room|surgeon/i.test(jf)) {
      return sentence("This role leans heavily on direct clinical credibility, and your background does not yet show the strongest hands-on proof in that environment.")
    }

    if (/research|analysis|analytics|reporting/i.test(jf)) {
      return sentence("Your background shows analytical preparation, but more direct proof of client-ready research and reporting would make this case stronger.")
    }

    if (/policy|legislative|compliance/i.test(jf)) {
      return sentence("This role rewards more direct policy and compliance experience than is currently visible in your background.")
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
    return sentence("The posting calls for tools you have not clearly shown in your profile yet.")
  }

  if (usable(riskText) && usable(profileEv)) {
    return sentence(`${riskText} ${jobEv} ${profileEv}`)
  }

  if (usable(riskText)) {
    return sentence(`${riskText} ${jobEv}`)
  }

  if (usable(profileEv)) {
    return sentence(`${jobEv} ${profileEv}`)
  }

  return jobEv
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

  const usedWhyGroups = new Set<Group>()
  const usedWhyKeys = new Set<string>()
  const usedRiskGroups = new Set<Group>()
  const usedWhyRendered = new Set<string>()
  const usedWhyJobFacts = new Set<string>()
  const usedProfileFacts = new Set<string>()
  const usedRiskRendered = new Set<string>()
  const usedRiskJobFacts = new Set<string>()
  const usedRiskProfileFacts = new Set<string>()

  const interestAlign = buildInterestAlignmentClause(out.profile_signals, out.job_signals)
  if (interestAlign && whyMax > 0) why.push(interestAlign)

  if (whyMax > 0) {
    for (const w of whyCodesIn) {
      if (why.length >= whyMax) break

      const group = whyGroup(w)
      const matchKey = norm(w.match_key || "")
      const rendered = renderWhyBullet(w, out.profile_signals, out.job_signals)
      const renderedKey = norm(rendered || "")
      const normalizedWhyJobFactKey = norm(normalizeWhyJobFact(w.job_fact || "")).slice(0, 180)
      const profileFactKey = norm(cleanProfileFact(w.profile_fact || "")).slice(0, 180)

      if (!rendered || !usable(rendered)) continue
      if (renderedKey && usedWhyRendered.has(renderedKey)) continue
      if (normalizedWhyJobFactKey && usedWhyJobFacts.has(normalizedWhyJobFactKey)) continue
      if (profileFactKey && usedProfileFacts.has(profileFactKey)) continue
      if (matchKey && usedWhyKeys.has(matchKey)) continue
      if (group === "tools" && usedWhyGroups.has("tools")) continue
      if (group === "execution" && Array.from(usedWhyGroups).filter((g) => g === "execution").length >= 2) {
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

  if (riskMax > 0) {
    for (const r of riskCodesIn) {
      if (risk.length >= riskMax) break

      const group = riskGroup(r.code)
      const rendered = renderRiskBullet(r)
      const renderedKey = norm(rendered || "")
      const jobFactKey = norm(capabilityPhrase(r.job_fact || "")).slice(0, 180)
      const profileFactKey = norm(cleanProfileFact(r.profile_fact || "")).slice(0, 180)

      if (usedRiskGroups.has(group) && group !== "other") continue
      if (r.code === "RISK_MISSING_TOOLS" && risk.length === 0 && r.severity !== "high") continue
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

if (out.decision !== "Pass" && risk.length === 0) {
  const whyText = (why || []).join(" | ").toLowerCase()
  const jobText = norm(out.job_signals?.job_text || "")
  const combined = `${whyText} ${jobText}`

  if (/designer|design|portfolio|adobe|figma|photoshop|creative/i.test(combined)) {
    risk.push(
      "Your background shows strong design execution, but the resume does not yet make portfolio depth and presentation of past work fully explicit, which could matter in a hiring process where visual proof carries as much weight as the resume itself."
    )
  } else if (/consulting|benchmarking|client reporting|analysis|analytical|research/i.test(combined)) {
    risk.push(
      "Your background shows strong analytical capability, but the resume offers limited direct evidence of client-facing consulting delivery, which may raise questions in firms expecting interns to contribute quickly in structured client-service environments."
    )
  } else if (/marketing|communications|campaign|content|social media|brand/i.test(combined)) {
    risk.push(
      "Your experience supports marketing and communications work, but the resume does not yet show enough depth in campaign ownership or results-driven execution to remove doubt in a competitive internship pool."
    )
  } else if (/clinical sales|clinical|procedure|utilization|medical device|sales/i.test(combined)) {
    risk.push(
      "Your background brings credible clinical and commercial exposure, but the resume does not yet show direct proof of medical device sales execution in environments where adoption, utilization, and surgeon-facing credibility matter."
    )
  } else {
    risk.push(
      "Your background shows relevant preparation, but the resume does not yet show enough direct proof in the core work this role is hiring for."
    )
  }
} else if (out.decision === "Pass" && risk.length === 0) {
  risk.push(
    "The posting emphasizes work where your current experience does not yet show clear direct proof."
  )
} 
else if (out.decision === "Pass" && risk.length === 0) {
    risk.push(
      "The posting emphasizes work where your current experience does not yet show clear direct proof."
    )
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
