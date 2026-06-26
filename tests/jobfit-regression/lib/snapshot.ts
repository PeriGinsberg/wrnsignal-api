// tests/jobfit-regression/lib/snapshot.ts
//
// v2 STRUCTURED SNAPSHOT + TIERED TOLERANT DIFF for the JobFit regression
// harness. This is the measuring instrument for the engine rebuild: the diff
// makes change READABLE at unit/match granularity and routes each change into
// a tier so expected drift is reported (not hard-failed) and structural change
// is flagged.
//
// SCHEMA VERSION: 2. The baseline file is a map of caseId -> CaseSnapshotV2.
// The checker refuses to diff a v1 baseline against v2 live snapshots and
// instructs a re-baseline (see regression-check.ts global version guard).
//
// TIERS
//   HARD (fail, exit 1): decision, gate type, per-match match_strength,
//     WHY/RISK code-set add/remove, ANY scalar-manifest change, match/unit
//     set add/remove, and ANY unclassified path (default-to-HARD so a new
//     field is never silently ignored).
//   SOFT (report, exit 0, threshold-banded): score, per-match weight,
//     per-match coverageScore, score_breakdown component points.

import type { WhyEvidenceMatch, RequirementCoverage } from "../../../app/api/jobfit/scoring"

// ── Snapshot shape ───────────────────────────────────────────────────────────

export type UnitSnapshot = {
  id: string
  key: string
  kind: string
  requiredness?: "core" | "supporting" // job (requirement) units only
  strength: number
  label: string
}

export type MatchSnapshot = {
  match_strength: string // "direct" | "adjacent" today; "direct"|"partial"|"gap" post-rebuild
  weight: number
  coverageScore: number
  match_kind: string
  match_key: string
  job_unit_key: string
  profile_unit_id: string
  is_core?: boolean // populated once the two-axis Match lands; absent today
}

export type WhySnapshot = {
  code: string
  weight: number
  match_strength: string
  match_key: string
}

export type RiskSnapshot = {
  code: string
  severity: string
  weight: number
}

export type ScalarManifest = {
  job: Record<string, unknown>
  profile: Record<string, unknown>
}

export type ScoreBreakdownSnapshot = {
  raw_score?: number
  clamped_score?: number
  components: Array<{ label: string; points: number; note: string }>
}

export type CaseSnapshotV2 = {
  schema_version: 2
  id: string
  label: string
  decision: string
  score: number
  gateType: string
  traceMissing: boolean // loud marker: true when result.engine_trace was absent
  requirement_units: UnitSnapshot[]
  profile_evidence_units: UnitSnapshot[]
  matches: MatchSnapshot[]
  why_codes: WhySnapshot[]
  risk_codes: RiskSnapshot[]
  scalars: ScalarManifest
  score_breakdown: ScoreBreakdownSnapshot
}

// Active alias — existing imports of `CaseSnapshot` keep resolving.
export type CaseSnapshot = CaseSnapshotV2

// ── Scalar capture (programmatic, denylist-filtered, deterministic) ──────────
//
// Capture ALL own-enumerable keys of job_signals / profile_signals MINUS the
// denylist, so scalars the rebuild adds are auto-captured. Entries are either
// top-level keys or dotted nested-leaf paths (e.g. "analytics.isLight").
const SCALAR_DENYLIST = new Set<string>([
  "requirement_units", // captured as its own array
  "profile_evidence_units", // captured as its own array
  "signal_debug", // engine debug, not a scalar
  "function_tag_evidence", // large evidence map
  "resumeText", // raw text / PII
  "profileHeaderText", // raw text
  "rawHash", // input hash, not a scalar signal
  "internship", // large nested JD-evidence object (CUT channel)
  "reportingSignals", // CUT channel
  "bachelorPreferred", // CUT channel
  "requiresAECExperience", // CUT channel
  "analytics.isLight", // CUT nested leaf (analytics.isHeavy is kept)
  "location.evidence", // free-text JD phrase; mode/city already carry the signal
])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function sortPrimitiveArray(arr: unknown[]): unknown[] {
  return [...arr].sort((a, b) => {
    const sa = String(a)
    const sb = String(b)
    return sa < sb ? -1 : sa > sb ? 1 : 0
  })
}

