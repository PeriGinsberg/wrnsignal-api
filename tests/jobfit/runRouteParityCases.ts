import fs from "fs"
import path from "path"
import { evaluateJobFit } from "../../app/api/jobfit/evaluator.ts"
import { extractProfileV4 } from "../../app/api/_v4/extractProfileV4"
import { enforceClientFacingRules } from "../../app/api/jobfit/enforceClientFacingRules"

type ParityCase = {
  id: string
  label?: string
  profile: {
    profile_text: string
    resume_text: string
    profile_structured?: any | null
    target_roles?: string | null
    target_locations?: string | null
    preferred_locations?: string | null
    timeline?: string | null
    job_type?: string | null
    risk_overrides?: any
  }
  jobText: string
}

async function main() {
  const casesDir = path.join(process.cwd(), "tests", "jobfit", "route_parity_cases")
  const outFile = path.join(process.cwd(), "tests", "jobfit", "results", "route_parity_results.json")

  const files = fs
    .readdirSync(casesDir)
    .filter((f) => f.endsWith(".json"))
    .sort()

  const results: any[] = []

  for (const file of files) {
    const fullPath = path.join(casesDir, file)
    const tc = JSON.parse(fs.readFileSync(fullPath, "utf8")) as ParityCase

    const profileStructuredResolved =
      tc.profile.profile_structured ?? extractProfileV4(tc.profile.profile_text || "")

    const resultRaw = await evaluateJobFit({
      jobText: tc.jobText || "",
      profileText: tc.profile.profile_text || "",
      resumeText: tc.profile.resume_text || "",
      profileStructured: profileStructuredResolved ?? null,
      targetRoles: tc.profile.target_roles ?? "",
      preferredLocations: tc.profile.preferred_locations ?? tc.profile.target_locations ?? "",
      targetLocations: tc.profile.target_locations ?? "",
      timeline: tc.profile.timeline ?? "",
      jobType: tc.profile.job_type ?? "",
      constraints:
        typeof tc.profile.risk_overrides === "string"
          ? tc.profile.risk_overrides
          : JSON.stringify(tc.profile.risk_overrides ?? {}),
      extraContext: ""
    })

    const result = enforceClientFacingRules(resultRaw as any)

    results.push({
      id: tc.id,
      label: tc.label ?? null,
      score: result?.score ?? null,
      decision_final: result?.decision ?? null,
      why_bullets_joined: Array.isArray(result?.bullets) ? result.bullets.join(" | ") : "",
      risk_bullets_joined: Array.isArray(result?.risk_flags) ? result.risk_flags.join(" | ") : "",
      raw: result
    })
  }

  fs.writeFileSync(outFile, JSON.stringify(results, null, 2))
  console.log(`Wrote ${results.length} route parity results to ${outFile}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
