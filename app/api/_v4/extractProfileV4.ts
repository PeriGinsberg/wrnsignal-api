/* app/api/_v4/extractProfileV4.ts
   CLEAN REWRITE V5: deterministic, no async, Turbopack-safe
   Fixes:
   - sentence splitting (no-newline resumes)
   - inline Skills: stripping (and header poison blocking)
   - taxonomy adapter supports example_phrases
   - light fuzzy keyword matching (canon)
   - evidence dedupe: keep highest-ranked cluster, blank duplicates
   - deterministic cluster tie-break: FIN_MODELING > CLIENT_FACING > EXEC_PRESENTATION
   - dev-only logs (except module-load stamp)
*/

import { TAXONOMY } from "./taxonomy"
import type { ProfileStructured } from "./types"

export const PROFILE_V4_STAMP = "PROFILE_V4_STAMP__CLEAN_REWRITE_V5"

// Always log module-load stamp to prove which file is executing (Turbopack sanity)
console.log(`[extractProfileV4] loaded: ${PROFILE_V4_STAMP}`)

const DEV = process.env.NODE_ENV !== "production"

type AnyObj = Record<string, any>

type ClusterProof = {
    cluster_id: string
    exec_level: 0 | 1 | 2 | 3
    depth_signals: string[]
    evidence_snippet: string
}

/* ----------------------- deterministic cluster priority ----------------------- */
/** Higher number = higher priority when deduping identical evidence. */
const CLUSTER_PRIORITY: Record<string, number> = {
    CLUSTER_FIN_MODELING: 300,
    CLUSTER_CLIENT_FACING: 200,
    CLUSTER_EXEC_PRESENTATION: 100,
}

function priorityOf(clusterId: string): number {
    return CLUSTER_PRIORITY[clusterId] ?? 0
}

/* ----------------------- basics ----------------------- */

function isNonEmptyString(x: unknown): x is string {
    return typeof x === "string" && x.trim().length > 0
}

function norm(s: string): string {
    return s
        .replace(/\u00a0/g, " ")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .replace(/[“”]/g, '"')
        .replace(/[’]/g, "'")
        .replace(/\s+/g, " ")
        .trim()
}

/* ----------------------- segmentation ----------------------- */
/** Splits raw text into candidate “evidence units” deterministically. */
function toEvidenceUnits(resumeText: string): string[] {
    const raw = resumeText.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

    // First split on explicit newlines
    const baseLines = raw.split("\n").map(norm).filter(Boolean)

    const units: string[] = []
    for (const line of baseLines) {
        // Further split on sentence-ish boundaries and common separators
        // Deterministic: no NLP, no randomness
        const parts = line
            .split(/(?<=[.!?])\s+|[;|•]+/g)
            .map(norm)
            .filter(Boolean)
        for (const p of parts) units.push(p)
    }

    return units
}

function stripBulletPrefix(line: string): string {
    return line.replace(
        /^(\s*[\u2022\u25CF\u25A0\u25AA\u2219•\-\–\—\*]+|\s*\(?[0-9]+[.)]|\s*\(?[a-zA-Z][.)])\s+/,
        ""
    )
}

function isSectionHeader(line: string): boolean {
    const l = line.trim()
    if (/^[A-Z][A-Za-z &/]+:\s*$/.test(l)) return true
    if (
        /^(EXPERIENCE|EDUCATION|SKILLS|PROJECTS|LEADERSHIP|SUMMARY|CERTIFICATIONS|AWARDS|INTERESTS)\s*:?\s*$/i.test(
            l
        )
    )
        return true
    return false
}

function isSkillsLine(line: string): boolean {
    const l = line.trim()
    return /^skills\s*:/i.test(l) || /^technical skills\s*:/i.test(l)
}

function isHeaderPoison(line: string): boolean {
    if (isSectionHeader(line)) return true
    if (isSkillsLine(line)) return true
    return false
}