// Walk a signals object into a normalized plain object: keys sorted, primitive
// arrays sorted, denylisted keys/paths dropped, nested objects recursed.
function captureScalars(signals: any, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!isPlainObject(signals)) return out
  for (const key of Object.keys(signals).sort()) {
    const path = prefix ? `${prefix}.${key}` : key
    if (SCALAR_DENYLIST.has(key) || SCALAR_DENYLIST.has(path)) continue
    const v = signals[key]
    if (v === undefined) continue
    if (v === null) {
      out[key] = null
    } else if (Array.isArray(v)) {
      out[key] = v.every((e) => !isPlainObject(e) && !Array.isArray(e))
        ? sortPrimitiveArray(v)
        : v.map((e) => (isPlainObject(e) ? captureScalars(e, path) : e))
    } else if (isPlainObject(v)) {
      out[key] = captureScalars(v, path)
    } else {
      out[key] = v
    }
  }
  return out
}

// ── Canonical sort keys (stable baseline JSON + deterministic diff pairing) ──

// Full key for stable baseline-array ordering (deterministic JSON on disk).
function matchSortKey(m: MatchSnapshot): string {
  return `${m.match_key}|${m.job_unit_key}|${m.profile_unit_id}|${m.match_kind}|${m.match_strength}`
}
// Pairing identity for the diff: strength/kind EXCLUDED so a direct↔partial
// flip on the same evidence pair reads as one HARD field change, not add+remove.
function matchIdentity(m: MatchSnapshot): string {
  return `${m.match_key}|${m.job_unit_key}|${m.profile_unit_id}`
}
function unitSortKey(u: UnitSnapshot): string {
  return `${u.id}|${u.key}`
}
function whySortKey(w: WhySnapshot): string {
  return `${w.code}|${w.match_key}|${w.match_strength}|${w.weight}`
}
function riskSortKey(r: RiskSnapshot): string {
  return `${r.code}|${r.severity}|${r.weight}`
}
function sortBy<T>(items: T[], keyFn: (t: T) => string): T[] {
  return [...items].sort((a, b) => {
    const ka = keyFn(a)
    const kb = keyFn(b)
    return ka < kb ? -1 : ka > kb ? 1 : 0
  })
}

// ── toSnapshot ───────────────────────────────────────────────────────────────

function unitSnap(u: any, isJob: boolean): UnitSnapshot {
  const base: UnitSnapshot = {
    id: String(u?.id ?? ""),
    key: String(u?.key ?? ""),
    kind: String(u?.kind ?? ""),
    strength: Number(u?.strength ?? 0),
    label: String(u?.label ?? ""),
  }
  if (isJob && u?.requiredness !== undefined) base.requiredness = u.requiredness
  return base
}

