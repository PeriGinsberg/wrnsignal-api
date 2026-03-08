// src/matrix.ts
import { Alignment, Decision, Exposure } from "./types"

export function matrixDecision(alignment: Alignment, exposure: Exposure): Decision {
  // Baseline mapping only.
  // NOTE: Misalignment cap rule is handled elsewhere in the pipeline.
  if (alignment === "STRONG") {
    if (exposure === "EXECUTED") return "PRIORITY_APPLY"
    if (exposure === "ADJACENT") return "APPLY"
    if (exposure === "THEORETICAL") return "REVIEW"
    return "PASS"
  }

  if (alignment === "MODERATE") {
    if (exposure === "EXECUTED") return "APPLY"
    if (exposure === "ADJACENT") return "APPLY"
    if (exposure === "THEORETICAL") return "REVIEW"
    return "PASS"
  }

  if (alignment === "WEAK") {
    if (exposure === "EXECUTED") return "REVIEW"
    if (exposure === "ADJACENT") return "REVIEW"
    return "PASS" // THEORETICAL or NONE
  }

  // MISALIGNED row included for completeness, but cap rule is authoritative.
  if (exposure === "EXECUTED") return "REVIEW"
  if (exposure === "ADJACENT") return "REVIEW"
  return "PASS"
}