/** Remove inline poison like "... Skills: Excel, PowerPoint" by keeping only the left side. */
function stripInlineSkillsSegment(line: string): string {
    const idx = line.search(/\b(skills|technical skills)\s*:/i)
    if (idx < 0) return line
    return norm(line.slice(0, idx))
}

function cleanEvidenceUnit(rawUnit: string): string | null {
    if (!isNonEmptyString(rawUnit)) return null
    let line = norm(rawUnit)

    // Block pure header lines
    if (isHeaderPoison(line)) return null

    // Strip bullets
    line = norm(stripBulletPrefix(line))
    if (!line) return null

    // Remove leading section prefixes like "Experience:"
    line = line.replace(
        /^(experience|education|projects|leadership|summary|certifications|awards|interests)\s*:\s*/i,
        ""
    )
    line = norm(line)
    if (!line) return null

    // Strip inline Skills segment
    line = stripInlineSkillsSegment(line)
    if (!line) return null

    // If after stripping we ended up with a header or skills line, block it
    if (isHeaderPoison(line)) return null

    return line
}

/* ----------------------- exec level ----------------------- */

function inferExecLevel(evidence: string): 0 | 1 | 2 | 3 {
    const t = evidence.toLowerCase()

    const lvl3 =
        /\b(led|managed|owned|directed|strateg(y|ic)|roadmap|stakeholder|executive|vp|director|head of)\b/.test(t) ||
        /\b(budget|forecasting|p&l|hiring|performance reviews)\b/.test(t)
    if (lvl3) return 3

    const lvl2 =
        /\b(present(ed|ing)?|presentations?|client(s)?|customer(s)?|stakeholder(s)?|cross[-\s]?functional|partner(ed|ing)?)\b/.test(
            t
        ) || /\b(deliver(ed|ing)?|project managed|coordinat(ed|ing)?)\b/.test(t)
    if (lvl2) return 2

    const lvl1 =
        /\b(build|built|model|models|modeled|modeling|analy(z|s)e|analy(z|s)ed|research|researched|develop|developed|create|created|implement|implemented)\b/.test(
            t
        )
    if (lvl1) return 1

    return 0
}

/* ----------------------- taxonomy adapter ----------------------- */

function asObject(x: unknown): AnyObj | null {
    if (!x || typeof x !== "object") return null
    return x as AnyObj
}

function extractClusterArrayFromMap(mapObj: AnyObj): AnyObj[] {
    const out: AnyObj[] = []
    for (const [k, v] of Object.entries(mapObj)) {
        const vo = asObject(v)
        if (!vo) continue

        // Force cluster_id if missing
        if (!isNonEmptyString(vo.cluster_id) && !isNonEmptyString(vo.id) && !isNonEmptyString(vo.key)) {
            vo.cluster_id = k
        }
        out.push(vo)
    }
    return out
}

function getTaxonomyClusters(): AnyObj[] {
    const tx = asObject(TAXONOMY)
    if (!tx) return []

    // Case 1: TAXONOMY.clusters is an array
    if (Array.isArray(tx.clusters)) return tx.clusters as AnyObj[]

    // Case 2: TAXONOMY.clusters is a map keyed by cluster id
    if (tx.clusters && typeof tx.clusters === "object" && !Array.isArray(tx.clusters)) {
        return extractClusterArrayFromMap(tx.clusters as AnyObj)
    }

    // Case 3: TAXONOMY itself is a map keyed by cluster id
    const keys = Object.keys(tx)
    if (keys.length > 0) {
        const maybeAny = tx[keys[0]]
        if (maybeAny && typeof maybeAny === "object") {
            return extractClusterArrayFromMap(tx)
        }
    }

    return []
}

function flattenStringArray(x: unknown): string[] {
    if (!Array.isArray(x)) return []
    const out: string[] = []
    for (const v of x) {
        if (typeof v === "string") out.push(v)
    }
    return out
}

function flattenNestedKeywords(x: unknown): string[] {
    const o = asObject(x)
    if (!o) return []
    const out: string[] = []
    for (const val of Object.values(o)) {
        out.push(...flattenStringArray(val))
    }
    return out
}

