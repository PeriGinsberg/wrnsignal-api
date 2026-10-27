// The suggestion fields a supporter may set, read and trimmed in one place for
// the create and the edit. Anything else in the body is ignored.

export type SuggestionFields = {
  company_name?: string
  job_title?: string
  job_url?: string
  location?: string
  note?: string
}

const LIMITS: Record<keyof SuggestionFields, number> = {
  company_name: 200,
  job_title: 200,
  job_url: 2000,
  location: 200,
  note: 2000,
}

export function readSuggestionFields(
  body: any,
  opts: { requireAll: boolean },
): { ok: true; values: SuggestionFields } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid JSON body" }
  const values: SuggestionFields = {}
  for (const key of Object.keys(LIMITS) as (keyof SuggestionFields)[]) {
    if (body[key] === undefined) continue
    values[key] = String(body[key] ?? "").trim().slice(0, LIMITS[key])
  }
  for (const key of ["company_name", "job_title"] as const) {
    if ((opts.requireAll || values[key] !== undefined) && !values[key]) {
      return { ok: false, error: key === "company_name" ? "Company is required." : "Job title is required." }
    }
  }
  if (values.job_url && !/^https?:\/\//i.test(values.job_url)) {
    return { ok: false, error: "The job link should start with http:// or https://" }
  }
  return { ok: true, values }
}
