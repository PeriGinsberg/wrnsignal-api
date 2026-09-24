// app/api/coach/coach-clients/[id]/ghl-contact/route.ts
// Wire a client to their GoHighLevel contact, alongside the Drive folder.
//
// Same shape and same place as drive-folder, because it is the same job: two
// external systems a client's plan has to be filed into, both set once by a
// human who can see what was matched.
//
// GET     what is wired now
// POST    propose a match (search by email, or parse a pasted link). Stores
//         nothing — the coach confirms first.
// PATCH   store a confirmed contact id. An empty id clears the wiring.
//
// NOTHING IS EVER CREATED IN GHL. The lookup is read-only. A client who is not
// in GHL stays not in GHL until somebody puts them there, because a contact
// invented by a Share click is a contact nobody is expecting.

import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { errorStatus } from "../../../../_lib/routeError"
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { resolveCoach } from "@/app/api/_lib/coachAuth"
import { getOwnedRelationship, libraryAccessDenied } from "@/app/api/_lib/coachClientDocuments"
import { ghlConfig } from "@/lib/ghl/client"
import { contactDisplayName, getContactById, parseContactLink } from "@/lib/ghl/contacts"
import { candidateEmails, resolveForClient } from "@/lib/ghl/networkingPlanSync"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

/** The relationship plus the two addresses we may look the client up by. */
async function loadClient(supabase: any, id: string) {
  const { data } = await supabase
    .from("coach_clients")
    .select("id, invited_email, client_profile_id, ghl_contact_id, ghl_contact_name, ghl_contact_source, ghl_contact_resolved_at")
    .eq("id", id).maybeSingle()
  if (!data) return null
  let loginEmail: string | null = null
  if (data.client_profile_id) {
    const { data: prof } = await supabase
      .from("client_profiles").select("email").eq("id", data.client_profile_id).maybeSingle()
    loginEmail = prof?.email ?? null
  }
  return { ...data, loginEmail }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    const rel = await getOwnedRelationship(supabase, coachProfileId, id)
    if (!rel) return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    const denied = libraryAccessDenied(rel, "read")
    if (denied) return withCorsJson(req, { ok: false, error: denied }, 403)

    const cc = await loadClient(supabase, id)
    return withCorsJson(req, {
      ok: true,
      contact: cc?.ghl_contact_id
        ? {
            id: cc.ghl_contact_id,
            name: cc.ghl_contact_name,
            source: cc.ghl_contact_source,
            resolved_at: cc.ghl_contact_resolved_at,
          }
        : null,
      // Shown so the coach can see which addresses a search would try.
      candidate_emails: candidateEmails({ loginEmail: cc?.loginEmail, invitedEmail: cc?.invited_email }),
    }, 200)
  } catch (err: any) {
    console.error("[coach/ghl-contact GET]", err?.stack || err?.message)
    return withCorsJson(req, { ok: false, error: err?.message || String(err) }, 500)
  }
}

