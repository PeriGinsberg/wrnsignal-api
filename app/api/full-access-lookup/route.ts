import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function corsHeaders(origin?: string | null) {
    return {
        "Access-Control-Allow-Origin": origin || "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }
}

export async function OPTIONS(req: Request) {
    const origin = req.headers.get("origin")
    return new NextResponse(null, {
        status: 204,
        headers: corsHeaders(origin),
    })
}

export async function POST(req: Request) {
    const origin = req.headers.get("origin")

    try {
        const body = await req.json()
        const email = (body?.email || "").toLowerCase().trim()

        if (!email) {
            return NextResponse.json(
                { ok: false, error: "Missing email" },
                {
                    status: 400,
                    headers: corsHeaders(origin),
                }
            )
        }

        const { data: profile, error } = await supabase
            .from("client_profiles")
            .select("id")
            .ilike("email", email)
            .maybeSingle()

        if (error) {
            console.error("FULL ACCESS LOOKUP ERROR:", error)
            return NextResponse.json(
                { ok: false },
                {
                    status: 500,
                    headers: corsHeaders(origin),
                }
            )
        }

        return NextResponse.json(
            { ok: !!profile },
            {
                status: 200,
                headers: corsHeaders(origin),
            }
        )
    } catch (err) {
        console.error("FULL ACCESS LOOKUP EXCEPTION:", err)
        return NextResponse.json(
            { ok: false },
            {
                status: 500,
                headers: corsHeaders(origin),
            }
        )
    }
}