// tests/jobfit-regression/lib/snapshot.ts
//
// Shared types and helpers for the regression baseline system.
//
// A CaseSnapshot captures the high-signal fields we care about for
// regression detection on a single JobFit evaluation. The baseline
// file (tests/jobfit-regression/baseline.json) is a map of case id
// to CaseSnapshot, and the regression checker compares live runs
// against it.
//
// We deliberately do NOT snapshot every field of the full result
// (e.g., exact weights, bullet text, individual WHY snippets) because
// those drift on every minor scoring change and would cause the
// baseline to be updated on every commit. The snapshot focuses on
// decision-grade signals: the final label, the score band, counts
// of direct proof and risks, and the family classification.

export type CaseSnapshot = {
  id: string
  label: string
  decision: string          // "Priority Apply" | "Apply" | "Review" | "Pass"
  score: number
  whyCount: number
  directWhyCount: number    // count of WHY codes with match_strength === "direct"
  riskCount: number
  highRiskCount: number     // count of RISK codes with severity === "high"
  jobFamily: string         // "Finance" | "Legal" | "Marketing" | etc.
  salesSubFamily?: string | null
  financeSubFamily?: string | null
  gateType?: string         // "none" | "force_pass" | "floor_review"
}

export function toSnapshot(
  id: string,
  label: string,
  result: any
): CaseSnapshot {
  const whyCodes = Array.isArray(result?.why_codes) ? result.why_codes : []
  const riskCodes = Array.isArray(result?.risk_codes) ? result.risk_codes : []
  return {
    id,
    label,
    decision: String(result?.decision ?? ""),
    score: Number(result?.score ?? 0),
    whyCount: whyCodes.length,
    directWhyCount: whyCodes.filter((w: any) => w?.match_strength === "direct").length,
    riskCount: riskCodes.length,
    highRiskCount: riskCodes.filter((r: any) => r?.severity === "high").length,
    jobFamily: String(result?.job_signals?.jobFamily ?? ""),
    salesSubFamily: result?.job_signals?.salesSubFamily ?? null,
    financeSubFamily: result?.job_signals?.financeSubFamily ?? null,
    gateType: result?.gate_triggered?.type ?? "none",
  }
}

export type SnapshotDiff = {
  id: string
  field: keyof CaseSnapshot
  baseline: unknown
  live: unknown
}

// Compare two snapshots and return any fields that differ. Only
// compares fields that exist in BOTH snapshots (so adding a new
// optional field to CaseSnapshot doesn't immediately fail all
// existing baselines).
export function diffSnapshots(
  baseline: CaseSnapshot,
  live: CaseSnapshot
): SnapshotDiff[] {
  const out: SnapshotDiff[] = []
  const fields: (keyof CaseSnapshot)[] = [
    "decision",
    "score",
    "whyCount",
    "directWhyCount",
    "riskCount",
    "highRiskCount",
    "jobFamily",
    "salesSubFamily",
    "financeSubFamily",
    "gateType",
  ]
  for (const f of fields) {
    const b = baseline[f] ?? null
    const l = live[f] ?? null
    if (b !== l) {
      out.push({ id: baseline.id, field: f, baseline: b, live: l })
    }
  }
  return out
}

// Format a snapshot as a single-line string for printing.
export function formatSnapshot(s: CaseSnapshot): string {
  const pad = (v: string | number, n: number) => String(v).padEnd(n)
  return (
    pad(s.id, 24) +
    " " +
    pad(s.decision, 16) +
    " score=" +
    pad(s.score, 4) +
    "why=" +
    s.whyCount +
    "(dir=" +
    s.directWhyCount +
    ") " +
    "risk=" +
    s.riskCount +
    "(hi=" +
    s.highRiskCount +
    ") " +
    pad(s.jobFamily, 12)
  )
}
