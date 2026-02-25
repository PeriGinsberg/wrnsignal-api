// app/api/_lib/BulletValidator.ts
export const BANNED_PHRASES = [
  "strong communicator",
  "excellent communicator",
  "great communication",
  "team player",
  "hardworking",
  "fast learner",
  "quick learner",
  "self-starter",
  "detail-oriented",
  "passionate",
  "excited",
  "motivated",
  "go-getter",
  "dynamic",
  "results-driven",
  "proven track record",
  "highly adaptable",
  "works well under pressure",
  "synergy",
  "leverage",
  "impactful",
  "rockstar",
  "ninja",
  "guru",
]

type BulletOutput = {
  why_bullets: string[]
  risk_bullets: string[]
  reasoning: string
}

type ValidationResult = {
  ok: boolean
  violations: string[]
}

function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function containsBannedPhrase(text: string, banned: string[]): string[] {
  const t = normalize(text)
  return banned.filter((p) => t.includes(normalize(p)))
}

function tokenSet(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(" ")
      .filter((w) => w.length >= 4)
  )
}

function jaccard(a: string, b: string): number {
  const A = tokenSet(a)
  const B = tokenSet(b)
  if (A.size === 0 && B.size === 0) return 1
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  const union = A.size + B.size - inter
  return union === 0 ? 0 : inter / union
}

function buildAnchors(evidence: any): { job: string[]; profile: string[] } {
  const jobAnchors: string[] = []
  const profileAnchors: string[] = []

  const pushAll = (arr: any, target: string[]) => {
    if (!Array.isArray(arr)) return
    for (const v of arr) if (typeof v === "string" && v.trim()) target.push(v)
  }

  pushAll(evidence?.job?.tools, jobAnchors)
  pushAll(evidence?.job?.responsibilities, jobAnchors)
  pushAll(evidence?.job?.requirements, jobAnchors)

  pushAll(evidence?.profile?.tools, profileAnchors)
  pushAll(evidence?.profile?.skills, profileAnchors)
  pushAll(evidence?.profile?.proof_points, profileAnchors)

  if (Array.isArray(evidence?.drivers?.why_evidence)) {
    for (const w of evidence.drivers.why_evidence) {
      if (w?.job_fact) jobAnchors.push(w.job_fact)
      if (w?.profile_fact) profileAnchors.push(w.profile_fact)
    }
  }

  if (Array.isArray(evidence?.drivers?.risk_evidence)) {
    for (const r of evidence.drivers.risk_evidence) {
      if (r?.job_fact) jobAnchors.push(r.job_fact)
      if (r?.profile_fact) profileAnchors.push(r.profile_fact)
    }
  }

  const dedupe = (arr: string[]) =>
    Array.from(new Set(arr.map(normalize))).filter((x) => x.length >= 4)

  return { job: dedupe(jobAnchors), profile: dedupe(profileAnchors) }
}

function bulletReferencesEvidence(
  bullet: string,
  anchors: { job: string[]; profile: string[] }
): { hasJob: boolean; hasProfile: boolean } {
  const b = normalize(bullet)

  const hasAny = (anchorList: string[]) => {
    for (const a of anchorList) {
      const tokens = a.split(" ").filter((t) => t.length >= 5)
      for (const t of tokens) {
        if (b.includes(t)) return true
      }
    }
    return false
  }

  return { hasJob: hasAny(anchors.job), hasProfile: hasAny(anchors.profile) }
}

export function validateBullets(
  output: BulletOutput,
  evidence: any,
  bannedPhrases: string[]
): ValidationResult {
  const violations: string[] = []

  const whyMin = evidence?.output_rules?.why_min ?? 3
  const whyMax = evidence?.output_rules?.why_max ?? 6
  const riskMin = evidence?.output_rules?.risk_min ?? 0
  const riskMax = evidence?.output_rules?.risk_max ?? 6

  const why = Array.isArray(output?.why_bullets) ? output.why_bullets : []
  const risk = Array.isArray(output?.risk_bullets) ? output.risk_bullets : []
  const reasoning = typeof output?.reasoning === "string" ? output.reasoning : ""

  if (why.length < whyMin || why.length > whyMax) {
    violations.push(`WHY bullets must be ${whyMin}-${whyMax}, got ${why.length}.`)
  }
  if (risk.length < riskMin || risk.length > riskMax) {
    violations.push(`RISK bullets must be ${riskMin}-${riskMax}, got ${risk.length}.`)
  }

  const gates = Array.isArray(evidence?.gates) ? evidence.gates : []
  if (gates.length > 0 && (whyMin > 0 || why.length > 0)) {
    violations.push("Hard gates present, WHY bullets must be 0 (strict mode).")
  }

  const allText = [...why, ...risk, reasoning].join(" | ")
  const bannedHits = containsBannedPhrase(allText, bannedPhrases)
  if (bannedHits.length) violations.push(`Banned phrases found: ${bannedHits.join(", ")}`)

  const anchors = buildAnchors(evidence)
  for (const [i, b] of why.entries()) {
    const ref = bulletReferencesEvidence(b, anchors)
    if (!ref.hasJob || !ref.hasProfile) {
      violations.push(`WHY bullet ${i + 1} does not clearly reference job + profile evidence.`)
    }
  }
  for (const [i, b] of risk.entries()) {
    const ref = bulletReferencesEvidence(b, anchors)
    if (!ref.hasJob) violations.push(`RISK bullet ${i + 1} does not clearly reference job evidence.`)
  }

  const SIM_THRESHOLD = 0.72
  const checkNearDupes = (list: string[], label: string) => {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (jaccard(list[i], list[j]) >= SIM_THRESHOLD) {
          violations.push(`${label} bullets ${i + 1} and ${j + 1} are too similar.`)
        }
      }
    }
  }
  checkNearDupes(why, "WHY")
  checkNearDupes(risk, "RISK")

 type RiskEvidence = {
  risk?: string
  severity?: "low" | "medium" | "high"
}

const rawRiskEvidence: RiskEvidence[] = Array.isArray(evidence?.drivers?.risk_evidence)
  ? evidence.drivers.risk_evidence
  : []

const highRisks: string[] = rawRiskEvidence
  .filter((r) => r?.severity === "high" && typeof r?.risk === "string")
  .map((r) => normalize(r.risk as string))

if (highRisks.length > 0) {
  const riskBlob: string = normalize(risk.join(" "))

  const covered: boolean = highRisks.every((hr: string) => {
    const firstToken = hr.split(" ")[0]
    return riskBlob.includes(firstToken) || riskBlob.includes(hr)
  })

  if (!covered) {
    violations.push("Missing one or more high-severity risk bullets.")
  }
}

  if (!reasoning.trim()) violations.push("Reasoning is required.")
  if (reasoning.length > 600) violations.push("Reasoning too long. Keep under 600 chars.")

  return { ok: violations.length === 0, violations }
}