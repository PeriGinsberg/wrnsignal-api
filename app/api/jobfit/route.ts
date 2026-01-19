import { getAuthedProfileText } from "../_lib/authProfile";
import { runJobFit } from "../../../_lib/jobfitEvaluator";


export const runtime = "nodejs";

function corsHeaders(origin: string | null) {
  const allowOrigin = origin || "*";
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export async function OPTIONS(req: Request) {
  const origin = req.headers.get("origin");
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");

  try {
    // Auth + stored profile
    const { profileText } = await getAuthedProfileText(req);

    const body = await req.json();
    const job = String(body?.job || "").trim();

    if (!job) {
      return new Response(JSON.stringify({ error: "Missing job" }), {
        status: 400,
        headers: corsHeaders(origin),
      });
    }

    const out = await runJobFit({
      profileText,
      jobText: job,
    });

    return new Response(JSON.stringify(out), {
      status: 200,
      headers: corsHeaders(origin),
    });
  } catch (err: any) {
    const detail = err?.message || String(err);
    const lower = String(detail).toLowerCase();

    const status =
      lower.includes("unauthorized")
        ? 401
        : lower.includes("profile not found")
        ? 404
        : lower.includes("access disabled")
        ? 403
        : 500;

    return new Response(JSON.stringify({ error: "JobFit failed", detail }), {
      status,
      headers: corsHeaders(origin),
    });
  }
}
