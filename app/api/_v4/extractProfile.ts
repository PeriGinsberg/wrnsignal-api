import { ProfileStructured, ProfileClusterProof, ExecLevel } from "./types"
import { TAXONOMY } from "./taxonomy"

// -----------------------------
// Helpers
// -----------------------------

function normalize(text: string): string {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim()
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
// Tools (deterministic dictionary)
// -----------------------------

function extractToolsFromResume(resumeNorm: string): string[] {
  // NOTE: keep list consistent with job extractor for UI stability
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
    "github",
    "git",
  ]

  // Special handling for single-letter "R" so we do not match random letters.
  const hasR =
    /\bskills?\b/.test(resumeNorm) && /\br\b/.test(resumeNorm) ? true : /\b(r language)\b/.test(resumeNorm)

  const found = toolsDict.filter((t) => resumeNorm.includes(t))
  if (hasR && !found.includes("r")) found.push("r")

  const normalizeTool = (t: string) => {
    if (t === "monday.com") return "Monday.com"
    if (t === "power bi") return "Power BI"
    if (t === "google sheets") return "Google Sheets"
    if (t === "google workspace") return "Google Workspace"
    if (t === "gsuite") return "GSuite"
    if (t === "sql") return "SQL"
    if (t === "github") return "GitHub"
    if (t === "git") return "Git"
    if (t === "r") return "R"
    return t
      .split(" ")
      .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ")
  }

  const uniq: string[] = []
  for (const t of found.map(normalizeTool)) {
    if (!uniq.includes(t)) uniq.push(t)
  }
  return uniq
}

// -----------------------------
// Grad extraction (best-effort)
// -----------------------------

function extractGrad(resumeText: string): { year?: number; month?: number } | undefined {
  const t = resumeText || ""

  const monthMap: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  }

  const monthYearRe =
    /\b(expected|anticipated)?\s*(graduation|grad|graduate|expected graduation)?\s*[:\-]?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/i

  const m1 = t.match(monthYearRe)
  if (m1) {
    const monthStr = normalize(m1[3])
    const year = Number(m1[4])
    const month = monthMap[monthStr]
    return { year, month }
  }

  // Year-only, only if graduation context nearby
  const norm = normalize(t)
  const idx = norm.search(/\b(expected|graduation|grad)\b/)
  if (idx >= 0) {
    const window = norm.slice(Math.max(0, idx - 120), Math.min(norm.length, idx + 260))
    const y = window.match(/\b(20\d{2})\b/)
    if (y) return { year: Number(y[1]) }
  }

  return undefined
}

// -----------------------------
// Evidence selection (lines + sentences)
// -----------------------------

