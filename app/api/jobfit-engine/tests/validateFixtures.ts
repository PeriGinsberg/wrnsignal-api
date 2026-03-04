import cases from "./regressionCases.json"
import { JOBS, PROFILES } from "./fixtures"

function assert(cond: any, msg: string) {
  if (!cond) throw new Error(msg)
}

function main() {
  const cs = cases as any[]
  let checked = 0

  for (const c of cs) {
    const p = (PROFILES as any)[c.profile_id]
    const j = (JOBS as any)[c.job_id]

    assert(p, `Missing profile fixture for ${c.profile_id} (case ${c.case_id})`)
    assert(j, `Missing job fixture for ${c.job_id} (case ${c.case_id})`)

    assert(typeof j.normalized?.title === "string" && j.normalized.title.trim().length > 0,
      `Job ${c.job_id} missing normalized.title`)

    assert(Array.isArray(j.role?.role_families),
      `Job ${c.job_id} missing role.role_families`)

    assert(Array.isArray(j.responsibility_clusters),
      `Job ${c.job_id} missing responsibility_clusters`)

    assert(
      p.profile_type === "student" ||
      p.profile_type === "early_career" ||
      p.profile_type === "experienced" ||
      p.profile_type === "unknown",
      `Profile ${c.profile_id} invalid profile_type=${p.profile_type}`
    )

    assert(Array.isArray(p.exposure_clusters?.executed),
      `Profile ${c.profile_id} missing exposure_clusters.executed`)

    // Experience explicit sanity check
    const min = j.requirements?.experience?.min_years
    const explicit = j.requirements?.experience?.is_explicit

    if (min == null || min === 0) {
      assert(explicit === false,
        `Job ${c.job_id} has min_years=${min} but is_explicit=true`)
    }

    checked++
  }

  console.log(`[validateFixtures] OK: checked ${checked} cases`)
}

main()