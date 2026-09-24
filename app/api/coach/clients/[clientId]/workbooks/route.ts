// app/api/coach/clients/[clientId]/workbooks/route.ts
// GET the client's workbooks for the coach's Workbooks tab, and POST a new one
// from a session template. Full-access coaches only (coachWorkbookScope).
// Caller-JWT client: RLS on workbooks applies, including the INSERT policy
// added in 20260924_workbooks_coach_insert.sql.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { workbookError } from "../../../../_lib/workbookError"
import { must } from "../../../../_lib/must"
import { coachWorkbookScope } from "@/lib/workbook/server"
import { getTemplate } from "@/lib/workbook/templates"
import { applyTemplate, unresolvedPlaceholders, validateContent } from "@/lib/workbook/content"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)

    const rows = must(
      await supabase
        .from("workbooks")
        .select("id, slug, status, created_at, updated_at, signal_interview_id, title:content->>title, interview:content->interview")
        .eq("client_profile_id", scope.subjectId)
        .order("updated_at", { ascending: false }),
      "list workbooks",
    ) ?? []

    const ids = rows.map((r: any) => r.id)
    const sends = ids.length
      ? must(
          await supabase
            .from("workbook_sends")
            .select("workbook_id, direction, sent_at, item_count")
            .in("workbook_id", ids)
            .order("sent_at", { ascending: false }),
          "list workbook sends",
        ) ?? []
      : []

    const workbooks = rows.map((r: any) => {
      const mine = sends.filter((s: any) => s.workbook_id === r.id)
      return {
        ...r,
        last_to_coach: mine.find((s: any) => s.direction === "to_coach") ?? null,
        last_to_client: mine.find((s: any) => s.direction === "to_client") ?? null,
      }
    })

    return withCorsJson(req, { ok: true, workbooks }, 200)
  } catch (err) {
    return workbookError(req, err)
  }
}

class BadRequest extends Error {
  readonly status = 400
}

/** A name the coach typed, on its way into content the client will read. */
function name(raw: unknown, field: string): string {
  const v = typeof raw === "string" ? raw.trim() : ""
  if (!v) throw new BadRequest(`${field} is required`)
  if (v.length > 80) throw new BadRequest(`${field} is too long`)
  // Braces would survive substitution and read as a placeholder in the workbook.
  if (/[{}]/.test(v)) throw new BadRequest(`${field} cannot contain { or }`)
  return v
}

/**
 * Create a workbook from a session template, as a DRAFT the coach then shares.
 *
 * The browser sends three NAMES and a template id, never content: the content
 * is built here from this server's own copy of the template, so a coach cannot
 * post arbitrary content as a workbook and the preview stays a preview.
 *
 * Ownership follows the relationship, not the caller: coach_client_id is the
 * link that granted access, which for a DELEGATE is the principal's row, while
 * created_by stays the delegate. Her work, his roster.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ clientId: string }> }) {
  try {
    const { clientId } = await params
    const { supabase, scope } = await coachWorkbookScope(req, clientId)
    if (!scope.linkId) throw new Error("No coach_clients row on the scope")

    const body = await req.json().catch(() => ({}))
    const template = getTemplate(String(body?.template_id ?? ""))
    if (!template) return withCorsJson(req, { ok: false, error: "No such template" }, 404)

    const values = {
      first_name: name(body?.first_name, "The client's first name"),
      full_name: name(body?.full_name, "The client's full name"),
      coach_first_name: name(body?.coach_first_name, "Your first name"),
    }
    let content = applyTemplate(template.content, values)

    const left = unresolvedPlaceholders(content)
    if (left.length) {
      return withCorsJson(req, { ok: false, error: `The template still has ${left.join(", ")} in it` }, 500)
    }
    // template_id and session STAY on the stored content. The homework webhook
    // reports which session was completed, and it reads that from here: an
    // earlier version of this route dropped both, which did not fail, it just
    // made every workbook report itself as Session 1. The content is kept
    // exactly as scripts/create-workbook.ts writes it, so rows made by the
    // button and rows made by the script are the same shape.
    const parsed = validateContent(content)
    if (!parsed.ok) {
      return withCorsJson(req, { ok: false, error: `Template ${template.template_id}: ${parsed.errors.join("; ")}` }, 500)
    }
    content = parsed.content

    // One client can hold several workbooks from the same template over time,
    // and slug is unique per client, so a repeat gets -2, -3. Silent by
    // decision: the coach names nothing here, they pick a template.
    const base = content.slug
    for (let attempt = 1; attempt <= 20; attempt++) {
      const slug = attempt === 1 ? base : `${base}-${attempt}`
      const { data, error } = await supabase
        .from("workbooks")
        .insert({
          coach_client_id: scope.linkId,
          client_profile_id: scope.subjectId,
          slug,
          content: { ...content, slug },
          status: "draft",
          created_by: scope.actorId,
        })
        .select("id, slug, status")
        .single()
      if (!error) return withCorsJson(req, { ok: true, workbook: data }, 201)
      if (error.code !== "23505") throw new Error(`Create workbook: ${error.message}`)
    }
    throw new Error("Could not find a free slug for this workbook")
  } catch (err) {
    if (err instanceof BadRequest) return withCorsJson(req, { ok: false, error: err.message }, 400)
    return workbookError(req, err)
  }
}
