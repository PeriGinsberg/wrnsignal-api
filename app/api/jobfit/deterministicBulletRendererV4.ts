// FILE: app/api/jobfit/deterministicBulletRendererV4.ts
//
// Thin deterministic renderer.
// It should not rescue weak upstream evidence.
// It should render matched proof cleanly.

import type {
  EvalOutput,
  Decision,
  WhyCode,
  RiskCode,
} from "./signals"

export const RENDERER_V4_STAMP =
  "RENDERER_V4_STAMP__2026_03_07__THIN_EVIDENCE_RENDERER__B"

type RenderCaps = { whyMax: number; riskMax: number }

function capsForDecision(d: Decision): RenderCaps {
  if (d === "Priority Apply") return { whyMax: 6, riskMax: 3 }
  if (d === "Apply") return { whyMax: 6, riskMax: 3 }
  if (d === "Review") return { whyMax: 5, riskMax: 4 }
  return { whyMax: 0, riskMax: 4 }
}

type Group = "proof" | "tools" | "execution" | "other"

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

  if (
    code === "RISK_EXPERIENCE" ||
    code === "RISK_ANALYTICS_HEAVY" ||
    code === "RISK_REPORTING_SIGNALS" ||
    code === "RISK_SALES"
  ) {
    return "other"
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
  const sev = r.severity
  const sevWeight = sev === "high" ? 100 : sev === "medium" ? 60 : 30
  const toolPenalty = code === "RISK_MISSING_TOOLS" && sev !== "high" ? -20 : 0
  return sevWeight + toolPenalty
}