export function toSnapshot(id: string, label: string, result: any): CaseSnapshotV2 {
  const job = result?.job_signals ?? {}
  const profile = result?.profile_signals ?? {}

  // engine_trace is the Step 1 opt-in field. Absent => loud marker, empty
  // matches (a mis-wired call must be visible, not silently zero-match).
  const trace = result?.engine_trace
  const traceMissing = !trace || !Array.isArray(trace.matches)
  const rawMatches: WhyEvidenceMatch[] = traceMissing ? [] : trace.matches

  const matches: MatchSnapshot[] = rawMatches.map((m: any) => {
    const snap: MatchSnapshot = {
      match_strength: String(m?.match_strength ?? ""),
      weight: Number(m?.weight ?? 0),
      coverageScore: Number(m?.coverageScore ?? 0),
      match_kind: String(m?.match_kind ?? ""),
      match_key: String(m?.match_key ?? ""),
      job_unit_key: String(m?.job_unit?.key ?? ""),
      profile_unit_id: String(m?.profile_unit?.id ?? ""),
    }
    if (m?.is_core !== undefined) snap.is_core = Boolean(m.is_core)
    return snap
  })

  const reqUnits: UnitSnapshot[] = Array.isArray(job.requirement_units)
    ? job.requirement_units.map((u: any) => unitSnap(u, true))
    : []
  const profUnits: UnitSnapshot[] = Array.isArray(profile.profile_evidence_units)
    ? profile.profile_evidence_units.map((u: any) => unitSnap(u, false))
    : []

  const whyCodes: WhySnapshot[] = (Array.isArray(result?.why_codes) ? result.why_codes : []).map(
    (w: any) => ({
      code: String(w?.code ?? ""),
      weight: Number(w?.weight ?? 0),
      match_strength: String(w?.match_strength ?? ""),
      match_key: String(w?.match_key ?? ""),
    })
  )
  const riskCodes: RiskSnapshot[] = (Array.isArray(result?.risk_codes) ? result.risk_codes : []).map(
    (r: any) => ({
      code: String(r?.code ?? ""),
      severity: String(r?.severity ?? ""),
      weight: Number(r?.weight ?? 0),
    })
  )

  const sb = result?.score_breakdown ?? {}
  const score_breakdown: ScoreBreakdownSnapshot = {
    components: Array.isArray(sb.components)
      ? sb.components.map((c: any) => ({
          label: String(c?.label ?? ""),
          points: Number(c?.points ?? 0),
          note: String(c?.note ?? ""),
        }))
      : [],
  }
  if (sb.raw_score !== undefined) score_breakdown.raw_score = Number(sb.raw_score)
  if (sb.clamped_score !== undefined) score_breakdown.clamped_score = Number(sb.clamped_score)

  return {
    schema_version: 2,
    id,
    label,
    decision: String(result?.decision ?? ""),
    score: Number(result?.score ?? 0),
    gateType: String(result?.gate_triggered?.type ?? "none"),
    traceMissing,
    requirement_units: sortBy(reqUnits, unitSortKey),
    profile_evidence_units: sortBy(profUnits, unitSortKey),
    matches: sortBy(matches, matchSortKey),
    why_codes: sortBy(whyCodes, whySortKey),
    risk_codes: sortBy(riskCodes, riskSortKey),
    scalars: { job: captureScalars(job), profile: captureScalars(profile) },
    score_breakdown,
  }
}

// ── Tiered diff ──────────────────────────────────────────────────────────────

export type DiffTier = "hard" | "soft"
export type SnapshotDiff = {
  tier: DiffTier
  kind: string
  path: string
  baseline: unknown
  live: unknown
  delta?: number
}

// SOFT tolerance bands. Deltas within the band are suppressed entirely;
// deltas outside are reported as SOFT (informational, non-failing).
export const BANDS = {
  score: 2,
  weight: 5,
  coverageScore: 5,
  breakdownPoints: 3,
} as const

const KNOWN_TOP_KEYS = new Set<string>([
  "schema_version",
  "id",
  "label",
  "decision",
  "score",
  "gateType",
  "traceMissing",
  "requirement_units",
  "profile_evidence_units",
  "matches",
  "why_codes",
  "risk_codes",
  "scalars",
  "score_breakdown",
])

function hard(kind: string, path: string, baseline: unknown, live: unknown): SnapshotDiff {
  return { tier: "hard", kind, path, baseline, live }
}

// SOFT numeric comparison: suppress within band, report (non-failing) outside.
// Non-finite or type-mismatched values fall through to HARD (unclassified).
function softNumeric(
  kind: string,
  path: string,
  b: unknown,
  l: unknown,
  band: number
): SnapshotDiff | null {
  const bn = Number(b)
  const ln = Number(l)
  if (!Number.isFinite(bn) || !Number.isFinite(ln)) {
    if (b === l) return null
    return hard("unclassified", path, b, l)
  }
  const delta = ln - bn
  if (Math.abs(delta) <= band) return null
  return { tier: "soft", kind, path, baseline: b, live: l, delta }
}

