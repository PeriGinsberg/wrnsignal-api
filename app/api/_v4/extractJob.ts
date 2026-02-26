import {
  JobStructured,
  JobCluster,
  WeightTier,
  AnalyticalIntensity,
  DomainIntensity,
} from "./types"
import { TAXONOMY } from "./taxonomy"

/**
 * JobFit V4 — extractJobV4
 *
 * Locked policies:
 * 1) QA/testing clusters are disabled (id contains "qa" or "test")
 * 2) After clusters are sorted by confidence desc, top 2 => core, all others => important
 * 3) Evidence selection is deterministic and scalable:
 *    - Prefer duty/responsibility lines
 *    - If none, allow qualification/requirement lines
 *    - Never allow headings/marketing/benefits boilerplate
 *    - If none, evidence is ""
 * 4) Evidence uniqueness:
 *    - If a snippet is already used by a higher-ranked cluster, blank it out ("")
 */

function normalize(text: string): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim()
}

function clamp01(n: number): number {
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n))
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
  const m = haystack.match(re)
  return m ? m.length : 0
}

// -----------------------------
// Evidence selection (deterministic)
// -----------------------------

function findEvidenceSnippet(rawText: string, phrase: string): string {
  const text = rawText || ""
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const phraseNorm = normalize(phrase)

  const dutyVerbs = [
    "assist",
    "conduct",
    "create",
    "manage",
    "prepare",
    "support",
    "maintain",
    "format",
    "utiliz",
    "analy",
    "research",
    "coordinate",
    "develop",
    "build",
    "track",
    "report",
    "present",
    "model",
    "forecast",
    "gather",
    "synthesize",
    "draft",
    "write",
    "interview",
    "evaluate",
    "recommend",
  ]

  const isHeadingLine = (line: string) => {
    const ln = normalize(line).replace(/[:\-–—]+$/, "").trim()

    const headings = new Set([
      "about the job",
      "company introduction",
      "introduction",
      "overview",
      "job description summary",
      "job summary",
      "role summary",
      "position summary",
      "responsibilities",
      "qualifications",
      "requirements",
      "education",
      "about us",
      "who we are",
      "benefits",
      "culture",
      "equal opportunity",
      "eeo",
    ])
    if (headings.has(ln)) return true

    if (
      ln.length <= 30 &&
      (ln.includes("summary") || ln.includes("introduction") || ln.includes("overview"))
    ) {
      return true
    }

    const hasSeasonOrTerm =
      /\b(summer|fall|spring|winter)\b/.test(ln) || /\b202\d\b/.test(ln)
    const looksLikeRoleTitle =
      /(intern|associate|analyst|coordinator|specialist|manager)\b/.test(ln) ||
      /\([^)]*\)/.test(ln)
    const hasNoActionVerb = !dutyVerbs.some((v) => ln.includes(v))
    if (hasSeasonOrTerm && looksLikeRoleTitle && hasNoActionVerb && ln.length <= 110)
      return true

    return false
  }

  const isMarketingOrBenefits = (ln: string) =>
    includesAny(ln, [
      "award-winning",
      "cutting-edge",
      "market leader",
      "founded in",
      "our mission",
      "our values",
      "brand awareness",
      "is a specialized",
      "we are a",
      "one global team",
      "works collaboratively",
      "compensation",
      "highly competitive",
      "commensurate",
      "benefits",
      "401k",
      "paid time off",
      "pto",
      "medical",
      "dental",
      "vision",
      "wellness",
      "equal opportunity",
      "eeo",
      "accommodation",
      "working experience of an intern",
      "essentially identical to that of a full-time",
      "internship experience",
      "this internship",
    ])

  const isRequirementLine = (ln: string) =>
    includesAny(ln, [
      "pursuit of",
      "bachelor",
      "master",
      "degree",
      "gpa",
      "required",
      "preferred",
      "must have",
      "must be",
      "qualification",
      "qualifications",
      "requirements",
    ])

  const looksLikeBullet = (l: string) => /^[-•*]\s+/.test(l)

  const isDutyLine = (line: string) => {
    const ln = normalize(line)
    if (isHeadingLine(line)) return false
    if (isMarketingOrBenefits(ln)) return false
    if (isRequirementLine(ln)) return false

    const bullet = looksLikeBullet(line)
    const verb = dutyVerbs.some((v) => ln.includes(v))
    return bullet || verb
  }

  const isQualLine = (line: string) => {
    const ln = normalize(line)
    if (isHeadingLine(line)) return false
    if (isMarketingOrBenefits(ln)) return false
    return isRequirementLine(ln)
  }

  // Pass 1: phrase match on DUTY lines only
  for (const line of lines) {
    const ln = normalize(line)
    if (!phraseNorm) continue
    if (!ln.includes(phraseNorm)) continue
    if (!isDutyLine(line)) continue
    return line.slice(0, 220)
  }

  // Pass 2: phrase match on QUAL lines
  for (const line of lines) {
    const ln = normalize(line)
    if (!phraseNorm) continue
    if (!ln.includes(phraseNorm)) continue
    if (!isQualLine(line)) continue
    return line.slice(0, 220)
  }

  // Pass 3: partial phrase fallback on duty lines
  if (phraseNorm) {
    const parts = phraseNorm.split(" ").filter((p) => p.length >= 5)
    for (const line of lines) {
      const ln = normalize(line)
      if (!isDutyLine(line)) continue
      if (parts.some((p) => ln.includes(p))) return line.slice(0, 220)
    }
  }

  // Final fallback: first duty line, else blank
  const safeDuty = lines.find((l) => isDutyLine(l))
  return (safeDuty || "").trim().slice(0, 220)
}