function norm(s: unknown): string {
  return String(s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function sentence(s: string): string {
  let t = norm(s)
  t = t.replace(/^[•\-\s]+/, "")
  t = t.replace(/\s*[.;:]+$/, "")
  if (!t) return ""
  return t[0].toUpperCase() + t.slice(1)
}

function usable(s: string): boolean {
  const t = norm(s)
  if (!t) return false
  if (t.length < 20) return false
  if (/^\w+(,\s*\w+){0,2}$/.test(t)) return false
  return true
}

function cleanClause(s: string): string {
  return norm(s)
    .replace(/\.$/, "")
    .replace(/^your experience\s+/i, "")
    .replace(/^experience\s+/i, "")
    .trim()
}

function capitalizeClause(s: string): string {
  const t = norm(s)
  if (!t) return ""
  return t[0].toUpperCase() + t.slice(1)
}

function normalizeWhyJobFact(s: string): string {
  let t = cleanClause(s || "")
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
.replace(/^developing\s+/i, "develop ")
.replace(/^contributing from concept to execution of\s+/i, "contribute to ")
.replace(/the process design and documentation work this role requires/i, "design and document processes")
.replace(/the cross-functional execution this role requires/i, "execute cross-functionally")
.replace(/the compliance and analysis work this role requires/i, "perform compliance and analysis work")
.replace(/the market research and growth strategy work this role requires/i, "conduct market research and support growth strategy").replace(/^develops and maintains\s+/i, "develop and maintain ")
.replace(
  /develop and maintain expertise in tracking emerging and complex issues related to health care finance/i,
  "develop and maintain expertise in emerging health care finance issues"
)
.replace(/^analyze\s+/i, "analyze ")
.replace(/develop and maintain expertise in and tracks/i, "develop and maintain expertise in tracking")
.replace(/^planning and administering\s+/i, "plan and administer ")
    .trim()

  if (/ensuring compliance with state and federal regulations/i.test(t)) {
    return "perform compliance and analysis work"
  }

  if (/conducting detailed analyses/i.test(t) && /process improvement/i.test(t)) {
    return "the analytical and process-improvement work this role requires"
  }

  if (/process design documentation and governance/i.test(t)) {
    return "design and document processes"
  }

  if (/service strategy into coordinated cross-functional execution/i.test(t)) {
    return "execute cross-functionally"
  }

  if (/market research/i.test(t) && /growth opportunities/i.test(t)) {
    return "conduct market research and support growth strategy"
  }

  if (/gathering data and analyzing business challenges/i.test(t)) {
    return "the product strategy and analytical work this role requires"
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
  const industryText = industries.map((i) => norm(i)).join(" | ")

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
  (
    hasAny(["finance", "investment", "wealth management", "asset management", "client associate"]) &&
    /\b(finance|investment|wealth management|asset management)\b/.test(roleText)
  )
) {
  return sentence("This position aligns with your stated interest in finance roles.")
}

  if (
    hasAny(["private practice", "legal assistant", "legal services", "privacy analyst", "data protection"]) ||
    /\b(legal assistant|legal services|privacy analyst|data protection|case analyst)\b/.test(roleText)
  ) {
    return sentence("This position aligns with your stated interest in legal and policy-adjacent roles.")
  }

  const industryMatch = industries.find((i: string) => {
    const t = norm(i)
    return t && jobText.includes(t)
  })

  if (industryMatch) {
    return sentence(`This position aligns with your stated interest in the ${industryMatch} industry.`)
  }

  return null
}

function toGerundStart(s: string): string {
  let t = norm(s)

t = t.replace(/^Gathered and analyzed\b/i, "gathering and analyzing")
t = t.replace(/^Gathered and analyzed\s+/i, "gathering and analyzing ")
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
t = t.replace(/^Led\s+cross-functional team\b/i, "leading a cross-functional team")
t = t.replace(/^Led\b/i, "leading a")
t = t.replace(/^Proven record leading\b/i, "leading")
t = t.replace(/^Strong focus on\b/i, "focusing on")
t = t.replace(/^Gathered and analyzed\s+/i, "gathering and analyzing ")
t = t.replace(/^Led cross-functional team\b/i, "leading a cross-functional team")

  return t
}

function renderWhyBullet(
  w: WhyCode,
  profileSignals?: EvalOutput["profile_signals"],
  jobSignals?: EvalOutput["job_signals"]
): string | null {
  const jobFact = normalizeWhyJobFact(w.job_fact || "")

  let profileFact = toGerundStart(cleanClause(w.profile_fact || ""))
  profileFact = profileFact
    .split(/;|\s+\|\s+/)[0]
    .replace(/\s+(including|especially|such as)\s+.*$/i, "")
    .trim()

  if (profileFact.length > 160) {
    profileFact = profileFact.slice(0, 160).replace(/\s+\S*$/, "").trim()
  }

  if (
    /^(what you'll do|what you will do|major responsibilities include|ideal qualifications include|this job reports to|major in\b|duties include\b|the intern reports directly\b|throughout your work with\b|two years of equivalent education\b|2-4 years\b|[0-9]+\+?\s*years\b|work as a member of\b|small sized commercial litigation law firm\b)/i.test(
      jobFact
    )
  ) {
    return null
  }

  if (!usable(jobFact) || !usable(profileFact)) return null

  const pf = profileFact.charAt(0).toLowerCase() + profileFact.slice(1)
  const jf = jobFact.charAt(0).toLowerCase() + jobFact.slice(1)

  if (w.code === "WHY_DIRECT_EXPERIENCE_PROOF") {
  return sentence(
    `${capitalizeClause(pf)} gives you real proof for ${jf}.`
  )
}

if (w.code === "WHY_ADJACENT_EXPERIENCE_PROOF") {
  return sentence(
    `${capitalizeClause(pf)} is relevant adjacent proof for ${jf}.`
  )
}

if (w.code === "WHY_EXECUTION_PROOF") {
  return sentence(
    `${capitalizeClause(pf)} also shows the structured execution this role depends on.`
  )
}

if (w.code === "WHY_TOOL_PROOF") {
  return sentence(
    `${capitalizeClause(pf)} supports the workflow this role depends on, especially around ${jf}.`
  )
}

return sentence(
  `${capitalizeClause(pf)} gives you usable proof for ${jf}.`
)
}

function renderRiskBullet(r: RiskCode): string | null {
  const code = norm(r.code)
  const jobEv = sentence(r.job_fact || "")
  const profileEv = sentence(r.profile_fact || "")
  const riskText = sentence(r.risk || "")

  if (!usable(jobEv)) return null

  if (code === "RISK_ANALYTICS_HEAVY") {
    return sentence(
      "This role appears more analytics-heavy than your stated preferences suggest."
    )
  }

  if (code === "RISK_MISSING_PROOF") {
    return sentence(
      `This role emphasizes ${cleanClause(r.job_fact || "")}, and your profile does not yet show clear direct proof in that area.`
    )
  }

  if (code === "RISK_CONTRACT") {
    return sentence(
      "This role appears to be contract-based, which does not align with your preference for full-time roles."
    )
  }

  if (code === "RISK_LOCATION") {
    return sentence(
      "This role's location does not align with the cities you are targeting."
    )
  }

  if (code === "RISK_SALES") {
    return sentence(
      "This role includes sales expectations that conflict with your stated constraints."
    )
  }

  if (code === "RISK_MISSING_TOOLS") {
    return sentence(
      "The posting calls for tools you have not clearly shown in your profile yet."
    )
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

  const interestAlign = buildInterestAlignmentClause(
    out.profile_signals,
    out.job_signals
  )

  if (interestAlign && whyMax > 0) {
    why.push(interestAlign)
  }

  if (whyMax > 0) {
    for (const w of whyCodesIn) {
      if (why.length >= whyMax) break

      const group = whyGroup(w)
      const matchKey = norm(w.match_key || "")
      const rendered = renderWhyBullet(w, out.profile_signals, out.job_signals)
      const renderedKey = norm(rendered || "")
      const jobFactKey = norm(w.job_fact || "").slice(0, 180)
      const profileFactKey = norm(w.profile_fact || "").slice(0, 180)
      const normalizedWhyJobFactKey = norm(
        normalizeWhyJobFact(w.job_fact || "")
      ).slice(0, 180)

      if (!rendered || !usable(rendered)) continue
      if (renderedKey && usedWhyRendered.has(renderedKey)) continue
      if (normalizedWhyJobFactKey && usedWhyJobFacts.has(normalizedWhyJobFactKey)) continue

      if (jobFactKey && usedWhyJobFacts.has(jobFactKey)) {
        const sameJobFactAlreadyUsed = why.some((existing) =>
          norm(existing).includes(jobFactKey)
        )
        const allowSameJobFactVariant =
          w.code === "WHY_EXECUTION_PROOF" || w.code === "WHY_TOOL_PROOF"

        if (sameJobFactAlreadyUsed && !allowSameJobFactVariant) continue
      }

      if (profileFactKey && usedProfileFacts.has(profileFactKey)) continue
      if (matchKey && usedWhyKeys.has(matchKey)) continue
      if (group === "tools" && usedWhyGroups.has("tools")) continue
      if (
        group === "execution" &&
        Array.from(usedWhyGroups).filter((g) => g === "execution").length >= 2
      ) {
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
      const jobFactKey = norm(r.job_fact || "").slice(0, 180)
      const profileFactKey = norm(r.profile_fact || "").slice(0, 180)

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

  if (out.decision === "Pass" && risk.length === 0) {
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



