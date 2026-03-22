import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

export async function POST(req: Request) {
    try {
        const body = await req.json()
        const email = (body?.email || "").toLowerCase().trim()

        if (!email) {
            return NextResponse.json({ ok: false, error: "Missing email" }, { status: 400 })
        }

        // STEP 1: check if profile exists
        const { data: profile, error } = await supabase
            .from("client_profiles")
            .select("id")
            .ilike("email", email)
            .maybeSingle()

        if (error) {
            console.error("FULL ACCESS LOOKUP ERROR:", error)
            return NextResponse.json({ ok: false }, { status: 500 })
        }

        if (!profile) {
            return NextResponse.json({ ok: false })
        }

        // STEP 2: valid profile found
        return NextResponse.json({ ok: true })
    } catch (err) {
        console.error("FULL ACCESS LOOKUP EXCEPTION:", err)
        return NextResponse.json({ ok: false }, { status: 500 })
    }
}