// -----------------------------
// Other extractors
// -----------------------------

function inferAnalyticalIntensity(jobTextNorm: string): AnalyticalIntensity {
  const highSignals = [
    "financial model",
    "model development",
    "valuation",
    "underwriting",
    "quantitative",
    "statistics",
    "sql",
    "regression",
    "forecast",
    "dashboard",
    "data analysis",
    "cash flow",
    "pricing model",
    "due diligence",
  ]
  const moderateSignals = [
    "excel",
    "reporting",
    "metrics",
    "kpi",
    "analysis",
    "research",
    "spreadsheets",
    "pivot",
    "tracker",
    "report",
  ]

  const high = highSignals.filter((p) => jobTextNorm.includes(p)).length
  const mod = moderateSignals.filter((p) => jobTextNorm.includes(p)).length

  if (high >= 3) return "high"
  if (high >= 1 && mod >= 2) return "high"
  if (mod >= 2) return "moderate"
  return "low"
}

function inferDomain(jobTextNorm: string): {
  tag: string | null
  intensity: DomainIntensity
  evidence_snippet?: string
} {
  const strongMarkers = [
    "strong interest in",
    "passion for",
    "deep interest in",
    "must be passionate about",
  ]
  const moderateMarkers = ["interest in", "exposure to", "familiarity with"]

  const domainTags: Array<{ tag: string; markers: string[] }> = [
    { tag: "aviation", markers: ["aviation", "aerospace", "airline", "airport", "mro"] },
    { tag: "healthcare", markers: ["healthcare", "clinical", "patient", "medical"] },
    { tag: "fintech", markers: ["fintech", "payments", "blockchain", "crypto", "web3"] },
    { tag: "luxury", markers: ["luxury", "cartier", "richemont", "jewelry", "timepiece"] },
    {
      tag: "real_estate",
      markers: ["commercial real estate", "real estate", "multifamily", "leasing", "brokerage"],
    },
  ]

  let tag: string | null = null
  for (const d of domainTags) {
    if (includesAny(jobTextNorm, d.markers)) {
      tag = d.tag
      break
    }
  }

  const hasStrong = strongMarkers.some((m) => jobTextNorm.includes(m))
  const hasModerate = moderateMarkers.some((m) => jobTextNorm.includes(m))

  let snippet: string | undefined
  if (hasStrong) snippet = "Job explicitly signals strong domain interest."
  else if (hasModerate) snippet = "Job signals some domain interest."

  if (hasStrong && tag) return { tag, intensity: "strong", evidence_snippet: snippet }
  if (hasStrong && !tag) return { tag: null, intensity: "strong", evidence_snippet: snippet }
  if (hasModerate && tag) return { tag, intensity: "moderate", evidence_snippet: snippet }
  if (hasModerate && !tag) return { tag: null, intensity: "moderate", evidence_snippet: snippet }
  return { tag, intensity: "none" }
}