function clusterId(cluster: AnyObj): string | null {
    const id = cluster.cluster_id ?? cluster.id ?? cluster.key ?? cluster.clusterId
    return isNonEmptyString(id) ? id.trim() : null
}

function clusterKeywords(cluster: AnyObj): string[] {
    const pools: unknown[] = [
        cluster.example_phrases, // ✅ YOUR TAXONOMY FIELD
        cluster.keywords,
        cluster.signals,
        cluster.terms,
        cluster.depth_terms,
        cluster.depthSignals,
        cluster.match_terms,
        cluster.matchTerms,
        cluster.phrases,
        cluster.patterns,
        cluster.includes,
    ]

    let kws: string[] = []
    for (const p of pools) {
        kws.push(...flattenStringArray(p))
        kws.push(...flattenNestedKeywords(p))
    }

    if (cluster.match && typeof cluster.match === "object") {
        const m = cluster.match as AnyObj
        kws.push(...flattenStringArray(m.keywords))
        kws.push(...flattenNestedKeywords(m.keywords))
        kws.push(...flattenStringArray(m.terms))
        kws.push(...flattenNestedKeywords(m.terms))
    }

    kws = kws.map(norm).filter(Boolean)
    return [...new Set(kws)].sort((a, b) => a.localeCompare(b))
}

/* ----------------------- deterministic light fuzzy matching ----------------------- */
/** Canonicalize for match: lowercase, strip punctuation, normalize plurals and common verb endings. */
function canon(s: string): string {
    const x = s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()

    const tokens = x.split(" ").map((t) => {
        if (t.endsWith("ing") && t.length > 5) return t.slice(0, -3)
        if (t.endsWith("ed") && t.length > 4) return t.slice(0, -2)
        if (t.endsWith("s") && t.length > 3) return t.slice(0, -1)
        return t
    })

    return tokens.join(" ")
}

function containsCanon(hay: string, needle: string): boolean {
    const H = canon(hay)
    const N = canon(needle)
    if (!N) return false
    return H.includes(N)
}

/* ----------------------- tools + grad ----------------------- */

function getToolsVocabulary(): string[] {
    const tx = asObject(TAXONOMY)
    const candidates: unknown[] = []
    candidates.push(tx?.tools)
    candidates.push(tx?.tool_terms)
    candidates.push(tx?.vocab?.tools)
    candidates.push(tx?.vocabulary?.tools)

    for (const c of candidates) {
        if (Array.isArray(c) && c.every((x) => typeof x === "string")) {
            return [...new Set((c as string[]).map(norm).filter(Boolean))].sort()
        }
    }

    // fallback deterministic list
    return [
        "Excel",
        "PowerPoint",
        "Google Sheets",
        "Tableau",
        "Power BI",
        "SQL",
        "Python",
        "R",
        "ArcGIS",
        "ArcGIS Pro",
        "AutoCAD",
        "Git",
        "GitHub",
        "Jira",
        "Figma",
        "Notion",
    ]
        .map(norm)
        .sort()
}

function toolRegex(tool: string): RegExp {
    const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i")
}

function extractTools(resumeText: string): Record<string, boolean> {
    const vocab = getToolsVocabulary()
    const out: Record<string, boolean> = {}
    const hay = ` ${resumeText.replace(/\s+/g, " ")} `

    for (const tool of vocab) {
        if (!tool) continue
        out[tool] = toolRegex(tool).test(hay)
    }
    return out
}

function extractGradBestEffort(resumeText: string): string | null {
    const text = resumeText
    const m =
        text.match(/\b(Expected\s*)?(Graduation|Graduate|Grad)\s*[:\-]?\s*(20\d{2})\b/i) ||
        text.match(/\b(Expected)\s*(20\d{2})\b/i) ||
        text.match(/\b(20\d{2})\b/i)
    if (!m) return null
    const yr = m.find((x) => /^\d{4}$/.test(x))
    return yr ?? null
}

/* ----------------------- cluster proof ----------------------- */