/**
 * Propose a match. Stores NOTHING.
 *
 * With no body: search GHL by the client's login email, then their invited
 * email. With { link }: parse it and confirm it resolves to a real contact.
 *
 * Either way the coach is handed a name to confirm. The whole point of this
 * step is that a human sees "Peri Ginsberg" before anything is wired, because
 * the cost of a wrong match is a client's plan being emailed to someone else.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    const rel = await getOwnedRelationship(supabase, coachProfileId, id)
    if (!rel) return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    const denied = libraryAccessDenied(rel, "write")
    if (denied) return withCorsJson(req, { ok: false, error: denied }, 403)

    const cc = await loadClient(supabase, id)
    if (!cc) return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)

    const body = await req.json().catch(() => ({}))
    const cfg = ghlConfig()

    if (typeof body?.link === "string" && body.link.trim()) {
      const parsedId = parseContactLink(body.link)
      if (!parsedId) {
        return withCorsJson(req, {
          ok: false,
          error: "That does not look like a GHL contact link. Open the contact in GHL and copy the address bar.",
        }, 400)
      }
      const contact = await getContactById(parsedId, cfg)
      if (!contact) {
        return withCorsJson(req, { ok: false, error: "No contact with that id exists in this GHL location." }, 404)
      }
      return withCorsJson(req, {
        ok: true,
        match: { id: contact.id, name: contactDisplayName(contact), email: contact.email ?? null, source: "pasted" },
      }, 200)
    }

    const emails = candidateEmails({ loginEmail: cc.loginEmail, invitedEmail: cc.invited_email })
    if (emails.length === 0) {
      return withCorsJson(req, {
        ok: false,
        error: "This client has no email on file, so there is nothing to search on. Paste their GHL contact link instead.",
      }, 409)
    }

    const found = await resolveForClient({ loginEmail: cc.loginEmail, invitedEmail: cc.invited_email }, cfg)
    if (found.status !== "matched") {
      return withCorsJson(req, {
        ok: true,
        match: null,
        tried_emails: emails,
        message: "No GHL contact matched. Paste their contact link to wire it by hand.",
      }, 200)
    }

    return withCorsJson(req, {
      ok: true,
      match: {
        id: found.contactId,
        name: found.displayName,
        email: found.contact.email ?? null,
        source: "search",
        matched_on: found.triedEmail ?? null,
      },
      tried_emails: emails,
    }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/ghl-contact POST]", err?.stack || msg)
    const status = errorStatus(err)
    if (status === 401) return withCorsJson(req, { ok: false, error: "Please sign in again." }, 401)
    return withCorsJson(req, { ok: false, error: msg }, status === 403 ? 403 : 500)
  }
}

/** Store a contact the coach has confirmed. An empty contact_id clears it. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { coachProfileId, error } = await resolveCoach(req)
    if (error) return error

    const supabase = getSupabaseAdmin()
    const rel = await getOwnedRelationship(supabase, coachProfileId, id)
    if (!rel) return withCorsJson(req, { ok: false, error: "Client relationship not found" }, 404)
    const denied = libraryAccessDenied(rel, "write")
    if (denied) return withCorsJson(req, { ok: false, error: denied }, 403)

    const body = await req.json().catch(() => null)
    if (body == null || !("contact_id" in body)) {
      return withCorsJson(req, { ok: false, error: "Nothing to update." }, 400)
    }

    const raw = typeof body.contact_id === "string" ? body.contact_id.trim() : ""
    if (!raw) {
      await supabase.from("coach_clients").update({
        ghl_contact_id: null, ghl_contact_name: null,
        ghl_contact_source: null, ghl_contact_resolved_at: null,
      }).eq("id", id)
      return withCorsJson(req, { ok: true, contact: null }, 200)
    }

    const source = body.source === "pasted" ? "pasted" : "search"

    // CONFIRMED AGAINST GHL BEFORE IT IS STORED, even though the client just
    // saw the name: the id travelled through a browser and this is the last
    // place it can be checked cheaply.
    const contact = await getContactById(raw, ghlConfig())
    if (!contact) {
      return withCorsJson(req, { ok: false, error: "That contact no longer exists in this GHL location." }, 404)
    }

    const { error: upErr } = await supabase.from("coach_clients").update({
      ghl_contact_id: contact.id,
      ghl_contact_name: contactDisplayName(contact),
      ghl_contact_source: source,
      ghl_contact_resolved_at: new Date().toISOString(),
    }).eq("id", id)

    if (upErr) {
      // The partial unique index means one GHL contact can back only one client.
      // Two clients sharing a contact would email one of them the other's plan.
      if (/coach_clients_ghl_contact_unique/.test(upErr.message)) {
        return withCorsJson(req, {
          ok: false,
          error: "That GHL contact is already wired to a different client.",
        }, 409)
      }
      throw new Error(`Could not save the contact: ${upErr.message}`)
    }

    return withCorsJson(req, {
      ok: true,
      contact: { id: contact.id, name: contactDisplayName(contact), source },
    }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/ghl-contact PATCH]", err?.stack || msg)
    const status = errorStatus(err)
    if (status === 401) return withCorsJson(req, { ok: false, error: "Please sign in again." }, 401)
    return withCorsJson(req, { ok: false, error: msg }, status === 403 ? 403 : 500)
  }
}
