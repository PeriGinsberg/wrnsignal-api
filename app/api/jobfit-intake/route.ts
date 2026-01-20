import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-jobfit-key",
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() })
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
        return NextResponse.json(
          { ok: false, error: "unauthorized" },
          { status: 401, headers: corsHeaders() }
        )
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
    if (!name) {
      return NextResponse.json(
        { ok: false, error: "missing_name" },
        { status: 400, headers: corsHeaders() }
      )
    }
    if (!email) {
      return NextResponse.json(
        { ok: false, error: "missing_email" },
        { status: 400, headers: corsHeaders() }
      )
    }
    if (!job_type) {
      return NextResponse.json(
        { ok: false, error: "missing_job_type" },
        { status: 400, headers: corsHeaders() }
      )
    }
    if (!resume_text) {
      return NextResponse.json(
        { ok: false, error: "missing_resume_text" },
        { status: 400, headers: corsHeaders() }
      )
    }
    if (!target_roles) {
      return NextResponse.json(
        { ok: false, error: "missing_target_roles" },
        { status: 400, headers: corsHeaders() }
      )
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // 1) Upsert user by email
    const { data: user, error: userErr } = await supabase
      .from("jobfit_users")
      .upsert({ email }, { onConflict: "email" })
      .select("id,email,credits_remaining")
      .single()

    if (userErr) {
      return NextResponse.json(
        { ok: false, error: userErr.message },
        { status: 500, headers: corsHeaders() }
      )
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
      return NextResponse.json(
        { ok: false, error: profErr.message },
        { status: 500, headers: corsHeaders() }
      )
    }

    return NextResponse.json(
      { ok: true, user_id: user.id, credits_remaining: user.credits_remaining },
      { status: 200, headers: corsHeaders() }
    )
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || String(err) },
      { status: 500, headers: corsHeaders() }
    )
  }
}
