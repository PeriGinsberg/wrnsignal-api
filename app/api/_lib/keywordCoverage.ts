// /_lib/keywordCoverage.ts
export type KeywordHit = {
  phrase: string
  weight: number
  freq: number
  section: "required" | "preferred" | "responsibilities" | "other"
  hit_in_bullets: boolean
}

export type CoverageResult = {
  coverage: number // 0..1
  total_weight: number
  hit_weight: number
  keywords: KeywordHit[]
  missing_top: { phrase: string; weight: number }[]
}

const STOPWORDS = new Set([
  "and","or","the","a","an","to","of","in","for","on","with","as","at","by","from","is","are","was","were",
  "be","being","been","this","that","these","those","you","your","we","our","they","their","will","can","may",
  "ability","strong","excellent","skills","experience","required","preferred","plus","including","etc",
  "fast-paced","self-starter","team","player"
])

function normalizeText(s: string) {
  return s
    .toLowerCase()
    .replace(/[^\w\s+/#.-]/g, " ") // keep things like c++, c#, sql, node.js-ish tokens
    .replace(/\s+/g, " ")
    .trim()
}

function splitSections(jobText: string) {
  const t = jobText
  const lower = jobText.toLowerCase()

  // naive section splits. Deterministic and good enough.
  const markers = [
    { key: "required", patterns: ["required", "must have", "minimum qualifications", "requirements"] },
    { key: "preferred", patterns: ["preferred", "nice to have", "bonus", "preferred qualifications"] },
    { key: "responsibilities", patterns: ["responsibilities", "what you will do", "what you’ll do", "duties"] },
  ] as const

  const idxs: { key: (typeof markers)[number]["key"]; idx: number }[] = []
  for (const m of markers) {
    for (const p of m.patterns) {
      const i = lower.indexOf(p)
      if (i >= 0) idxs.push({ key: m.key, idx: i })
    }
  }

  if (idxs.length === 0) {
    return { required: "", preferred: "", responsibilities: "", other: t }
  }

  idxs.sort((a, b) => a.idx - b.idx)

  const chunks: Record<string, string> = { required: "", preferred: "", responsibilities: "", other: "" }
  for (let i = 0; i < idxs.length; i++) {
    const start = idxs[i].idx
    const end = i + 1 < idxs.length ? idxs[i + 1].idx : t.length
    chunks[idxs[i].key] += "\n" + t.slice(start, end)
  }

  // anything before first marker goes into other
  const first = idxs[0].idx
  if (first > 0) chunks.other = t.slice(0, first)

  return chunks as { required: string; preferred: string; responsibilities: string; other: string }
}

function tokenFreq(text: string) {
  const t = normalizeText(text)
  const tokens = t.split(" ").filter(Boolean)
  const freq = new Map<string, number>()
  for (const w of tokens) {
    if (w.length < 2) continue
    if (STOPWORDS.has(w)) continue
    freq.set(w, (freq.get(w) ?? 0) + 1)
  }
  return freq
}

function ngramFreq(text: string, n: number) {
  const t = normalizeText(text)
  const tokens = t.split(" ").filter(Boolean).filter(w => w.length >= 2 && !STOPWORDS.has(w))
  const freq = new Map<string, number>()
  for (let i = 0; i + n <= tokens.length; i++) {
    const gram = tokens.slice(i, i + n).join(" ")
    // drop grams that are all generic words
    if (gram.split(" ").every(w => STOPWORDS.has(w))) continue
    freq.set(gram, (freq.get(gram) ?? 0) + 1)
  }
  return freq
}

function mergeFreqMaps(maps: Map<string, number>[]) {
  const out = new Map<string, number>()
  for (const m of maps) {
    for (const [k, v] of m.entries()) out.set(k, (out.get(k) ?? 0) + v)
  }
  return out
}

function sectionMultiplier(section: KeywordHit["section"]) {
  if (section === "required") return 1.6
  if (section === "responsibilities") return 1.3
  if (section === "preferred") return 1.15
  return 1.0
}

function phraseMultiplier(phrase: string) {
  const words = phrase.split(" ").length
  if (words >= 2 && words <= 4) return 1.25
  return 1.0
}

function weight(freq: number, section: KeywordHit["section"], phrase: string) {
  // w_k = log(1 + f_k) * section_multiplier * phrase_multiplier
  const w = Math.log(1 + freq) * sectionMultiplier(section) * phraseMultiplier(phrase)
  return Number.isFinite(w) ? w : 0
}

function containsPhrase(haystack: string, phrase: string) {
  const h = normalizeText(haystack)
  const p = normalizeText(phrase)
  // word-boundary-ish match
  return h.includes(p)
}

/**
 * Extract top job phrases and compute bullet coverage against resume bullets.
 * Deterministic and stable by construction.
 */
export function computeKeywordCoverage(jobTextRaw: string, resumeBulletsRaw: string, options?: {
  max_keywords?: number
  missing_top_n?: number
}) : CoverageResult {
  const maxKeywords = options?.max_keywords ?? 30
  const missingTopN = options?.missing_top_n ?? 8

  const sections = splitSections(jobTextRaw)

  // build candidate phrases per section
  const sectionPhrases: { section: KeywordHit["section"]; freq: Map<string, number> }[] = [
    { section: "required", freq: mergeFreqMaps([tokenFreq(sections.required), ngramFreq(sections.required, 2), ngramFreq(sections.required, 3)]) },
    { section: "preferred", freq: mergeFreqMaps([tokenFreq(sections.preferred), ngramFreq(sections.preferred, 2), ngramFreq(sections.preferred, 3)]) },
    { section: "responsibilities", freq: mergeFreqMaps([tokenFreq(sections.responsibilities), ngramFreq(sections.responsibilities, 2), ngramFreq(sections.responsibilities, 3)]) },
    { section: "other", freq: mergeFreqMaps([tokenFreq(sections.other), ngramFreq(sections.other, 2)]) },
  ]

  // score candidates
  const candidates: KeywordHit[] = []
  for (const s of sectionPhrases) {
    for (const [phrase, freq] of s.freq.entries()) {
      // remove overly generic single words
      if (phrase.length < 3) continue
      if (STOPWORDS.has(phrase)) continue
      const w = weight(freq, s.section, phrase)
      if (w <= 0) continue
      candidates.push({
        phrase,
        freq,
        weight: w,
        section: s.section,
        hit_in_bullets: false,
      })
    }
  }

  // dedupe by phrase, keep max weight
  const dedup = new Map<string, KeywordHit>()
  for (const c of candidates) {
    const prev = dedup.get(c.phrase)
    if (!prev || c.weight > prev.weight) dedup.set(c.phrase, c)
  }

  // take top N by weight
  const keywords = Array.from(dedup.values())
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxKeywords)

  // compute hits against resume bullets text
  for (const k of keywords) {
    k.hit_in_bullets = containsPhrase(resumeBulletsRaw, k.phrase)
  }

  const total_weight = keywords.reduce((s, k) => s + k.weight, 0)
  const hit_weight = keywords.reduce((s, k) => s + (k.hit_in_bullets ? k.weight : 0), 0)
  const coverage = total_weight > 0 ? hit_weight / total_weight : 0

  const missing_top = keywords
    .filter(k => !k.hit_in_bullets)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, missingTopN)
    .map(k => ({ phrase: k.phrase, weight: k.weight }))

  return { coverage, total_weight, hit_weight, keywords, missing_top }
}