function buildClusterProof(linesClean: string[]): ClusterProof[] {
    const clusters = getTaxonomyClusters()

    if (DEV) console.log(`[extractProfileV4] clusters_detected=${clusters.length} lines_clean=${linesClean.length}`)
    if (DEV && linesClean.length > 0) console.log(`[extractProfileV4] sample_clean_line_0="${linesClean[0]}"`)

    if (clusters.length === 0) return []

    const proofs: ClusterProof[] = []

    for (let i = 0; i < clusters.length; i++) {
        const c = clusters[i]
        const id = clusterId(c)
        if (!id) continue

        const kws = clusterKeywords(c)
        if (kws.length === 0) continue

        let bestLineIdx = -1
        let bestHitCount = 0
        let bestSignals: string[] = []

        for (let li = 0; li < linesClean.length; li++) {
            const line = linesClean[li]

            const hits: string[] = []
            for (const kw of kws) {
                if (containsCanon(line, kw)) hits.push(kw)
            }

            if (hits.length > bestHitCount) {
                bestHitCount = hits.length
                bestLineIdx = li
                bestSignals = hits
            }
        }

        if (bestLineIdx >= 0 && bestHitCount > 0) {
            const evidence = linesClean[bestLineIdx]
            const exec = inferExecLevel(evidence)
            proofs.push({
                cluster_id: id,
                exec_level: exec,
                depth_signals: bestSignals,
                evidence_snippet: evidence,
            })
        }
    }

    if (DEV) console.log(`[extractProfileV4] cluster_proof_raw=${proofs.length}`)
    return proofs
}

function dedupeEvidenceKeepBest(proofs: ClusterProof[]): ClusterProof[] {
    const cloned: ClusterProof[] = proofs.map((p) => ({
        cluster_id: p.cluster_id,
        exec_level: p.exec_level,
        depth_signals: [...p.depth_signals],
        evidence_snippet: p.evidence_snippet,
    }))

    const groups = new Map<string, number[]>()
    for (let i = 0; i < cloned.length; i++) {
        const ev = norm(cloned[i].evidence_snippet)
        if (!ev) continue
        const arr = groups.get(ev) ?? []
        arr.push(i)
        groups.set(ev, arr)
    }

    for (const idxs of groups.values()) {
        if (idxs.length <= 1) continue

        const winner = idxs
            .slice()
            .sort((a, b) => {
                const A = cloned[a]
                const B = cloned[b]

                // 1) higher exec level wins
                if (B.exec_level !== A.exec_level) return B.exec_level - A.exec_level

                // 2) more depth signals wins
                if (B.depth_signals.length !== A.depth_signals.length)
                    return B.depth_signals.length - A.depth_signals.length

                // 3) explicit deterministic priority wins (FIN_MODELING > CLIENT_FACING > EXEC_PRESENTATION)
                const pA = priorityOf(A.cluster_id)
                const pB = priorityOf(B.cluster_id)
                if (pB !== pA) return pB - pA

                // 4) final deterministic tie-break
                return A.cluster_id.localeCompare(B.cluster_id)
            })[0]

        for (const idx of idxs) {
            if (idx === winner) continue
            cloned[idx].evidence_snippet = ""
        }
    }

    return cloned
}

export function extractProfileV4(resumeText: string): ProfileStructured {
    if (DEV) console.log(`[extractProfileV4] runtime stamp: ${PROFILE_V4_STAMP}`)

    const units = toEvidenceUnits(resumeText)

    const cleanLines: string[] = []
    for (const u of units) {
        const cleaned = cleanEvidenceUnit(u)
        if (cleaned) cleanLines.push(cleaned)
    }

    const tools = extractTools(resumeText)
    const grad = extractGradBestEffort(resumeText)

    const cluster_proof_raw = buildClusterProof(cleanLines)
    const cluster_proof = dedupeEvidenceKeepBest(cluster_proof_raw)

    const out: ProfileStructured = {
        // @ts-expect-error - defined in types.ts
        tools,
        // @ts-expect-error - best effort grad
        grad,
        cluster_proof,
    }

    return out
}