function pickResumeEvidence(resumeText: string, phraseNorm: string): string {
  const raw = resumeText || ""

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  // For single-line or paragraph resumes, split into sentence-ish chunks too
  const sentences = raw
    .split(/(?<=[.!?;:])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const chunks = [...lines, ...sentences]

  const isBadChunk = (ln: string) =>
    includesAny(ln, [
      "education",
      "skills",
      "coursework",
      "certifications",
      "interests",
      "summary",
      "objective",
      "references",
      "available upon request",
    ])

  const looksLikeBullet = (s: string) => /^[-•*]\s+/.test(s)

  const dutyVerbs = [
    "built",
    "created",
    "developed",
    "analyzed",
    "modeled",
    "presented",
    "delivered",
    "implemented",
    "managed",
    "led",
    "supported",
    "assisted",
    "researched",
    "designed",
    "wrote",
    "drafted",
    "synthesized",
    "reported",
  ]

  const looksLikeExperience = (ln: string) =>
    looksLikeBullet(ln) || dutyVerbs.some((v) => ln.includes(v))

  // Pass 1: phrase match + experience-like
  for (const c of chunks) {
    const ln = normalize(c)
    if (isBadChunk(ln)) continue
    if (!phraseNorm) continue
    if (!ln.includes(phraseNorm)) continue
    if (!looksLikeExperience(ln)) continue
    return c.slice(0, 220)
  }

  // Pass 2: phrase match anywhere (still filtered)
  for (const c of chunks) {
    const ln = normalize(c)
    if (isBadChunk(ln)) continue
    if (!phraseNorm) continue
    if (!ln.includes(phraseNorm)) continue
    return c.slice(0, 220)
  }

  // Pass 3: first experience-like chunk
  for (const c of chunks) {
    const ln = normalize(c)
    if (isBadChunk(ln)) continue
    if (looksLikeExperience(ln)) return c.slice(0, 220)
  }

  return ""
}

// -----------------------------
// Exec-level heuristic (0–3)
// -----------------------------

function inferExecLevel(evidence: string): { level: ExecLevel; signals: string[] } {
  const ln = normalize(evidence)
  const signals: string[] = []

  if (!ln) return { level: 0, signals: [] }

  // Level 3: ownership/leadership scope
  const lvl3 = [
    "owned",
    "led",
    "managed",
    "directed",
    "launched",
    "responsible for",
    "accountable for",
    "strategy",
    "roadmap",
    "budget",
    "p&l",
  ]
  if (lvl3.some((p) => ln.includes(p))) {
    signals.push("ownership_or_leadership_language")
    if (/\b\d+(\.\d+)?%|\$\d+|\b\d+\b/.test(ln)) signals.push("quantified_impact")
    return { level: 3, signals }
  }

  // Level 2: independent execution / delivery
  const lvl2 = [
    "developed",
    "designed",
    "built",
    "created",
    "modeled",
    "analyzed",
    "presented",
    "delivered",
    "implemented",
    "recommendations",
    "client",
    "stakeholder",
  ]
  if (lvl2.some((p) => ln.includes(p))) {
    signals.push("independent_execution_or_delivery")
    if (/\b\d+(\.\d+)?%|\$\d+|\b\d+\b/.test(ln)) signals.push("quantified_impact")
    return { level: 2, signals }
  }

  // Level 1: support
  const lvl1 = ["supported", "assisted", "helped", "contributed", "collaborated"]
  if (lvl1.some((p) => ln.includes(p))) {
    signals.push("support_language")
    if (/\b\d+(\.\d+)?%|\$\d+|\b\d+\b/.test(ln)) signals.push("quantified_impact")
    return { level: 1, signals }
  }

  // Default: if we have evidence but it doesn't map cleanly, treat as level 1
  signals.push("evidence_present_low_specificity")
  return { level: 1, signals }
}

// -----------------------------
// Core: extractProfileV4
// -----------------------------

export function extractProfileV4(resumeText: string): ProfileStructured {
  const raw = resumeText || ""
  const resumeNorm = normalize(raw)

  const tools = extractToolsFromResume(resumeNorm)
  const grad = extractGrad(raw)

  const cluster_proof: ProfileClusterProof[] = []

  for (const c of TAXONOMY) {
    const idLower = (c.id || "").toLowerCase()

    // V4 v1: disable QA/testing clusters (avoid false positives until taxonomy stabilizes)
    if (idLower.includes("qa") || idLower.includes("test")) continue

    const phrases = (c.example_phrases || []).map((p) => normalize(p))

    let hits = 0
    let bestPhrase = ""
    let bestCt = 0

    for (const p of phrases) {
      const ct = countOccurrences(resumeNorm, p)
      if (ct > 0) {
        hits += ct
        if (ct > bestCt) {
          bestCt = ct
          bestPhrase = p
        }
      }
    }

    if (hits <= 0) continue

    const evidence_snippet = pickResumeEvidence(raw, bestPhrase || phrases[0] || "")
    const exec = inferExecLevel(evidence_snippet)

    const depth_signals = [
      hits >= 3 ? "repeated_signal" : "single_signal",
      evidence_snippet ? "evidence_found" : "no_evidence_line",
      ...(exec.signals || []),
    ]

    cluster_proof.push({
      cluster_id: c.id,
      exec_level: exec.level,
      depth_signals,
      evidence_snippet,
    })
  }

  // Stable sort: exec desc, then evidence present, then cluster_id
  cluster_proof.sort((a, b) => {
    if (b.exec_level !== a.exec_level) return b.exec_level - a.exec_level
    const ae = a.evidence_snippet ? 1 : 0
    const be = b.evidence_snippet ? 1 : 0
    if (be !== ae) return be - ae
    return a.cluster_id.localeCompare(b.cluster_id)
  })

  return {
    tools,
    grad,
    declared_targets: {
      role_families: [],
      industries: [],
      companies: [],
    },
    cluster_proof,
  }
}