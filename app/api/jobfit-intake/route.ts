import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-jobfit-key",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: Request) {
  try {
    // Optional: basic key check (recommended). If env var not set, it won't block.
    const expectedKey = process.env.JOBFIT_INGEST_KEY;
    if (expectedKey) {
      const got = req.headers.get("x-jobfit-key");
      if (got !== expectedKey) {
        return NextResponse.json(
          { ok: false, error: "unauthorized" },
          { status: 401, headers: corsHeaders() }
        );
      }
    }

    const body = await req.json();

    const email = String(body.email ?? "").toLowerCase().trim();
    const target_roles = String(body.target_roles ?? "").trim();
    const target_locations = String(body.target_locations ?? "").trim();
    const timeline = String(body.timeline ?? "").trim();
    const resume_text = String(body.resume_text ?? "").trim();

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "missing_email" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Upsert user by email
    const { data: user, error: userErr } = await supabase
      .from("jobfit_users")
      .upsert({ email }, { onConflict: "email" })
      .select("id,email,credits_remaining")
      .single();

    if (userErr) {
      return NextResponse.json(
        { ok: false, error: userErr.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    // Upsert profile 1:1 by user_id
    const { error: profErr } = await supabase
      .from("jobfit_profiles")
      .upsert(
        { user_id: user.id, email, target_roles, target_locations, timeline, resume_text },
        { onConflict: "user_id" }
      );

    if (profErr) {
      return NextResponse.json(
        { ok: false, error: profErr.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    return NextResponse.json(
      { ok: true, user_id: user.id, credits_remaining: user.credits_remaining },
      { status: 200, headers: corsHeaders() }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500, headers: corsHeaders() }
    );
  }
}
