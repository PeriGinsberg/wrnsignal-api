import { NextResponse } from "next/server"
import { extractJobV4 } from "../_v4/extractJob"

// IMPORTANT:
// This route is dev-only. Do not deploy to prod.
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const jobText: string =
      body?.job ||
      body?.job_text ||
      body?.job_description ||
      body?.jobText ||
      body?.jobDescription ||
      ""

    if (!jobText || jobText.trim().length < 50) {
      return NextResponse.json({ error: "Missing job" }, { status: 400 })
    }

    const job = extractJobV4(jobText)

    return NextResponse.json({
      ok: true,
 v: "jobfit_v4_debug_job_extract_only__2026_02_26a",
      job,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 })
  }
}