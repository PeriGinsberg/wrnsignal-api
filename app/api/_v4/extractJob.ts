import {
  JobStructured,
  JobCluster,
  WeightTier,
  AnalyticalIntensity,
  DomainIntensity,
} from "./types"
import { TAXONOMY } from "./taxonomy"

// -----------------------------
// Helpers
// -----------------------------

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
// Evidence: responsibilities-first snippet selection
// -----------------------------

function extractSection(raw: string, headingPatterns: RegExp[]): string | null {
  const text = raw || ""
  const lower = text.toLowerCase()

  let startIdx = -1
  let matchedLen = 0

  for (const re of headingPatterns) {
    const m = re.exec(lower)
    if (m && (startIdx === -1 || m.index < startIdx)) {
      startIdx = m.index
      matchedLen = m[0].length
    }
  }

  if (startIdx < 0) return null

  const after = text.slice(startIdx + matchedLen)

  const stopHeadings = [
    /(^|\n)\s*(qualifications|requirements|education|about\s+us|about\s+the\s+company|who\s+we\s+are|equal\s+opportunity|eeo|benefits)\s*[:\n]/i,
    /(^|\n)\s*(responsibilities|what\s+you('|’)?ll\s+do|what\s+you\s+will\s+do|key\s+responsibilities)\s*[:\n]/i,
  ]

  let stopIdx = after.length
  for (const re of stopHeadings) {
    const m = re.exec(after)
    if (m && m.index >= 0) stopIdx = Math.min(stopIdx, m.index)
  }

  const section = after.slice(0, stopIdx).trim()
  return section.length ? section : null
}

function getEvidenceCorpus(raw: string): { primary: string; fallback: string } {
  const responsibilities = extractSection(raw, [
    /(^|\n)\s*(responsibilities|what\s+you('|’)?ll\s+do|what\s+you\s+will\s+do|key\s+responsibilities)\s*[:\n]/i,
  ])

  // If no responsibilities section, build a "bullet-only" corpus from the full text
  const lines = (raw || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const bulletish = lines.filter((l) => /^[-•*]\s+/.test(l))
  const bulletCorpus = bulletish.length ? bulletish.join("\n") : raw

  return {
    primary: responsibilities || bulletCorpus,
    fallback: raw,
  }
}
function findEvidenceSnippet(corpusText: string, phrase: string): string {
  const lines = (corpusText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const phraseNorm = normalize(phrase)

  const isHeadingLine = (line: string) => {
    const ln = normalize(line).replace(/[:\-–—]+$/, "").trim()

 // Block role title lines like "Associate (Intern), Summer 2026"
const hasSeasonOrTerm =
  /\b(summer|fall|spring|winter)\b/.test(ln) || /\b202\d\b/.test(ln)

const looksLikeRoleTitle =
  // common role words OR parentheses pattern used in titles
  /(intern|associate|analyst|coordinator|specialist|manager)\b/.test(ln) ||
  /\([^)]*\)/.test(ln)

const hasNoActionVerb =
  !/(assist|conduct|create|manage|prepare|support|maintain|format|utiliz|analy|research|coordinate|develop|build|track|report|present|model|forecast|gather|interview)\b/.test(
    ln
  )

if (hasSeasonOrTerm && looksLikeRoleTitle && hasNoActionVerb && ln.length <= 80) {
  return true
}

 const headings = new Set([
  "about the job",
  "company introduction",
  "introduction",
  "overview",
  "role overview",
  "position overview",
  "job overview",
  "responsibilities",
  "qualifications",
  "requirements",
  "education",
  "about us",
  "who we are",
  "benefits",
  "culture",
])
    if (headings.has(ln)) return true

    if (
      ln.length <= 18 &&
      (ln.includes("about") ||
        ln.includes("requirements") ||
        ln.includes("qualifications"))
    ) {
      return true
    }

    return false
  }

  const isFluffLine = (ln: string) =>
    includesAny(ln, [
      "with respect to culture",
      "works collaboratively across offices",
      "one global team",
      "our mission",
      "our values",
      "award-winning",
      "cutting-edge",
      "market leader",
      "founded in",
      "brand awareness",
    ])

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
    "interview",
  ]

  const looksLikeBullet = (l: string) => /^[-•*]\s+/.test(l)

  const isObviousMarketingOrAbout = (ln: string) =>
    includesAny(ln, [
      "is a specialized",
      "is an iconic",
      "we are a",
      "our mission",
      "brand",
      "market leader",
      "cutting-edge",
      "award-winning",
      "90% brand awareness",
    ])

  const isRequirementLine = (ln: string) =>
    includesAny(ln, [
      "pursuit of",
      "bachelor",
      "master",
      "degree",
      "gpa",
      "preferred qualification",
      "qualification",
      "requirements",
    ])

  // Pass 1: phrase appears + bullet/duty verb + NOT headings/fluff/marketing/requirements
  for (const line of lines) {
    const ln = normalize(line)
    if (isHeadingLine(line)) continue
    if (isFluffLine(ln)) continue
    if (!phraseNorm) continue
    if (!ln.includes(phraseNorm)) continue
    if (!looksLikeBullet(line) && !dutyVerbs.some((v) => ln.includes(v))) continue
    if (isObviousMarketingOrAbout(ln)) continue
    if (isRequirementLine(ln)) continue
    return line.slice(0, 220)
  }

  // Pass 2: any line containing phrase, still filtered
  for (const line of lines) {
    const ln = normalize(line)
    if (isHeadingLine(line)) continue
    if (isFluffLine(ln)) continue
    if (!phraseNorm) continue
    if (!ln.includes(phraseNorm)) continue
    if (isObviousMarketingOrAbout(ln)) continue
    if (isRequirementLine(ln)) continue
    return line.slice(0, 220)
  }

  // Final fallback: first "safe" line (never return headings)
  const safe = lines.find((l) => {
    const ln = normalize(l)
    return (
      !isHeadingLine(l) &&
      !isFluffLine(ln) &&
      !isObviousMarketingOrAbout(ln) &&
      !isRequirementLine(ln)
    )
  })

  return (safe || "").trim().slice(0, 220)
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
    { tag: "real_estate", markers: ["commercial real estate", "real estate", "multifamily", "leasing", "brokerage"] },
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
  const corpus = getEvidenceCorpus(raw)

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

    // V4 v1: hard-disable QA/testing clusters (false positives)
    const idLower = c.id.toLowerCase()
    if (idLower.includes("qa") || idLower.includes("test")) continue

    let weight_tier: WeightTier = "supporting"
    if (hits >= 3) weight_tier = "core"
    else if (hits === 2) weight_tier = "important"
    else weight_tier = "supporting"

    if (hasSections && hits === 1) {
      weight_tier = "important"
    }

    const confidence = clamp01(0.45 + Math.min(0.45, hits * 0.12))

    clusters.push({
      cluster_id: c.id,
      weight_tier,
      confidence,
      evidence_snippet: findEvidenceSnippet(
        corpus.primary,
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
        mode: jobTextNorm.includes("in-office") || jobTextNorm.includes("in person")
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