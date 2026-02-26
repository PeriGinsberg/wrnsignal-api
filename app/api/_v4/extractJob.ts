import { JobStructured, JobCluster, WeightTier, AnalyticalIntensity, DomainIntensity } from "./types"
import { TAXONOMY } from "./taxonomy"

// -----------------------------
// Helpers
// -----------------------------

function normalize(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
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

// Extract a short evidence snippet that *must* exist in the job text.
// We pick the best matching line or sentence where the phrase appears.

function findEvidenceSnippet(corpusText: string, phrase: string): string {
  const lines = corpusText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const phraseNorm = normalize(phrase)

const isHeadingLine = (line: string) => {
  const ln = normalize(line)
  const headings = [
    "about the job",
    "responsibilities",
    "qualifications",
    "requirements",
    "education",
    "about us",
    "who we are",
    "benefits",
    "culture",
  ]
  return headings.some((h) => ln === h || ln === h + ":" || ln.startsWith(h + ":"))
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
  ]

  const looksLikeBullet = (l: string) => /^[-•*]\s+/.test(l) || /^[a-z].+/.test(l)
  const isObviousMarketingOrAbout = (ln: string) =>
    includesAny(ln, [
      "is a specialized",
      "is an iconic",
      "founded in",
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
      "required",
      "preferred qualification",
      "must have",
      "qualification",
      "requirements",
    ])

  // Pass 1: phrase appears + bullet/duty verb + NOT marketing/requirements
  for (const line of lines) {
    const ln = normalize(line)
if (isHeadingLine(line)) continue
if (isFluffLine(ln)) continue
    if (!phraseNorm) continue
    if (!ln.includes(phraseNorm)) continue
    if (!looksLikeBullet(line)) continue
    if (!dutyVerbs.some((v) => ln.includes(v))) continue
    if (isObviousMarketingOrAbout(ln)) continue
    if (isRequirementLine(ln)) continue
    return line.slice(0, 220)
  }

  // Pass 2: phrase appears + NOT marketing/requirements
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

  // Worst-case fallback: first non-marketing line
  const safe = lines.find((l) => {
    const ln = normalize(l)
    return !isObviousMarketingOrAbout(ln) && !isRequirementLine(ln)
  })
  return (safe || corpusText || "").trim().slice(0, 220)
}function inferAnalyticalIntensity(jobTextNorm: string): AnalyticalIntensity {
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

function inferDomain(jobTextNorm: string): { tag: string | null; intensity: DomainIntensity; evidence_snippet?: string } {
  // NOTE: We keep this minimal for V4 v1.
  // We only detect "strong" when the job text explicitly asks for passion/interest.
  const strongMarkers = ["strong interest in", "passion for", "deep interest in", "must be passionate about"]
  const moderateMarkers = ["interest in", "exposure to", "familiarity with"]

  // very light domain tags (expand later)
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

  // If we can, capture a snippet for the marker itself
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
  // V4 v1: keep tools list short and deterministic
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
  // crude heuristics for required vs preferred
  const required: string[] = []
  const preferred: string[] = []

  for (const t of found) {
    // required marker near tool name
    const requiredMarkers = ["required", "must", "mandatory", "proficiency", "proficient", "strong proficiency"]
    const preferredMarkers = ["preferred", "a plus", "nice to have", "bonus", "plus"]

    // look in a small window around the tool mention
    const idx = jobTextNorm.indexOf(t)
    const window = idx >= 0 ? jobTextNorm.slice(Math.max(0, idx - 80), Math.min(jobTextNorm.length, idx + 120)) : ""

    const isReq = requiredMarkers.some((m) => window.includes(m))
    const isPref = preferredMarkers.some((m) => window.includes(m))

    if (isReq && !required.includes(t)) required.push(t)
    else if (isPref && !preferred.includes(t)) preferred.push(t)
    else {
      // default: preferred unless clearly required
      if (!preferred.includes(t) && !required.includes(t)) preferred.push(t)
    }
  }

  // normalize tool casing for UI consistency
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
      .replace("R", "R")
  }

  return {
    required_tools: required.map(normalizeTool),
    preferred_tools: preferred.map(normalizeTool),
  }
}

// -----------------------------
// Core: extractJobV4
// -----------------------------

function extractSection(raw: string, headingPatterns: RegExp[]): string | null {
  const text = raw || ""
  const lower = text.toLowerCase()

  // Find the first heading match
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

  // Stop at the next common heading
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

  // If no responsibilities section exists, fall back to full raw,
  // but we will still avoid obvious marketing + requirements lines in snippet selection.
  return {
    primary: responsibilities || raw,
    fallback: raw,
  }
}

export function extractJobV4(rawJobText: string): JobStructured {
  const raw = rawJobText || ""
  const jobTextNorm = normalize(raw)

  // Section hints (very light, but useful)
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

if (c.id === "CLUSTER_QA_TESTING") {
  const qaExplicit = [
    "qa",
    "quality assurance",
    "test case",
    "test plan",
    "regression",
    "bug",
    "defect",
    "uat",
    "validation testing",
    "software testing",
    "manual testing",
    "automated testing",
  ]
  const hasExplicitQA = qaExplicit.some((m) => jobTextNorm.includes(m))
  if (!hasExplicitQA) continue
}

    // Weight tier: hybrid of frequency + section awareness
    let weight_tier: WeightTier = "supporting"
    if (hits >= 3) weight_tier = "core"
    else if (hits === 2) weight_tier = "important"
    else weight_tier = "supporting"

    // Section-aware boost: if role has clear sections, single-hit items under section context are often important
    if (hasSections && hits === 1) {
      // conservative promotion
      weight_tier = "important"
    }

    // Confidence: bounded function of hits
    const confidence = clamp01(0.45 + Math.min(0.45, hits * 0.12))

    clusters.push({
      cluster_id: c.id,
      weight_tier,
      confidence,
      evidence_snippet: findEvidenceSnippet(raw, bestPhrase || (c.example_phrases?.[0] || "")),
    })
  }

  // Tools, analytical intensity, domain
  const tools = extractTools(jobTextNorm)
  const analytical_intensity = inferAnalyticalIntensity(jobTextNorm)
  const domain = inferDomain(jobTextNorm)

  // For V4 v1, eligibility is minimal. We can expand later.
  clusters.sort(
  (a, b) => b.confidence - a.confidence || a.cluster_id.localeCompare(b.cluster_id)
)

for (let i = 0; i < clusters.length; i++) {
  clusters[i].weight_tier = i < 2 ? "core" : "important"
}

const job: JobStructured = {
   // 1) confidence sort only (stable tie-breaker)
clusters,
    required_tools: tools.required_tools,
    preferred_tools: tools.preferred_tools,
    analytical_intensity,
    domain,
    eligibility: {
      location: {
        mode: jobTextNorm.includes("in-office") || jobTextNorm.includes("in person") ? "in_person"
          : jobTextNorm.includes("hybrid") ? "hybrid"
          : jobTextNorm.includes("remote") ? "remote"
          : "unknown",
      },
    },
  }

  return job
}