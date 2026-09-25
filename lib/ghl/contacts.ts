/**
 * The four GHL operations the Networking Plan share needs, plus contact
 * resolution.
 *
 * ORDER MATTERS AND IS ENFORCED BY THE CALLER, NOT HERE:
 *
 *   1. addContactNote
 *   2. addContactTags         <- fires the GHL workflow that emails the client
 *
 * THERE IS NO CUSTOM FIELD. An earlier draft set a "Networking Plan URL" field
 * before tagging; that field does not exist and is not being created. The GHL
 * email is a notification -- the plan itself reaches the client through the
 * Drive link and the SIGNAL library, not through a CRM field. The note is still
 * written first because it is the cheap, reversible half: if it fails, the tag
 * (and the email) should still go.
 *
 * RESOLUTION NEVER CREATES. GET /contacts/search/duplicate is a read-only
 * lookup: it returns a match or it does not, and it cannot bring a contact into
 * existence as a side effect of a coach clicking Share. When it finds nothing
 * the coach pastes the GHL contact link instead, which is a human confirming
 * identity rather than software guessing at it.
 */

import { ghlRequest, type GhlConfig } from "./client"

export type GhlContact = {
  id: string
  firstName?: string | null
  lastName?: string | null
  name?: string | null
  email?: string | null
  phone?: string | null
}

/** Best display name available, for showing the coach what we matched. */
export function contactDisplayName(c: GhlContact): string {
  const joined = [c.firstName, c.lastName].filter(Boolean).join(" ").trim()
  return c.name?.trim() || joined || c.email?.trim() || c.id
}

/**
 * Exact-email lookup, scoped to the location. Read-only.
 *
 *   GET /contacts/search/duplicate?locationId=...&email=...
 *
 * Returns null when nothing matches, which is a normal outcome and not an
 * error: plenty of coached clients will not be in GHL.
 *
 * WHAT THIS ENDPOINT DOES NOT PROMISE: HighLevel decides what counts as a
 * duplicate from the location's own "Allow Duplicate Contact" setting -- email
 * first, then phone, when enabled. So a match is "the contact HighLevel
 * considers the duplicate of this email", not necessarily "the only contact
 * with this email". That is why the coach is shown the name and can override.
 */
export async function findContactByEmail(
  email: string,
  cfg: GhlConfig,
): Promise<GhlContact | null> {
  const trimmed = String(email ?? "").trim()
  if (!trimmed) return null

  const res = await ghlRequest<any>(
    "/contacts/search/duplicate",
    { method: "GET", query: { locationId: cfg.locationId, email: trimmed } },
    cfg,
  )

  // The docs do not pin the success shape, so accept the plausible envelopes
  // rather than assuming one. tests/ghl/probe.ts records which one is real.
  const c = res.data?.contact ?? res.data?.contacts?.[0] ?? (res.data?.id ? res.data : null)
  if (!c?.id) return null
  return c as GhlContact
}

/**
 * Every contact in this location with EXACTLY this email.
 *
 *   POST /contacts/search  { locationId, filters: [{field:"email", operator:"eq", value}] }
 *
 * WHY NOT search/duplicate, which is simpler. That endpoint returns the ONE
 * contact HighLevel considers the duplicate of an email; it cannot tell you
 * whether there were two. Auto-storing a match without confirmation is only
 * safe if "exactly one" is a thing we can actually check, so this returns the
 * list and the caller counts it.
 *
 * Probed against the real location before being relied on: an exact address
 * returns total 1, a nonsense address returns total 0, and two different
 * addresses return two different contacts. So the filter genuinely narrows.
 *
 * The email is re-checked HERE as well, case-insensitively, because `eq` is
 * HighLevel's definition of equal and not ours. A contact that comes back not
 * actually carrying the address we asked for is dropped.
 */
