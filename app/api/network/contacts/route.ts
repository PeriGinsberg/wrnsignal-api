// app/api/network/contacts/route.ts
// GET:  the full contact roster for a board — everyone, standalone included,
//   NOT due-gated (that's the worklist). Owner by default; coach view via
//   ?client_profile_id=<id> (gated 'view'). Sort is roster-first: contacts with
//   NO activity (last_action_at NULL) come FIRST, then most-recently-active —
//   so a just-added contact surfaces at the top, not buried nulls-last. Optional
//   filters: ?stage=, ?company_id=, ?standalone=1.
// POST: create a contact. OWNER-ONLY (creation is a pipeline write; a coach
//   cannot add contacts in v1). Company is genuinely OPTIONAL — a standalone
//   contact (company_id NULL) is first-class. A provided company name is
//   matched case-insensitively to an existing company or created blank
//   (priority/status stay NULL, same as import).
//   The new contact is ALWAYS not_contacted with NO due date: stage, dates, and
//   reminders are tracker-generated, never client-set (brief §3 guardrail 3, and
//   poke is OFF unless the user enables it later). This route reads none of those
//   fields from the body.
//   Dedup is enforced by the DB unique indexes; a 23505 is surfaced as a clean
//   409 ("you already have a contact named …"), never a raw Postgres error.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { assertBoardAccess } from "@/lib/network-tracker/access"
import { matchOrCreateCompany } from "@/lib/network-tracker/company"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const STAGES = new Set([
  "identified", "intro_requested", "sequence_active", "replied", "chat_scheduled",
  "chat_done", "nurture", "ask_made", "outcome", "dormant_no_answer", "dormant_declined",
])
const RELATIONSHIPS = new Set(["personal", "affinity", "referred", "cold", "recruiter"])
const PRIORITIES = new Set(["A", "B", "C"])

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()
    const params = new URL(req.url).searchParams
    const target = params.get("client_profile_id") || profileId

    const acc = await assertBoardAccess(supabase, profileId, target, "view")
    if (!acc) return withCorsJson(req, { ok: false, error: "Forbidden" }, 403)

    let q = supabase
      .from("network_contacts")
      .select("id, first_name, last_name, title, stage, relationship, priority, segment, next_due_at, next_due_reason, last_action_at, company_id, network_companies(name)")
      .eq("client_profile_id", target)

    // optional filters
    const stage = params.get("stage")
    if (stage) {
      if (!STAGES.has(stage)) return withCorsJson(req, { ok: false, error: "invalid stage filter" }, 400)
      q = q.eq("stage", stage)
    }
    const companyId = params.get("company_id")
    if (companyId) q = q.eq("company_id", companyId)
    if (["1", "true", "yes"].includes((params.get("standalone") || "").toLowerCase())) q = q.is("company_id", null)

    // Roster order: no-activity first (nullsFirst), then most-recently-active.
    // Tiebreak by last name so equal/again-null rows are stable, not arbitrary.
    q = q.order("last_action_at", { ascending: false, nullsFirst: true }).order("last_name", { ascending: true })

    const { data, error } = await q
    if (error) throw new Error(`Contact list failed: ${error.message}`)
    return withCorsJson(req, { ok: true, contacts: data ?? [] }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()

    const body = await req.json().catch(() => null)
    const firstName = typeof body?.first_name === "string" ? body.first_name.trim() : ""
    const lastName = typeof body?.last_name === "string" ? body.last_name.trim() : ""
    if (!firstName || !lastName)
      return withCorsJson(req, { ok: false, error: "First and last name are required." }, 400)

    // Optional identity. Empty strings collapse to null.
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
    const title = str(body?.title)
    const email = str(body?.email)
    const linkedinUrl = str(body?.linkedin_url)
    const companyName = str(body?.company_name)

    // v3 fields — relationship/priority are validated enums; segment is free text.
    // All optional at the DB level (import tolerance), though relationship is the
    // field the product treats as most important.
    const relationship = str(body?.relationship)
    if (relationship && !RELATIONSHIPS.has(relationship))
      return withCorsJson(req, { ok: false, error: "invalid relationship" }, 400)
    const priority = str(body?.priority)
    if (priority && !PRIORITIES.has(priority))
      return withCorsJson(req, { ok: false, error: "invalid priority" }, 400)
    const segment = str(body?.segment)
    // Per-contact context (opening lines, "why this person"). Detail-page only.
    const additionalInfo = str(body?.additional_info)

    // ── resolve the company (optional) — shared match-or-create ──
    const companyId: string | null = companyName ? await matchOrCreateCompany(supabase, profileId, companyName) : null

    // ── create the contact ── (stage/dates/reminders come from DB defaults:
    // stage 'identified', next_due_at NULL — never from the body)
    const { data: contact, error: insErr } = await supabase
      .from("network_contacts")
      .insert({
        client_profile_id: profileId,
        company_id: companyId,
        first_name: firstName,
        last_name: lastName,
        title,
        email,
        linkedin_url: linkedinUrl,
        relationship,
        priority,
        segment,
        additional_info: additionalInfo,
      })
      .select("id, first_name, last_name, stage, relationship, priority, company_id, network_companies(name)")
      .single()

    if (insErr) {
      if (insErr.code === "23505") {
        const where = companyName ? ` at ${companyName}` : ""
        return withCorsJson(
          req,
          { ok: false, error: `You already have a contact named ${firstName} ${lastName}${where}.` },
          409,
        )
      }
      throw new Error(`Contact create failed: ${insErr.message}`)
    }

    return withCorsJson(req, { ok: true, contact }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