// Index a list by a key, appending #i for duplicate keys after a stable sort,
// so the i-th duplicate in baseline pairs with the i-th in live.
function indexByKey<T>(items: T[], keyFn: (t: T) => string): Map<string, T> {
  const counts = new Map<string, number>()
  const out = new Map<string, T>()
  for (const it of sortBy(items, keyFn)) {
    const base = keyFn(it)
    const n = counts.get(base) ?? 0
    counts.set(base, n + 1)
    out.set(n === 0 ? base : `${base}#${n}`, it)
  }
  return out
}

function flattenLeaves(obj: any, prefix: string, out: Map<string, unknown>): void {
  if (!isPlainObject(obj)) {
    out.set(prefix, obj)
    return
  }
  for (const key of Object.keys(obj).sort()) {
    const path = prefix ? `${prefix}.${key}` : key
    const v = (obj as any)[key]
    if (isPlainObject(v)) flattenLeaves(v, path, out)
    else out.set(path, v) // arrays + primitives + null compared as leaves
  }
}

function leafEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function diffScalars(b: ScalarManifest, l: ScalarManifest): SnapshotDiff[] {
  const out: SnapshotDiff[] = []
  const bl = new Map<string, unknown>()
  const ll = new Map<string, unknown>()
  flattenLeaves(b?.job ?? {}, "job", bl)
  flattenLeaves(b?.profile ?? {}, "profile", bl)
  flattenLeaves(l?.job ?? {}, "job", ll)
  flattenLeaves(l?.profile ?? {}, "profile", ll)
  const paths = new Set<string>([...bl.keys(), ...ll.keys()])
  for (const p of [...paths].sort()) {
    const has_b = bl.has(p)
    const has_l = ll.has(p)
    if (has_b && !has_l) out.push(hard("scalar_removed", `scalars.${p}`, bl.get(p), undefined))
    else if (!has_b && has_l) out.push(hard("scalar_added", `scalars.${p}`, undefined, ll.get(p)))
    else if (!leafEqual(bl.get(p), ll.get(p)))
      out.push(hard("scalar", `scalars.${p}`, bl.get(p), ll.get(p)))
  }
  return out
}

function diffMatches(b: MatchSnapshot[], l: MatchSnapshot[]): SnapshotDiff[] {
  const out: SnapshotDiff[] = []
  const bm = indexByKey(b, matchIdentity)
  const lm = indexByKey(l, matchIdentity)
  for (const id of new Set([...bm.keys(), ...lm.keys()])) {
    const x = bm.get(id)
    const y = lm.get(id)
    const path = `matches[${id}]`
    if (x && !y) {
      out.push(hard("match_removed", path, x, undefined))
    } else if (!x && y) {
      out.push(hard("match_added", path, undefined, y))
    } else if (x && y) {
      // Same evidence pair: compare the structural reads (HARD) + numerics (SOFT).
      if (x.match_strength !== y.match_strength)
        out.push(hard("match_strength", `${path}.match_strength`, x.match_strength, y.match_strength))
      if (x.match_kind !== y.match_kind)
        out.push(hard("match_kind", `${path}.match_kind`, x.match_kind, y.match_kind))
      if ((x.is_core ?? null) !== (y.is_core ?? null))
        out.push(hard("match_is_core", `${path}.is_core`, x.is_core ?? null, y.is_core ?? null))
      const w = softNumeric("match_weight", `${path}.weight`, x.weight, y.weight, BANDS.weight)
      if (w) out.push(w)
      const c = softNumeric(
        "match_coverageScore",
        `${path}.coverageScore`,
        x.coverageScore,
        y.coverageScore,
        BANDS.coverageScore
      )
      if (c) out.push(c)
    }
  }
  return out
}

