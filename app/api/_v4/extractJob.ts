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
 * 4) Evidence uniqueness:
 *    - Do NOT blank everything out. If a snippet is already used, pick next-best line for that cluster.
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
// Section extraction (responsibilities-first)
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

  // Stop at next common heading
  const stopHeadings = [
    /(^|\n)\s*(qualifications|requirements|education|about\s+us|about\s+the\s+company|who\s+we\s+are|equal\s+opportunity|eeo|benefits)\s*[:\n]/i,
    /(^|\n)\s*(responsibilities|what\s+you('|’)?ll\s+do|what\s+you\s+will\s+do|key\s+responsibilities|job\s+description\s+summary|job\s+summary|role\s+summary|position\s+summary)\s*[:\n]/i,
  ]

  let stopIdx = after.length
  for (const re of stopHeadings) {
    const m = re.exec(after)
    if (m && m.index >= 0) stopIdx = Math.min(stopIdx, m.index)
  }

  const section = after.slice(0, stopIdx).trim()
  return section.length ? section : null
}

function getEvidenceCorpus(raw: string): { duties: string; quals: string; full: string } {
  const duties =
    extractSection(raw, [
      /(^|\n)\s*(responsibilities|what\s+you('|’)?ll\s+do|what\s+you\s+will\s+do|key\s+responsibilities)\s*[:\n]/i,
    ]) || ""

  const quals =
    extractSection(raw, [
      /(^|\n)\s*(qualifications|requirements|education)\s*[:\n]/i,
    ]) || ""

  return { duties, quals, full: raw || "" }
}

// -----------------------------
// Evidence selection
// -----------------------------

function buildEvidenceLines(rawText: string): string[] {
  return (rawText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function isHeadingLine(line: string, dutyVerbs: string[]): boolean {
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

  if (ln.length <= 30 && (ln.includes("summary") || ln.includes("introduction") || ln.includes("overview"))) {
    return true
  }

  const hasSeasonOrTerm = /\b(summer|fall|spring|winter)\b/.test(ln) || /\b202\d\b/.test(ln)
  const looksLikeRoleTitle =
    /(intern|associate|analyst|coordinator|specialist|manager)\b/.test(ln) || /\([^)]*\)/.test(ln)
  const hasNoActionVerb = !dutyVerbs.some((v) => ln.includes(v))
  if (hasSeasonOrTerm && looksLikeRoleTitle && hasNoActionVerb && ln.length <= 110) return true

  return false
}

function isMarketingOrBenefits(ln: string): boolean {
  return includesAny(ln, [
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
}

function isRequirementLine(ln: string): boolean {
  return includesAny(ln, [
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
}

function looksLikeBullet(l: string): boolean {
  return /^[-•*]\s+/.test(l)
}

function pickEvidenceCandidates(
  corpus: { duties: string; quals: string; full: string },
  phrase: string
): string[] {
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

  const scan = (text: string, allowReq: boolean): string[] => {
    const lines = buildEvidenceLines(text)

    const filtered = lines.filter((line) => {
      const ln = normalize(line)
      if (isHeadingLine(line, dutyVerbs)) return false
      if (isMarketingOrBenefits(ln)) return false
      if (!allowReq && isRequirementLine(ln)) return false
      return true
    })

    // Match phrase first
    const phraseMatches = filtered.filter((line) => {
      const ln = normalize(line)
      if (!phraseNorm) return false
      if (!ln.includes(phraseNorm)) return false
      return true
    })

    // Prefer duty-ish lines when scanning duties
    const dutyish = phraseMatches
      .filter((line) => {
        const ln = normalize(line)
        return looksLikeBullet(line) || dutyVerbs.some((v) => ln.includes(v))
      })
      .map((x) => x.slice(0, 220))

    const anyPhrase = phraseMatches.map((x) => x.slice(0, 220))

    // Partial fallback (avoid tiny words)
    const parts = phraseNorm.split(" ").filter((p) => p.length >= 5)
    const partial = parts.length
      ? filtered
          .filter((line) => {
            const ln = normalize(line)
            return parts.some((p) => ln.includes(p))
          })
          .map((x) => x.slice(0, 220))
      : []

    // Final: first safe line (still filtered)
    const firstSafe = filtered.length ? [filtered[0].slice(0, 220)] : []

    // Order matters
    const all = [...dutyish, ...anyPhrase, ...partial, ...firstSafe]

    // De-dupe while preserving order
    const seen = new Set<string>()
    const out: string[] = []
    for (const s of all) {
      const k = normalize(s)
      if (!k) continue
      if (seen.has(k)) continue
      seen.add(k)
      out.push(s)
    }
    return out
  }

  // 1) duties phrase match (no requirements)
  const fromDuties = corpus.duties ? scan(corpus.duties, false) : []

  // 2) quals phrase match (requirements allowed)
  const fromQuals = corpus.quals ? scan(corpus.quals, true) : []

  // 3) full fallback (requirements allowed)
  const fromFull = scan(corpus.full, true)

  // Merge in order
  const merged: string[] = []
  const seen = new Set<string>()
  for (const arr of [fromDuties, fromQuals, fromFull]) {
    for (const s of arr) {
      const k = normalize(s)
      if (!k) continue
      if (seen.has(k)) continue
      seen.add(k)
      merged.push(s)
    }
  }

  return merged
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
  const strongMarkers = ["strong interest in", "passion for", "deep interest in", "must be passionate about"]
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

  // Special handling for "R" to avoid the ghost-R bug:
  // Only count R if it appears as a standalone token OR explicitly "R language".
  const hasR = /\br\b/.test(jobTextNorm) || /\br language\b/.test(jobTextNorm)
  if (hasR) found.push("r")

  const required: string[] = []
  const preferred: string[] = []

  for (const t of found) {
    const requiredMarkers = ["required", "must", "mandatory", "proficiency", "proficient", "strong proficiency"]
    const preferredMarkers = ["preferred", "a plus", "nice to have", "bonus", "plus"]

    const idx = jobTextNorm.indexOf(t === "r" ? " r " : t)
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
    if (t === "r") return "R"
    if (t === "monday.com") return "Monday.com"
    if (t === "power bi") return "Power BI"
    if (t === "google sheets") return "Google Sheets"
    if (t === "google workspace") return "Google Workspace"
    if (t === "gsuite") return "GSuite"
    if (t === "sql") return "SQL"
    return t
      .split(" ")
      .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ")
  }

  // De-dupe stable
  const dedupe = (arr: string[]) => {
    const out: string[] = []
    for (const x of arr.map(normalizeTool)) if (!out.includes(x)) out.push(x)
    return out
  }

  return {
    required_tools: dedupe(required),
    preferred_tools: dedupe(preferred),
  }
}

// -----------------------------
// Core: extractJobV4
// -----------------------------

export function extractJobV4(rawJobText: string): JobStructured {
  const raw = rawJobText || ""
  const jobTextNorm = normalize(raw)
  const corpus = getEvidenceCorpus(raw)

  const clusters: JobCluster[] = []

  for (const c of TAXONOMY) {
    const idLower = (c.id || "").toLowerCase()
    if (idLower.includes("qa") || idLower.includes("test")) continue

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

    const confidence = clamp01(0.45 + Math.min(0.45, hits * 0.12))

    // Initial tier (will be overwritten by top-2 cap later)
    let weight_tier: WeightTier = hits >= 3 ? "core" : hits === 2 ? "important" : "supporting"

    // Evidence candidates ordered best -> worst
    const candidates = pickEvidenceCandidates(
      corpus,
      bestPhrase || (c.example_phrases?.[0] || "")
    )

    clusters.push({
      cluster_id: c.id,
      weight_tier,
      confidence,
      evidence_snippet: candidates[0] || "",
    })
  }

  const tools = extractTools(jobTextNorm)
  const analytical_intensity = inferAnalyticalIntensity(jobTextNorm)
  const domain = inferDomain(jobTextNorm)

  // Sort by confidence DESC (stable tie-breaker)
  clusters.sort((a, b) => b.confidence - a.confidence || a.cluster_id.localeCompare(b.cluster_id))

  // Evidence uniqueness WITHOUT blanking everything:
  // If snippet already used, pick next-best candidate for that cluster.
  const used = new Set<string>()
  for (const cl of clusters) {
    const tax = TAXONOMY.find((t) => t.id === cl.cluster_id)
    const phrase = normalize((tax?.example_phrases?.[0] || ""))
    const candidates = pickEvidenceCandidates(corpus, phrase)

    let chosen = cl.evidence_snippet || ""
    let key = normalize(chosen)

    if (key && used.has(key)) {
      chosen = ""
      key = ""
      for (const cand of candidates) {
        const k = normalize(cand)
        if (!k) continue
        if (used.has(k)) continue
        chosen = cand
        key = k
        break
      }
    }

    cl.evidence_snippet = chosen
    if (key) used.add(key)
  }

  // LOCKED POLICY: top 2 core, all others important
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