export async function searchContactsByEmail(
  email: string,
  cfg: GhlConfig,
): Promise<GhlContact[]> {
  const wanted = String(email ?? "").trim()
  if (!wanted) return []

  const res = await ghlRequest<any>(
    "/contacts/search",
    {
      method: "POST",
      body: {
        locationId: cfg.locationId,
        page: 1,
        pageLimit: 20,
        filters: [{ field: "email", operator: "eq", value: wanted }],
      },
    },
    cfg,
  )

  const list: any[] = Array.isArray(res.data?.contacts) ? res.data.contacts : []
  return list.filter((c) => c?.id && String(c.email ?? "").trim().toLowerCase() === wanted.toLowerCase())
}

/**
 * A pasted GHL contact link -> the contact id.
 *
 * Accepts the shapes a coach can actually copy out of the GHL UI:
 *   https://app.gohighlevel.com/v2/location/<loc>/contacts/detail/<contactId>
 *   https://app.gohighlevel.com/location/<loc>/contacts/detail/<contactId>
 *   https://<whitelabel>/v2/location/<loc>/contacts/detail/<contactId>
 * and a bare id pasted on its own.
 *
 * RETURNS null RATHER THAN GUESSING. A half-parsed id writes one client's plan
 * URL onto another client's contact and emails it to them, which is the worst
 * failure this integration has.
 */
export function parseContactLink(input: string): string | null {
  const raw = String(input ?? "").trim()
  if (!raw) return null

  // A bare id: GHL contact ids are opaque alphanumeric, ~20-24 chars.
  if (/^[A-Za-z0-9]{15,40}$/.test(raw)) return raw

  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  const segs = u.pathname.split("/").filter(Boolean)
  const at = segs.indexOf("detail")
  // The id sits immediately after /contacts/detail/. Anchoring on the literal
  // segment rather than a position keeps the optional /v2/ prefix harmless.
  if (at > 0 && segs[at - 1] === "contacts" && segs[at + 1]) {
    const id = segs[at + 1]
    return /^[A-Za-z0-9]{15,40}$/.test(id) ? id : null
  }
  return null
}

/**
 * GET /contacts/{id}. Used to confirm a PASTED id resolves to a real contact
 * before it is stored, so the coach sees a name rather than trusting a string
 * they copied. Returns null on 404 rather than throwing: "that link is wrong"
 * is a normal answer for a human to act on.
 */
export async function getContactById(id: string, cfg: GhlConfig): Promise<GhlContact | null> {
  try {
    const res = await ghlRequest<any>(`/contacts/${encodeURIComponent(id)}`, { method: "GET" }, cfg)
    const c = res.data?.contact ?? (res.data?.id ? res.data : null)
    return c?.id ? (c as GhlContact) : null
  } catch (e: any) {
    if (e?.status === 404) return null
    throw e
  }
}

/** POST /contacts/{id}/notes */
export async function addContactNote(
  contactId: string,
  body: string,
  cfg: GhlConfig,
): Promise<{ id: string | null }> {
  const res = await ghlRequest<any>(
    `/contacts/${encodeURIComponent(contactId)}/notes`,
    // userId is optional per the docs and we have no natural author under a
    // private integration token, so it is omitted rather than faked.
    { method: "POST", body: { body } },
    cfg,
  )
  return { id: res.data?.note?.id ?? res.data?.id ?? null }
}

/** The note text the brief specifies. Date only, no time: this is a log line a coach reads. */
export function networkingPlanNoteText(on: Date = new Date()): string {
  const d = on.toISOString().slice(0, 10)
  return `Networking Plan shared from SIGNAL on ${d}`
}

// THE TAG IS GONE, AND SO ARE ITS HELPERS.
//
// NETWORKING_PLAN_TAG ("networking-plan-shared"), addContactTags and
// removeContactTags lived here until 2026-09-26. Writing that tag was how a
// client got told their plan was ready: a GoHighLevel workflow watched for it
// and sent the email. SIGNAL could see nothing past the tag write, so it could
// not say whether the mail was sent or where it went.
//
// SIGNAL now sends that email itself, through the Postmark template
// `networking-plan-ready`. Keeping the tag as well would send it twice, and
// keeping the helpers would leave a loaded gun in the file: the whole comment
// above addContactTags used to read "THIS IS THE CALL THAT EMAILS THE CLIENT".
//
// The GHL contact NOTE above is unaffected. It was always an audit line for
// people working in GHL, never how the client was told.
