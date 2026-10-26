// app/api/me/workbooks/networking/route.ts
// POST { contact_id } — "Create Networking Workbook" on the Networking page.
//
// The only workbook a CLIENT creates. One per contact: a second press for the
// same contact returns the workbook that already exists rather than an error,
// so a double click or a second tab lands in the same place.
//
// Owner only. The contact must be on the caller's own board; a coach looking at
// a client's board does not get the button, and this route ignores the subject
// parameter so it could not write to the client's workbooks if called anyway.
//
// SERVICE ROLE for the write, after the ownership check. The client has no
// insert policy on workbooks, deliberately: the content is built here from the
// repo's template, and a policy would let the browser post any content it liked
// straight to the table.
//
// The workbook starts with_client, not draft: the client wrote it, there is
// nothing for a coach to share. It hangs off the lead coach if there is one,
// and off nothing if not; workbook_send_to_coach resolves the lead coach again
// at send time (20261026_networking_workbooks.sql).

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../_lib/cors"
import { workbookError } from "../../../_lib/workbookError"
import { logCoachClientEvent } from "../../../_lib/coachClientEvents"
import { getSupabaseAdmin } from "../../../_lib/coachAuth"
import { must } from "../../../_lib/must"
import { resolveActor } from "@/lib/collab/scope"
import { getNetworkingTemplate } from "@/lib/workbook/templates"
import { applyTemplate, unresolvedPlaceholders, validateContent } from "@/lib/workbook/content"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

/** A record value on its way into the content. Braces would read as a placeholder. */
const clean = (v: unknown) => (typeof v === "string" ? v.replace(/[{}]/g, "").trim() : "")

export async function POST(req: NextRequest) {
  try {
    const { actorId } = await resolveActor(req)
    const admin = getSupabaseAdmin()

    const body = await req.json().catch(() => ({}))
    const contactId = typeof body?.contact_id === "string" ? body.contact_id : ""
    if (!contactId) return withCorsJson(req, { ok: false, error: "Pick a contact first" }, 400)

    const contact = must(
      await admin.from("network_contacts")
        .select("id, client_profile_id, first_name, last_name, title, network_companies(name)")
        .eq("id", contactId).maybeSingle(),
      "read contact",
    ) as any
    // Someone else's contact reads as missing, not forbidden: no hint it exists.
    if (!contact || contact.client_profile_id !== actorId) {
      return withCorsJson(req, { ok: false, error: "Contact not found" }, 404)
    }

    const existing = must(
      await admin.from("workbooks").select("id").eq("network_contact_id", contactId).maybeSingle(),
      "check existing workbook",
    )
    if (existing) return withCorsJson(req, { ok: true, existing: true, workbook: { id: existing.id } }, 200)

    const me = must(
      await admin.from("client_profiles").select("name").eq("id", actorId).maybeSingle(),
      "read profile",
    )
    const fullName = clean(me?.name) || "You"

    // Same rule as wb_lead_coach_link() in SQL: active, full access, accepted first.
    const lead = must(
      await admin.from("coach_clients")
        .select("id, coach:client_profiles!coach_profile_id(name)")
        .eq("client_profile_id", actorId).eq("status", "active").eq("access_level", "full")
        .order("accepted_at", { ascending: true, nullsFirst: false })
        .order("invited_at", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .limit(1).maybeSingle(),
      "find lead coach",
    ) as any
    const coachFirst = clean(lead?.coach?.name).split(/\s+/)[0] || "Your coach"

    const template = getNetworkingTemplate()
    const contactFirst = clean(contact.first_name)
    let content = applyTemplate(template.content, {
      first_name: fullName.split(/\s+/)[0],
      full_name: fullName,
      coach_first_name: coachFirst,
      contact_full_name: [contactFirst, clean(contact.last_name)].filter(Boolean).join(" "),
      contact_first_name: contactFirst,
      contact_title: clean(contact.title),
      contact_company: clean(contact.network_companies?.name),
    })
    const left = unresolvedPlaceholders(content)
    if (left.length) throw new Error(`The networking template still has ${left.join(", ")} in it`)

    const slug = `networking-${contact.id}`
    const parsed = validateContent({ ...content, slug })
    if (!parsed.ok) throw new Error(`Networking template: ${parsed.errors.join("; ")}`)
    content = parsed.content

    const { data, error } = await admin.from("workbooks")
      .insert({
        coach_client_id: lead?.id ?? null,
        client_profile_id: actorId,
        network_contact_id: contact.id,
        slug,
        content,
        status: "with_client",
        created_by: actorId,
      })
      .select("id")
      .single()
    if (error) {
      // Lost a race with another tab: the other insert is the workbook.
      if (error.code === "23505") {
        const again = must(
          await admin.from("workbooks").select("id").eq("network_contact_id", contactId).maybeSingle(),
          "read existing workbook",
        )
        if (again) return withCorsJson(req, { ok: true, existing: true, workbook: { id: again.id } }, 200)
      }
      throw new Error(`Create networking workbook: ${error.message}`)
    }

    if (lead?.id) {
      await logCoachClientEvent({
        coachClientId: lead.id,
        eventType: "workbook_created",
        actorProfileId: actorId,
        context: { title: content.title ?? slug, template_id: template.template_id },
      })
    }
    return withCorsJson(req, { ok: true, existing: false, workbook: { id: data.id } }, 201)
  } catch (err) {
    return workbookError(req, err)
  }
}
