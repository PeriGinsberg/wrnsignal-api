// src/alignment.ts
import { Alignment, JobSignalsV1, ProfileSignalsV1 } from "./types"

console.log("ALIGNMENT_STAMP__2026_03_03__C")

// Prevent duplicate debug logs caused by evaluateJobFitV1 calling computeAlignment again.
const _debugPrinted = new Set<string>()

export function computeAlignment(
  job: JobSignalsV1,
  profile: ProfileSignalsV1
): { alignment: Alignment; reason_codes: string[] } {
  const jobFamilies = norm(job.role?.role_families ?? [])
  const targetFamilies = norm(profile.targets?.role_families ?? [])

  if (process.env.DEBUG_ALIGNMENT === "1") {
    const key = `${job.job_id}__${profile.profile_id}`
    if (!_debugPrinted.has(key)) {
      _debugPrinted.add(key)
      console.log("ALIGNMENT_DEBUG_INPUTS", { jobFamilies, targetFamilies })
    }
  }

  if (jobFamilies.length === 0 || targetFamilies.length === 0) {
    return { alignment: "WEAK", reason_codes: ["WHY_ALIGNMENT_INSUFFICIENT_DATA"] }
  }

  // 1) Exact overlap => STRONG
  if (intersects(jobFamilies, targetFamilies)) {
    return { alignment: "STRONG", reason_codes: ["WHY_ALIGNMENT_FAMILY_MATCH"] }
  }

  // 2) Adjacent overlap => MODERATE
  const adj = expandAdjacency(targetFamilies)
  if (intersects(jobFamilies, adj)) {
    return { alignment: "MODERATE", reason_codes: ["WHY_ALIGNMENT_ADJACENT_FAMILY_MATCH"] }
  }

  // 3) No match: WEAK by default, MISALIGNED only for "hard" cross-domain mismatches
  // IMPORTANT: Do NOT treat business vs marketing as MISALIGNED. Your regression expects WEAK.
  const jobDomain = inferDomain(jobFamilies)
  const targetDomain = inferDomain(targetFamilies)

  const hardDomains = new Set<Domain>(["finance", "tech", "health"])
  if (hardDomains.has(jobDomain) && hardDomains.has(targetDomain) && jobDomain !== targetDomain) {
    return { alignment: "MISALIGNED", reason_codes: ["WHY_ALIGNMENT_CROSS_DOMAIN"] }
  }

  return { alignment: "WEAK", reason_codes: ["WHY_ALIGNMENT_WEAK_NO_MATCH"] }
}

/* ----------------------------- helpers ----------------------------- */

function norm(xs: string[]): string[] {
  return xs.map((x) => (x || "").toLowerCase().trim()).filter(Boolean)
}

function intersects(a: string[], b: string[]): boolean {
  const setB = new Set(b)
  return a.some((x) => setB.has(x))
}

function expandAdjacency(targetFamilies: string[]): string[] {
  const out = new Set<string>(targetFamilies)

  for (const fRaw of targetFamilies) {
    const f = (fRaw || "").toLowerCase().trim()

    if (f === "consulting" || f === "strategy") {
      out.add("business analytics")
      out.add("data analytics")
      out.add("analytics")
      out.add("operations")
      out.add("product")
    }

    if (f === "business analytics" || f === "analytics" || f === "data analytics") {
      out.add("consulting")
      out.add("strategy")
      out.add("product")
      out.add("operations")
    }

    if (f === "product") {
      out.add("business analytics")
      out.add("analytics")
      out.add("strategy")
      out.add("operations")
    }
  }

  return Array.from(out)
}

type Domain = "business" | "marketing" | "finance" | "tech" | "health" | "unknown"

function inferDomain(families: string[]): Domain {
  const s = families.join(" ").toLowerCase()

  if (hasAny(s, ["consulting", "strategy", "analytics", "business analytics", "operations", "product"])) return "business"
  if (hasAny(s, ["marketing", "brand", "creative", "communications", "social"])) return "marketing"
  if (hasAny(s, ["finance", "investment", "banking", "accounting", "real estate"])) return "finance"
  if (hasAny(s, ["engineering", "software", "data science", "machine learning", "it", "developer"])) return "tech"
  if (hasAny(s, ["clinical", "health", "nursing", "medical", "patient"])) return "health"

  return "unknown"
}

function hasAny(hay: string, needles: string[]): boolean {
  return needles.some((n) => hay.includes(n))
}