function extractTools(jobTextNorm: string): { required_tools: string[]; preferred_tools: string[] } {
  const toolsDict = [
    "excel",
    "powerpoint",
    "word",
    "google sheets",
    "google workspace",
    "gsuite",
    "sql",
    "r",
    "python",
    "tableau",
    "power bi",
    "figma",
    "adobe",
    "photoshop",
    "illustrator",
    "indesign",
    "salesforce",
    "hubspot",
    "asana",
    "monday.com",
    "airtable",
    "jira",
    "slack",
    "sharepoint",
    "seismic",
  ]

  const found = toolsDict.filter((t) => jobTextNorm.includes(t))
  const required: string[] = []
  const preferred: string[] = []

  for (const t of found) {
    const requiredMarkers = ["required", "must", "mandatory", "proficiency", "proficient", "strong proficiency"]
    const preferredMarkers = ["preferred", "a plus", "nice to have", "bonus", "plus"]

    const idx = jobTextNorm.indexOf(t)
    const window =
      idx >= 0
        ? jobTextNorm.slice(Math.max(0, idx - 80), Math.min(jobTextNorm.length, idx + 120))
        : ""

    const isReq = requiredMarkers.some((m) => window.includes(m))
    const isPref = preferredMarkers.some((m) => window.includes(m))

    if (isReq && !required.includes(t)) required.push(t)
    else if (isPref && !preferred.includes(t)) preferred.push(t)
    else {
      if (!preferred.includes(t) && !required.includes(t)) preferred.push(t)
    }
  }

  const normalizeTool = (t: string) => {
    if (t === "monday.com") return "Monday.com"
    if (t === "power bi") return "Power BI"
    if (t === "google sheets") return "Google Sheets"
    if (t === "google workspace") return "Google Workspace"
    if (t === "gsuite") return "GSuite"
    return t
      .split(" ")
      .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ")
      .replace("Sql", "SQL")
  }

  return {
    required_tools: required.map(normalizeTool),
    preferred_tools: preferred.map(normalizeTool),
  }
}

// -----------------------------
// Core: extractJobV4
// -----------------------------

export function extractJobV4(rawJobText: string): JobStructured {
  const raw = rawJobText || ""
  const jobTextNorm = normalize(raw)

  const sectionBoostPhrases = [
    "responsibilities",
    "what you'll do",
    "what you’ll do",
    "what you will do",
    "job responsibilities",
    "key responsibilities",
    "qualifications",
    "requirements",
  ]
  const hasSections = sectionBoostPhrases.some((p) => jobTextNorm.includes(p))

  const clusters: JobCluster[] = []

  for (const c of TAXONOMY) {
    const phrases = (c.example_phrases || []).map((p) => normalize(p))

    let hits = 0
    let bestPhrase = ""
    let bestCt = 0

    for (const p of phrases) {
      const ct = countOccurrences(jobTextNorm, p)
      if (ct > 0) {
        hits += ct
        if (ct > bestCt) {
          bestCt = ct
          bestPhrase = p
        }
      }
    }

    if (hits <= 0) continue

    const idLower = c.id.toLowerCase()
    if (idLower.includes("qa") || idLower.includes("test")) continue

    let weight_tier: WeightTier = "supporting"
    if (hits >= 3) weight_tier = "core"
    else if (hits === 2) weight_tier = "important"
    else weight_tier = "supporting"

    if (hasSections && hits === 1) weight_tier = "important"

    const confidence = clamp01(0.45 + Math.min(0.45, hits * 0.12))

    clusters.push({
      cluster_id: c.id,
      weight_tier,
      confidence,
      evidence_snippet: findEvidenceSnippet(
        raw,
        bestPhrase || (c.example_phrases?.[0] || "")
      ),
    })
  }

  const tools = extractTools(jobTextNorm)
  const analytical_intensity = inferAnalyticalIntensity(jobTextNorm)
  const domain = inferDomain(jobTextNorm)

  clusters.sort(
    (a, b) => b.confidence - a.confidence || a.cluster_id.localeCompare(b.cluster_id)
  )

  // Evidence uniqueness: avoid repeating the same snippet across clusters
  const used = new Set<string>()
  for (const cl of clusters) {
    const key = normalize(cl.evidence_snippet || "")
    if (!key) continue
    if (used.has(key)) cl.evidence_snippet = ""
    else used.add(key)
  }

  // LOCKED POLICY: top 2 are core, all others important
  for (let i = 0; i < clusters.length; i++) {
    clusters[i].weight_tier = i < 2 ? "core" : "important"
  }

  return {
    clusters,
    required_tools: tools.required_tools,
    preferred_tools: tools.preferred_tools,
    analytical_intensity,
    domain,
    eligibility: {
      location: {
        mode:
          jobTextNorm.includes("in-office") || jobTextNorm.includes("in person")
            ? "in_person"
            : jobTextNorm.includes("hybrid")
              ? "hybrid"
              : jobTextNorm.includes("remote")
                ? "remote"
                : "unknown",
      },
    },
  }
}