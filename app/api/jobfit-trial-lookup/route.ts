// app/api/jobfit-trial-lookup/route.ts
import { createClient } from "@supabase/supabase-js"
import { corsOptionsResponse, withCorsJson } from "../_lib/cors"

export const runtime = "nodejs"

export async function OPTIONS(req: Request) {
    return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: Request) {
    try {
        const expectedKey = process.env.JOBFIT_INGEST_KEY
        if (expectedKey) {
            const got = req.headers.get("x-jobfit-key")
            if (got !== expectedKey) {
                return withCorsJson(req, { ok: false, error: "unauthorized" }, 401)
            }
        }

        const body = await req.json()
        const email = String(body.email ?? "").toLowerCase().trim()

        if (!email) {
            return withCorsJson(req, { ok: false, error: "missing_email" }, 400)
        }

        const supabaseUrl = process.env.SUPABASE_URL
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !serviceRoleKey) {
            return withCorsJson(
                req,
                { ok: false, error: "server_misconfigured" },
                500
            )
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey)

        const { data: user, error } = await supabase
            .from("jobfit_users")
            .select("id,email,credits_remaining")
            .eq("email", email)
            .maybeSingle()

        if (error) {
            return withCorsJson(req, { ok: false, error: error.message }, 500)
        }

        if (!user) {
            return withCorsJson(req, { ok: false, error: "not_found" }, 404)
        }

        return withCorsJson(
            req,
            {
                ok: true,
                email: user.email,
                credits_remaining: user.credits_remaining,
            },
            200
        )
    } catch (err: any) {
        return withCorsJson(
            req,
            { ok: false, error: err?.message || String(err) },
            500
        )
    }
}