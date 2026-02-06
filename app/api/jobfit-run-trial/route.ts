import { createClient } from "@supabase/supabase-js"
import { runJobFit } from "../_lib/jobfitEvaluator"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

function jobTypeLabel(jobType: string | null | undefined) {
  const s = String(jobType || "").toLowerCase()
  if (s === "internship") return "Internship"
  if (s === "full_time" || s === "full-time" || s === "full time") return "Full-time job"
  return ""
}

function buildFallbackProfileText(args: {
  name?: string | null
  email: string
  jobType?: string | null
  targetRoles?: string | null
  targetLocations?: string | null
  timeline?: string | null
  resumeText?: string | null
}) {
  const jt = jobTypeLabel(args.jobType)
  return [
    args.name ? `Name: ${args.name}` : null,
    `Email: ${args.email}`,
    jt ? `Job Type: ${jt}` : null,
    `Target Roles: ${args.targetRoles || "N/A"}`,
    `Preferred Locations: ${args.targetLocations || "N/A"}`,
    `Timeline: ${args.timeline || "N/A"}`,
    ``,
    `Resume Text:`,
    args.resumeText || "N/A",
  ]
    .filter(Boolean)
    .join("\n")
    .trim()
}

export async function POST(req: Request) {
  try {
    // Optional protection
    const expectedKey = process.env.JOBFIT_INGEST_KEY
    if (expectedKey) {
      const got = req.headers.get("x-jobfit-key")
      if (got !== expectedKey) {
        return withCorsJson(req, { ok: false, error: "unauthorized" }, 401)
      }
    }

    const body = await req.json()

    const email = String(body.email ?? "").toLowerCase().trim()
    const job_description = String(body.job_description ?? "").trim()

    if (!email) {
      return withCorsJson(req, { ok: false, error: "missing_email" }, 400)
    }
    if (!job_description) {
      return withCorsJson(req, { ok: false, error: "missing_job_description" }, 400)
    }

    const supabaseUrl = process.env.SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      return withCorsJson(
        req,
        { ok: false, error: "server_misconfigured", detail: "Missing Supabase env vars" },
        500
      )
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // 1) Load trial user + credits
    const { data: user, error: userErr } = await supabase
      .from("jobfit_users")
      .select("id,email,credits_remaining")
      .eq("email", email)
      .maybeSingle()

    if (userErr) {
      return withCorsJson(req, { ok: false, error: userErr.message }, 500)
    }
    if (!user) {
      return withCorsJson(req, { ok: false, error: "no_profile_found" }, 404)
    }
    if ((user.credits_remaining ?? 0) <= 0) {
      return withCorsJson(req, { ok: false, error: "out_of_credits" }, 402)
    }

    // 2) Load profile data for evaluator context
    // Prefer profile_text, but keep a fallback while migrating.
    const { data: profile, error: profErr } = await supabase
      .from("jobfit_profiles")
      .select("name,job_type,profile_text,target_roles,target_locations,timeline,resume_text")
      .eq("user_id", user.id)
      .maybeSingle()

    if (profErr) {
      return withCorsJson(req, { ok: false, error: profErr.message }, 500)
    }
    if (!profile) {
      return withCorsJson(req, { ok: false, error: "missing_profile" }, 400)
    }

    const profileText =
      (profile.profile_text && String(profile.profile_text).trim()) ||
      buildFallbackProfileText({
        name: profile.name,
        email,
        jobType: profile.job_type,
        targetRoles: profile.target_roles,
        targetLocations: profile.target_locations,
        timeline: profile.timeline,
        resumeText: profile.resume_text,
      })

    // 3) Run Job Fit (shared evaluator)
    const result = await runJobFit({
      profileText,
      jobText: job_description,
    })

    // 4) Decrement credits AFTER successful evaluation
    const newCredits = (user.credits_remaining ?? 0) - 1
    const { error: creditErr } = await supabase
      .from("jobfit_users")
      .update({ credits_remaining: newCredits })
      .eq("id", user.id)

    if (creditErr) {
      return withCorsJson(req, { ok: false, error: creditErr.message }, 500)
    }

    return withCorsJson(req, { ok: true, credits_remaining: newCredits, result }, 200)
  } catch (err: any) {
    return withCorsJson(req, { ok: false, error: err?.message || String(err) }, 500)
  }
}



