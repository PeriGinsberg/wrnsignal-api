// app/api/supporter/clients/[clientId]/extract-job/route.ts
//
// POST { url } or { text }: fills the supporter's suggestion form from a job
// link or a pasted description. Same parse code as JobFit's parse-job-url and
// parse-job-text (lib/jobParse), and nothing else: no JobFit run, no score,
// nothing saved. The supporter edits what comes back and submits it through
// the suggestions route as usual.
//
// A link the site will not let us read (LinkedIn, Indeed, a blocked page)
// answers 422 with suggestion "paste_text", and the form asks for the
// description instead.
//
// Capped at DAILY_EXTRACTIONS per supporter login per day (America/New_York),
// counted before the parse so a failed fetch counts too: a blocked page can
// still have cost an AI call. See 20261117_supporter_extraction_usage.sql.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { routeError } from "../../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveSupporterRequestScope } from "@/lib/collab/scope"
import { parseJobUrl } from "@/lib/jobParse/parseJobUrl"
import { parseJobText } from "@/lib/jobParse/parseJobText"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// A long paste comes back whole (see SUPPORTER_TEXT_LIMITS), which takes the
// model longer than parse-job-text's 30 seconds.
export const maxDuration = 120

const DAILY_EXTRACTIONS = 20

/** Raised on this route only, to the suggestion's own job_description limit. */
const SUPPORTER_TEXT_LIMITS = { maxInputChars: 50000, maxDescriptionChars: 50000, maxTokens: 16000 }

export async function OPTIONS(req: NextRequest) {
  return corsOptionsResponse(req.headers.get("origin"))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId } = await params
    const supabase = getSupabaseAdmin()
    const scope = await resolveSupporterRequestScope(req, supabase, clientId)

    const body = await req.json().catch(() => null)
    const url = typeof body?.url === "string" ? body.url.trim() : ""
    const text = typeof body?.text === "string" ? body.text.trim() : ""
    if (!url && !text) return withCorsJson(req, { ok: false, error: "Paste a job link or the job description." }, 400)
    // parse-job-text's own floor, checked here so a too-short paste costs
    // nothing from the allowance.
    if (!url && text.length < 50) {
      return withCorsJson(req, { ok: false, error: "Paste more of the posting: at least a few sentences of the description." }, 400)
    }

    const { data: used, error } = await supabase.rpc("take_supporter_extraction", {
      p_user: scope.actorId,
      p_limit: DAILY_EXTRACTIONS,
    })
    if (error) throw new Error(`Extraction count failed: ${error.message}`)
    if (used == null) {
      return withCorsJson(req, {
        ok: false,
        code: "DAILY_LIMIT",
        error: `You've auto-filled ${DAILY_EXTRACTIONS} jobs today. You can still fill in the form yourself, and auto-fill is back tomorrow.`,
      }, 429)
    }

    const r = url ? await parseJobUrl({ url }) : await parseJobText({ text }, SUPPORTER_TEXT_LIMITS)
    const remaining = Math.max(0, DAILY_EXTRACTIONS - Number(used))
    if (r.status !== 200) {
      return withCorsJson(req, { ok: false, ...r.body, remaining }, r.status)
    }
    const j = r.body as Record<string, any>
    return withCorsJson(req, {
      ok: true,
      job: {
        company_name: j.companyName || "",
        job_title: j.jobTitle || "",
        location: j.location || "",
        job_url: j.originalUrl || url || "",
        job_description: j.jobDescription || "",
      },
      remaining,
    })
  } catch (err) {
    return routeError(req, err)
  }
}
