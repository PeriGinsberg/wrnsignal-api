import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"

export async function OPTIONS(req: Request) {
  return corsOptionsResponse(req.headers.get("origin"))
}

function normalizeJobType(raw: any): "internship" | "full_time" | "" {
  const s = String(raw || "").trim().toLowerCase()
  if (s === "internship") return "internship"
  if (s === "full_time" || s === "full-time" || s === "full time") return "full_time"
  return ""
}

function buildProfileText(args: {
  name: string
  email: string
  jobType: "internship" | "full_time"
  targetRoles: string
  targetLocations: string
  timeline: string
  resumeText: string
}) {
  const jobTypeLabel = args.jobType === "internship" ? "Internship" : "Full-time job"

  return [
    `Name: ${args.name}`,
    `Email: ${args.email}`,
    `Job Type: ${jobTypeLabel}`,
    `Target Roles: ${args.targetRoles || "N/A"}`,
    `Preferred Locations: ${args.targetLocations || "N/A"}`,
    `Timeline: ${args.timeline || "N/A"}`,
    ``,
    `Resume Text:`,
    args.resumeText || "N/A",
  ].join("\n")
}

export async function POST(req: Request) {
  try {
    // Optional: basic key check (recommended). If env var not set, it won't block.
    const expectedKey = process.env.JOBFIT_INGEST_KEY
    if (expectedKey) {
      const got = req.headers.get("x-jobfit-key")
      if (got !== expectedKey) {
        return withCorsJson(req, { ok: false, error: "unauthorized" }, 401)
      }
    }

    const body = await req.json()

    const name = String(body.name ?? "").trim()
    const email = String(body.email ?? "").toLowerCase().trim()
    const job_type = normalizeJobType(body.job_type)

    const target_roles = String(body.target_roles ?? "").trim()
    const target_locations = String(body.target_locations ?? "").trim()
    const timeline = String(body.timeline ?? "").trim()
    const resume_text = String(body.resume_text ?? "").trim()

    // Required fields (match your UI)
    if (!name) return withCorsJson(req, { ok: false, error: "missing_name" }, 400)
    if (!email) return withCorsJson(req, { ok: false, error: "missing_email" }, 400)
    if (!job_type) return withCorsJson(req, { ok: false, error: "missing_job_type" }, 400)
    if (!resume_text) return withCorsJson(req, { ok: false, error: "missing_resume_text" }, 400)
    if (!target_roles) return withCorsJson(req, { ok: false, error: "missing_target_roles" }, 400)

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

    // 1) Upsert user by email
    const { data: user, error: userErr } = await supabase
      .from("jobfit_users")
      .upsert({ email }, { onConflict: "email" })
      .select("id,email,credits_remaining")
      .single()

    if (userErr) {
      return withCorsJson(req, { ok: false, error: userErr.message }, 500)
    }

    // 2) Build combined profile text for model quality
    const profile_text = buildProfileText({
      name,
      email,
      jobType: job_type,
      targetRoles: target_roles,
      targetLocations: target_locations,
      timeline,
      resumeText: resume_text,
    })

    // 3) Upsert profile 1:1 by user_id
    const { error: profErr } = await supabase
      .from("jobfit_profiles")
      .upsert(
        {
          user_id: user.id,
          email,
          name,
          job_type,
          target_roles,
          target_locations,
          timeline,
          resume_text,
          profile_text,
        },
        { onConflict: "user_id" }
      )

    if (profErr) {
      return withCorsJson(req, { ok: false, error: profErr.message }, 500)
    }

    return withCorsJson(
      req,
      { ok: true, user_id: user.id, credits_remaining: user.credits_remaining },
      200
    )
  } catch (err: any) {
    return withCorsJson(req, { ok: false, error: err?.message || String(err) }, 500)
  }
}



