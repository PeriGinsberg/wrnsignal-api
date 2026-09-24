// app/api/coach/coach-clients/[id]/ghl-contact/route.ts
// Wire a client to their GoHighLevel contact, alongside the Drive folder.
//
// Same shape and same place as drive-folder, because it is the same job: the
// two external systems a client's plan has to reach.
//
// GET     what is wired now
// POST    wire it. { auto: true } searches by login email then invited email
//         and stores a match only when EXACTLY ONE contact carries that
//         address; { link } stores a contact the coach pasted. No confirmation
//         step -- "exactly one exact match" is the check.
// PATCH   set or clear a contact id directly. An empty id clears the wiring.
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
import { autoResolveContact, candidateEmails, noContactMessage } from "@/lib/ghl/networkingPlanSync"

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
 * Wire the contact. STORES what it finds -- there is no confirmation step.
 *
 * { auto: true }  search by login email, then invited email. A match is stored
 *                 only when EXACTLY ONE contact carries that address.
 * { link: "..." } the coach pasted a contact link; parse, confirm it exists,
 *                 store it.
 *
 * WHY NO CONFIRM. The old flow showed a name and waited for a click. Requiring
 * exactly one exact-email match is a stricter test than a human glancing at a
 * name, and it removes a setup step the coach never asked for. Two contacts
 * sharing an address is refused outright rather than guessed at, because the
 * cost of guessing is emailing one client's plan to another.
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

    // ---- pasted link
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
      const stored = await storeContact(supabase, id, contact.id, contactDisplayName(contact), "pasted")
      if ("error" in stored) return withCorsJson(req, { ok: false, error: stored.error }, stored.status)
      return withCorsJson(req, { ok: true, contact: stored.contact }, 200)
    }

    // ---- automatic
    const found = await autoResolveContact(
      { loginEmail: cc.loginEmail, invitedEmail: cc.invited_email }, cfg,
    )
    if (found.status !== "matched") {
      // Not an error: no contact is a normal state with a normal remedy.
      return withCorsJson(req, {
        ok: true,
        contact: null,
        message: noContactMessage(found),
        tried_emails: candidateEmails({ loginEmail: cc.loginEmail, invitedEmail: cc.invited_email }),
      }, 200)
    }

    const stored = await storeContact(supabase, id, found.contactId, found.displayName, "search")
    if ("error" in stored) return withCorsJson(req, { ok: false, error: stored.error }, stored.status)
    return withCorsJson(req, { ok: true, contact: stored.contact, matched_on: found.matchedOn }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    console.error("[coach/ghl-contact POST]", err?.stack || msg)
    const status = errorStatus(err)
    if (status === 401) return withCorsJson(req, { ok: false, error: "Please sign in again." }, 401)
    return withCorsJson(req, { ok: false, error: msg }, status === 403 ? 403 : 500)
  }
}

/** One place that writes the contact, so the unique-index message is uniform. */
async function storeContact(
  supabase: any, coachClientId: string, contactId: string, name: string, source: "search" | "pasted",
): Promise<{ contact: { id: string; name: string; source: string } } | { error: string; status: number }> {
  const { error } = await supabase.from("coach_clients").update({
    ghl_contact_id: contactId,
    ghl_contact_name: name,
    ghl_contact_source: source,
    ghl_contact_resolved_at: new Date().toISOString(),
  }).eq("id", coachClientId)

  if (error) {
    // One GHL contact backs one client: two would email one of them the
    // other's plan.
    if (/coach_clients_ghl_contact_unique/.test(error.message)) {
      return { error: "That GHL contact is already wired to a different client.", status: 409 }
    }
    return { error: `Could not save the contact: ${error.message}`, status: 500 }
  }
  return { contact: { id: contactId, name, source } }
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
