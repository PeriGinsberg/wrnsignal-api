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
    ].filter(Boolean).join("\n").trim()
}

function msSince(t0: number) {
    return Date.now() - t0
}

export async function POST(req: Request) {
    const t0 = Date.now()
    try {
        console.log("[jobfit-run-trial] start", { ms: msSince(t0) })

        const expectedKey = process.env.JOBFIT_INGEST_KEY
        if (expectedKey) {
            const got = req.headers.get("x-jobfit-key")
            if (got !== expectedKey) {
                return withCorsJson(req, { ok: false, error: "unauthorized" }, 401)
            }
        }

        const body = await req.json()
        const email = String(body.email ?? "").toLowerCase().trim()
        const jobText = String(body.job ?? body.job_description ?? "").trim()

        if (!email) return withCorsJson(req, { ok: false, error: "missing_email" }, 400)
        if (!jobText) return withCorsJson(req, { ok: false, error: "missing_job" }, 400)

        const supabaseUrl = process.env.SUPABASE_URL
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!supabaseUrl || !serviceRoleKey) {
            return withCorsJson(req, { ok: false, error: "server_misconfigured", detail: "Missing Supabase env vars" }, 500)
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey)

        // 1) Load trial user + credits
        const { data: user, error: userErr } = await supabase
            .from("jobfit_users")
            .select("id,email,credits_remaining")
            .eq("email", email)
            .maybeSingle()

        if (userErr) return withCorsJson(req, { ok: false, error: userErr.message }, 500)
        if (!user) return withCorsJson(req, { ok: false, error: "no_profile_found" }, 404)
        if ((user.credits_remaining ?? 0) <= 0) return withCorsJson(req, { ok: false, error: "out_of_credits" }, 402)

        // 2) Load profile data
        const { data: profile, error: profErr } = await supabase
            .from("jobfit_profiles")
            .select("name,job_type,profile_text,target_roles,target_locations,timeline,resume_text")
            .eq("user_id", user.id)
            .maybeSingle()

        if (profErr) return withCorsJson(req, { ok: false, error: profErr.message }, 500)
        if (!profile) return withCorsJson(req, { ok: false, error: "missing_profile" }, 400)

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

        // 3) Run full JobFit evaluator (shared with full-access)
        const result = await runJobFit({
            profileText,
            jobText,
        })

        // 4) Decrement trial credits
        const newCredits = (user.credits_remaining ?? 0) - 1
        const { error: creditErr } = await supabase
            .from("jobfit_users")
            .update({ credits_remaining: newCredits })
            .eq("id", user.id)

        if (creditErr) return withCorsJson(req, { ok: false, error: creditErr.message }, 500)

     // Track JobFit run
        try {
          await supabase.from("jobfit_page_views").insert({
            session_id: user.id,
            page_path: "/signal/jobfit",
            page_name: "jobfit_run_completed",
            utm_source: String(body.utm_source ?? "").trim() || null,
            utm_medium: String(body.utm_medium ?? "").trim() || null,
            utm_campaign: String(body.utm_campaign ?? "").trim() || null,
          })
        } catch {}

        return withCorsJson(req, { ok: true, credits_remaining: newCredits, result }, 200)
    } catch (err: any) {
        return withCorsJson(req, { ok: false, error: err?.message || String(err), ms: msSince(t0) }, 500)
    }
}