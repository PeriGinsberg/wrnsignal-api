// src/exposure.ts
import { Exposure, JobSignalsV1, ProfileSignalsV1 } from "./types"

export function computeExposure(
  job: JobSignalsV1,
  profile: ProfileSignalsV1
): { exposure: Exposure; reason_codes: string[] } {
  const jobClusters = norm(job.responsibility_clusters ?? [])
  if (jobClusters.length === 0) {
    return { exposure: "NONE", reason_codes: ["WHY_EXPOSURE_NONE"] }
  }

  const executed = new Set(norm(profile.exposure_clusters?.executed ?? []))
  const adjacent = new Set(norm(profile.exposure_clusters?.adjacent ?? []))
  const theoretical = new Set(norm(profile.exposure_clusters?.theoretical ?? []))

  // 1) Direct executed overlap
  if (jobClusters.some((c) => executed.has(c))) {
    return { exposure: "EXECUTED", reason_codes: ["WHY_EXPOSURE_EXECUTED_MATCH"] }
  }

  // 2) Adjacent via direct adjacent overlap
  if (jobClusters.some((c) => adjacent.has(c))) {
    return { exposure: "ADJACENT", reason_codes: ["WHY_EXPOSURE_ADJACENT_MATCH"] }
  }

  // 3) Adjacent via cluster-to-cluster mapping
  // If job cluster is in a group and profile has ANY executed OR adjacent cluster in the same group -> ADJACENT
  const executedOrAdjacent = unionSets(executed, adjacent)
  if (jobClusters.some((jc) => hasMappedGroupOverlap(jc, executedOrAdjacent))) {
    return { exposure: "ADJACENT", reason_codes: ["WHY_EXPOSURE_ADJACENT_MAPPED"] }
  }

  // 4) Theoretical (direct)
  if (jobClusters.some((c) => theoretical.has(c))) {
    return { exposure: "THEORETICAL", reason_codes: ["WHY_EXPOSURE_THEORETICAL_MATCH"] }
  }

  // 5) Theoretical via mapping
  if (jobClusters.some((jc) => hasMappedGroupOverlap(jc, theoretical))) {
    return { exposure: "THEORETICAL", reason_codes: ["WHY_EXPOSURE_THEORETICAL_MAPPED"] }
  }

  return { exposure: "NONE", reason_codes: ["WHY_EXPOSURE_NONE"] }
}

/* ----------------------------- mapping ----------------------------- */

// Keep this small + deterministic. Regression expects marketing adjacency.
const CLUSTER_GROUPS: Record<string, string[]> = {
  marketing_execution: ["content creation", "campaign execution", "social analytics", "dashboards", "data analysis"],
  communication: ["executive communication", "writing", "presentation", "storytelling"],
  analytics: ["quantitative analysis", "data analysis", "social analytics", "dashboards"],
  project_delivery: ["structured problem solving", "light project management", "project ownership"],
  client_work: ["client facing", "client leadership", "stakeholder management"],
}

function hasMappedGroupOverlap(jobCluster: string, profileClusters: Set<string>): boolean {
  const group = groupFor(jobCluster)
  if (!group) return false
  const groupMembers = CLUSTER_GROUPS[group]
  return groupMembers.some((m) => profileClusters.has(m))
}

function groupFor(cluster: string): string | null {
  for (const [g, members] of Object.entries(CLUSTER_GROUPS)) {
    if (members.includes(cluster)) return g
  }
  return null
}

function unionSets(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>(a)
  for (const x of b) out.add(x)
  return out
}

function norm(xs: string[]): string[] {
  return xs.map((x) => (x || "").toLowerCase().trim()).filter(Boolean)
}