function diffUnits(section: string, b: UnitSnapshot[], l: UnitSnapshot[]): SnapshotDiff[] {
  const out: SnapshotDiff[] = []
  const bm = indexByKey(b, (u) => u.id)
  const lm = indexByKey(l, (u) => u.id)
  for (const id of new Set([...bm.keys(), ...lm.keys()])) {
    const x = bm.get(id)
    const y = lm.get(id)
    const path = `${section}[${id}]`
    if (x && !y) out.push(hard("unit_removed", path, x, undefined))
    else if (!x && y) out.push(hard("unit_added", path, undefined, y))
    else if (x && y) {
      for (const f of ["key", "kind", "requiredness", "strength", "label"] as const) {
        if ((x as any)[f] !== (y as any)[f])
          out.push(hard("unit_field", `${path}.${f}`, (x as any)[f], (y as any)[f]))
      }
    }
  }
  return out
}

function diffWhy(b: WhySnapshot[], l: WhySnapshot[]): SnapshotDiff[] {
  const out: SnapshotDiff[] = []
  const key = (w: WhySnapshot) => `${w.code}|${w.match_key}`
  const bm = indexByKey(b, key)
  const lm = indexByKey(l, key)
  for (const id of new Set([...bm.keys(), ...lm.keys()])) {
    const x = bm.get(id)
    const y = lm.get(id)
    const path = `why[${id}]`
    if (x && !y) out.push(hard("why_removed", path, x, undefined))
    else if (!x && y) out.push(hard("why_added", path, undefined, y))
    else if (x && y) {
      if (x.match_strength !== y.match_strength)
        out.push(hard("why_match_strength", `${path}.match_strength`, x.match_strength, y.match_strength))
      const w = softNumeric("why_weight", `${path}.weight`, x.weight, y.weight, BANDS.weight)
      if (w) out.push(w)
    }
  }
  return out
}

function diffRisk(b: RiskSnapshot[], l: RiskSnapshot[]): SnapshotDiff[] {
  const out: SnapshotDiff[] = []
  // Identity = code (per spec). Duplicates paired by #i after canonical sort.
  const bm = indexByKey(b, (r) => r.code)
  const lm = indexByKey(l, (r) => r.code)
  for (const id of new Set([...bm.keys(), ...lm.keys()])) {
    const x = bm.get(id)
    const y = lm.get(id)
    const path = `risk[${id}]`
    if (x && !y) out.push(hard("risk_removed", path, x, undefined))
    else if (!x && y) out.push(hard("risk_added", path, undefined, y))
    else if (x && y) {
      if (x.severity !== y.severity)
        out.push(hard("risk_severity", `${path}.severity`, x.severity, y.severity))
      const w = softNumeric("risk_weight", `${path}.weight`, x.weight, y.weight, BANDS.weight)
      if (w) out.push(w)
    }
  }
  return out
}

function diffBreakdown(b: ScoreBreakdownSnapshot, l: ScoreBreakdownSnapshot): SnapshotDiff[] {
  const out: SnapshotDiff[] = []
  const rs = softNumeric("breakdown_raw_score", "score_breakdown.raw_score", b?.raw_score, l?.raw_score, BANDS.score)
  if (rs) out.push(rs)
  const cs = softNumeric(
    "breakdown_clamped_score",
    "score_breakdown.clamped_score",
    b?.clamped_score,
    l?.clamped_score,
    BANDS.score
  )
  if (cs) out.push(cs)
  // components paired by label; points = SOFT. `note` is intentionally NOT
  // diffed: it is a redundant projection of decision (HARD, compared above)
  // and penaltySum (reflected in points), so diffing it would double-flag.
  const bm = indexByKey(b?.components ?? [], (c) => c.label)
  const lm = indexByKey(l?.components ?? [], (c) => c.label)
  for (const id of new Set([...bm.keys(), ...lm.keys()])) {
    const x = bm.get(id)
    const y = lm.get(id)
    const path = `score_breakdown.components[${id}]`
    if (x && !y) out.push(hard("breakdown_component_removed", path, x, undefined))
    else if (!x && y) out.push(hard("breakdown_component_added", path, undefined, y))
    else if (x && y) {
      const p = softNumeric("breakdown_points", `${path}.points`, x.points, y.points, BANDS.breakdownPoints)
      if (p) out.push(p)
    }
  }
  return out
}

