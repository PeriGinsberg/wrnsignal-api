import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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
    // Optional: simple protection (recommended).
    // If JOBFIT_INGEST_KEY is set in Vercel, require it.
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
    const job_description = String(body.job_description ?? "").trim();

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "missing_email" },
        { status: 400, headers: corsHeaders() }
      );
    }
    if (!job_description) {
      return NextResponse.json(
        { ok: false, error: "missing_job_description" },
        { status: 400, headers: corsHeaders() }
      );
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1) Load trial user + credits
    const { data: user, error: userErr } = await supabase
      .from("jobfit_users")
      .select("id,email,credits_remaining")
      .eq("email", email)
      .maybeSingle();

    if (userErr) {
      return NextResponse.json(
        { ok: false, error: userErr.message },
        { status: 500, headers: corsHeaders() }
      );
    }
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "no_profile_found" },
        { status: 404, headers: corsHeaders() }
      );
    }
    if ((user.credits_remaining ?? 0) <= 0) {
      return NextResponse.json(
        { ok: false, error: "out_of_credits" },
        { status: 402, headers: corsHeaders() }
      );
    }

    // 2) Decrement credits (atomic-ish approach)
    const newCredits = user.credits_remaining - 1;
    const { error: creditErr } = await supabase
      .from("jobfit_users")
      .update({ credits_remaining: newCredits })
      .eq("id", user.id);

    if (creditErr) {
      return NextResponse.json(
        { ok: false, error: creditErr.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    // 3) Run the SAME Job Fit logic you use today.
    // For now we’ll return a placeholder until you paste in your existing jobfit logic call.
    // Replace this block with your actual evaluation function call.
    const result = {
      decision: "review",
      score: 0,
      note: "Wire this to your existing /api/jobfit logic next.",
    };

    return NextResponse.json(
      { ok: true, credits_remaining: newCredits, result },
      { status: 200, headers: corsHeaders() }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err) },
      { status: 500, headers: corsHeaders() }
    );
  }
}
