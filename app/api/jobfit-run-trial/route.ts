// app/api/jobfit-run-trial/route.ts
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

function msSince(t0: number) {
  return Date.now() - t0
}

export async function POST(req: Request) {
  const t0 = Date.now()

  try {
    console.log("[jobfit-run-trial] start", { ms: msSince(t0) })

    // Optional protection
    const expectedKey = process.env.JOBFIT_INGEST_KEY
    if (expectedKey) {
      const got = req.headers.get("x-jobfit-key")
      if (got !== expectedKey) {
        console.warn("[jobfit-run-trial] unauthorized", { ms: msSince(t0) })
        return withCorsJson(req, { ok: false, error: "unauthorized" }, 401)
      }
    }

    // Parse request body first (do not reference fields before this)
    const body = await req.json()

    const email = String(body.email ?? "").toLowerCase().trim()
    const job_description = String(body.job_description ?? "").trim()

    console.log("[jobfit-run-trial] parsed request", {
      email_present: Boolean(email),
      job_len: job_description.length,
      ms: msSince(t0),
    })

    if (!email) {
      return withCorsJson(req, { ok: false, error: "missing_email" }, 400)
    }
    if (!job_description) {
      return withCorsJson(req, { ok: false, error: "missing_job_description" }, 400)
    }

    const supabaseUrl = process.env.SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[jobfit-run-trial] missing supabase env", { ms: msSince(t0) })
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

    console.log("[jobfit-run-trial] loaded user", { found: Boolean(user), ms: msSince(t0) })

    if (userErr) {
      console.error("[jobfit-run-trial] user query error", { error: userErr.message, ms: msSince(t0) })
      return withCorsJson(req, { ok: false, error: userErr.message }, 500)
    }
    if (!user) {
      return withCorsJson(req, { ok: false, error: "no_profile_found" }, 404)
    }
    if ((user.credits_remaining ?? 0) <= 0) {
      return withCorsJson(req, { ok: false, error: "out_of_credits" }, 402)
    }

    // 2) Load profile data for evaluator context
    const { data: profile, error: profErr } = await supabase
      .from("jobfit_profiles")
      .select("name,job_type,profile_text,target_roles,target_locations,timeline,resume_text")
      .eq("user_id", user.id)
      .maybeSingle()

    console.log("[jobfit-run-trial] loaded profile", { found: Boolean(profile), ms: msSince(t0) })

    if (profErr) {
      console.error("[jobfit-run-trial] profile query error", { error: profErr.message, ms: msSince(t0) })
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
    console.log("[jobfit-run-trial] calling runJobFit", {
      profile_len: profileText.length,
      job_len: job_description.length,
      ms: msSince(t0),
    })

    const result = await runJobFit({
      profileText,
      jobText: job_description,
    })

    console.log("[jobfit-run-trial] runJobFit returned", {
      decision: result?.decision,
      ms: msSince(t0),
    })

    // 4) Decrement credits AFTER successful evaluation
    const newCredits = (user.credits_remaining ?? 0) - 1
    const { error: creditErr } = await supabase
      .from("jobfit_users")
      .update({ credits_remaining: newCredits })
      .eq("id", user.id)

    console.log("[jobfit-run-trial] credits updated", { newCredits, ms: msSince(t0) })

    if (creditErr) {
      console.error("[jobfit-run-trial] credit update error", { error: creditErr.message, ms: msSince(t0) })
      return withCorsJson(req, { ok: false, error: creditErr.message }, 500)
    }

    return withCorsJson(req, { ok: true, credits_remaining: newCredits, result }, 200)
  } catch (err: any) {
    console.error("[jobfit-run-trial] unhandled", { error: err?.message || String(err), ms: msSince(t0) })
    return withCorsJson(req, { ok: false, error: err?.message || String(err) }, 500)
  }
}
