import { NextResponse } from "next/server"
import { getAuthedProfileText } from "../_lib/authProfile"
import { runResumeCritique } from "../_lib/resumeCritiqueEvaluator"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() })
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

export async function POST(req: Request) {
  try {
    // 1) Get authed profile text (bearer token validated inside)
    const { userId, email, profileText } = await getAuthedProfileText(req)

    // 2) Pull resume_text from client_profiles (preferred), fallback to profileText if needed
    const supabaseAdmin = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    )

    const { data: row, error } = await supabaseAdmin
      .from("client_profiles")
      .select("resume_text, profile_text")
      .eq("user_id", userId)
      .maybeSingle()

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500, headers: corsHeaders() }
      )
    }

    const resumeText =
      String(row?.resume_text || "").trim() ||
      String(row?.profile_text || "").trim()

    if (!resumeText) {
      return NextResponse.json(
        { ok: false, error: "missing_resume_text" },
        { status: 400, headers: corsHeaders() }
      )
    }

    // 3) Run evaluator
    const result = await runResumeCritique({
      resumeText,
      profileText,
    })

    return NextResponse.json(
      { ok: true, email, result },
      { status: 200, headers: corsHeaders() }
    )
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status =
      msg.toLowerCase().includes("unauthorized") ? 401 : 500

    return NextResponse.json(
      { ok: false, error: msg },
      { status, headers: corsHeaders() }
    )
  }
}