// Structured traversal (replaces the old static field-list compare). Returns
// every tiered diff between two same-version snapshots. A schema_version
// mismatch short-circuits to a single HARD diff (the checker also guards
// globally before calling this).
export function diffSnapshots(baseline: CaseSnapshotV2, live: CaseSnapshotV2): SnapshotDiff[] {
  if (baseline.schema_version !== live.schema_version) {
    return [hard("schema_version", "schema_version", baseline.schema_version, live.schema_version)]
  }
  const out: SnapshotDiff[] = []

  // Loud marker: engine_trace missing at snapshot time is a wiring failure.
  if (Boolean(baseline.traceMissing) !== Boolean(live.traceMissing))
    out.push(hard("trace_missing", "traceMissing", baseline.traceMissing, live.traceMissing))
  else if (live.traceMissing) out.push(hard("trace_missing", "traceMissing", true, true))

  // Top-level HARD scalars.
  if (baseline.decision !== live.decision)
    out.push(hard("decision", "decision", baseline.decision, live.decision))
  if (baseline.gateType !== live.gateType)
    out.push(hard("gateType", "gateType", baseline.gateType, live.gateType))

  // Top-level SOFT score.
  const s = softNumeric("score", "score", baseline.score, live.score, BANDS.score)
  if (s) out.push(s)

  // Unclassified-top-key guard: any key not handled above defaults to HARD.
  for (const k of new Set([...Object.keys(baseline), ...Object.keys(live)])) {
    if (!KNOWN_TOP_KEYS.has(k))
      out.push(hard("unclassified_top_key", k, (baseline as any)[k], (live as any)[k]))
  }

  out.push(...diffScalars(baseline.scalars, live.scalars))
  out.push(...diffMatches(baseline.matches, live.matches))
  out.push(...diffUnits("requirement_units", baseline.requirement_units, live.requirement_units))
  out.push(...diffUnits("profile_evidence_units", baseline.profile_evidence_units, live.profile_evidence_units))
  out.push(...diffWhy(baseline.why_codes, live.why_codes))
  out.push(...diffRisk(baseline.risk_codes, live.risk_codes))
  out.push(...diffBreakdown(baseline.score_breakdown, live.score_breakdown))

  return out
}

export function hasHardDiff(diffs: SnapshotDiff[]): boolean {
  return diffs.some((d) => d.tier === "hard")
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatSnapshot(s: CaseSnapshotV2): string {
  const pad = (v: string | number, n: number) => String(v).padEnd(n)
  const fam = String((s.scalars?.job as any)?.jobFamily ?? "")
  return (
    pad(s.id, 24) +
    " " +
    pad(s.decision, 16) +
    " score=" +
    pad(s.score, 4) +
    "m=" +
    pad(s.matches.length, 3) +
    "why=" +
    pad(s.why_codes.length, 3) +
    "risk=" +
    pad(s.risk_codes.length, 3) +
    pad(fam, 12)
  )
}

// One-line tiered diff line for the drift report.
export function formatDiff(d: SnapshotDiff): string {
  const arrow = `${JSON.stringify(d.baseline)} → ${JSON.stringify(d.live)}`
  if (d.tier === "soft" && typeof d.delta === "number") {
    const sign = d.delta > 0 ? "+" : ""
    return `[soft] ${d.path}: ${arrow} (Δ${sign}${d.delta})`
  }
  return `[HARD] ${d.path} (${d.kind}): ${arrow}`
}
