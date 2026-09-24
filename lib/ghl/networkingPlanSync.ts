/**
 * The Networking Plan → GHL sync: resolution at folder setup, share, re-send.
 *
 * DELIBERATELY PURE. This module takes a contact id and a URL and returns what
 * happened, step by step. It writes nothing to Supabase. The Drive/PDF half
 * (docs/networking-plan-delivery-plan.md) does not exist yet, so there is no
 * networking_plan_jobs row to update; when it lands, the share route persists
 * these results. Recording them here against a table that does not exist would
 * be guessing at a schema.
 *
 * THE ORDER IS THE WHOLE POINT:
 *
 *   1. note   "Networking Plan shared from SIGNAL on <date>"
 *   2. tag    networking-plan-shared   <- the workflow emails the client
 *
 * THERE IS NO CUSTOM FIELD and none is being created. The plan reaches the
 * client through the Drive link and the SIGNAL library; the GHL email is a
 * notification, not the delivery mechanism.
 *
 * The note is first because it is the reversible half. If it fails the tag
 * still goes: a missing audit line is worth less than a client who is never
 * told their plan is ready. The tag is last because it is the irreversible
 * one -- nothing un-sends an email.
 */

import type { GhlConfig } from "./client"
import {
  NETWORKING_PLAN_TAG,
  addContactNote,
  addContactTags,
  contactDisplayName,
  findContactByEmail,
  networkingPlanNoteText,
  parseContactLink,
  removeContactTags,
  type GhlContact,
} from "./contacts"

// ---------------------------------------------------------------------------
// Resolution, at folder setup
// ---------------------------------------------------------------------------

export type ResolutionResult =
  | {
      status: "matched"
      contactId: string
      displayName: string
      /** How we got here. A pasted id is a human decision and outranks a search. */
      source: "search" | "pasted"
      contact: GhlContact
    }
  | { status: "not_found"; contactId: null }
  | { status: "invalid_link"; contactId: null }

/**
 * Find the GHL contact for a client by email. READ ONLY -- never creates.
 *
 * Returns "not_found" rather than throwing: plenty of coached clients are
 * simply not in GHL, and that is a state the coach resolves by pasting a link,
 * not an error.
 */
export async function resolveByEmail(email: string, cfg: GhlConfig): Promise<ResolutionResult> {
  const contact = await findContactByEmail(email, cfg)
  if (!contact) return { status: "not_found", contactId: null }
  return {
    status: "matched",
    contactId: contact.id,
    displayName: contactDisplayName(contact),
    source: "search",
    contact,
  }
}

/**
 * The coach pasted a GHL contact link because the search missed or matched the
 * wrong person. The id is parsed, then CONFIRMED against GHL so the coach sees
 * a name before it is stored -- a pasted id that resolves to nothing, or to
 * somebody else, is exactly what this step exists to catch.
 */
export async function resolveByPastedLink(
  link: string,
  cfg: GhlConfig,
  fetchContact: (id: string, cfg: GhlConfig) => Promise<GhlContact | null>,
): Promise<ResolutionResult> {
  const id = parseContactLink(link)
  if (!id) return { status: "invalid_link", contactId: null }
  const contact = await fetchContact(id, cfg)
  if (!contact) return { status: "not_found", contactId: null }
  return {
    status: "matched",
    contactId: contact.id,
    displayName: contactDisplayName(contact),
    source: "pasted",
    contact,
  }
}

/**
 * Which address to look the client up by, in order.
 *
 * LOGIN EMAIL FIRST. client_profiles.email is what the client actually signed
 * up with and therefore what they read; coach_clients.invited_email is what the
 * coach typed when inviting them, which may be a typo, a work address they
 * stopped using, or a personal one they never activated. Trying the login email
 * first means the match follows the person, not the invitation.
 *
 * Blank and duplicate entries are dropped so a caller cannot accidentally probe
 * GHL twice with the same string.
 */
export function candidateEmails(args: {
  loginEmail?: string | null
  invitedEmail?: string | null
}): string[] {
  const out: string[] = []
  for (const e of [args.loginEmail, args.invitedEmail]) {
    const t = String(e ?? "").trim()
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  return out
}

/** Try each candidate address in order; first match wins. */
export async function resolveForClient(
  args: { loginEmail?: string | null; invitedEmail?: string | null },
  cfg: GhlConfig,
): Promise<ResolutionResult & { triedEmail?: string }> {
  const emails = candidateEmails(args)
  for (const email of emails) {
    const r = await resolveByEmail(email, cfg)
    if (r.status === "matched") return { ...r, triedEmail: email }
  }
  return { status: "not_found", contactId: null }
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

export type StepOutcome = "ok" | "failed"

export type ShareResult = {
  contactId: string
  note: { outcome: StepOutcome; id?: string | null; error?: string }
  tag: { outcome: StepOutcome; tags?: string[]; error?: string }
  /** True only when the tag landed, i.e. the client has actually been emailed. */
  emailed: boolean
}

export type ShareOptions = { now?: Date }

/**
 * Note, then tag. The tag emails the client.
 *
 * A failed note does NOT stop the tag. The note is an audit line for the coach;
 * the tag is the client being told their plan is ready. Losing the first to
 * protect the second would be the wrong trade.
 */
export async function shareNetworkingPlan(
  args: { contactId: string },
  cfg: GhlConfig,
  opts: ShareOptions = {},
): Promise<ShareResult> {
  const result: ShareResult = {
    contactId: args.contactId,
    note: { outcome: "failed" },
    tag: { outcome: "failed" },
    emailed: false,
  }

  try {
    const n = await addContactNote(args.contactId, networkingPlanNoteText(opts.now), cfg)
    result.note = { outcome: "ok", id: n.id }
  } catch (e: any) {
    result.note = { outcome: "failed", error: String(e?.message ?? e) }
  }

  try {
    const tags = await addContactTags(args.contactId, [NETWORKING_PLAN_TAG], cfg)
    result.tag = { outcome: "ok", tags }
    result.emailed = true
  } catch (e: any) {
    result.tag = { outcome: "failed", error: String(e?.message ?? e) }
  }

  return result
}

/**
 * A RE-SHARE SENDS NOTHING.
 *
 * The coach regenerates a plan and shares again. The client already has the
 * link and already has the tag, so all that is left to record is that it
 * happened. A second "your plan is ready" email erodes trust in the tool faster
 * than a missing feature does.
 *
 * The tag is deliberately untouched. Whether a no-op re-add re-fires the
 * workflow is a GHL workflow setting we cannot read from the API, so not
 * touching it is the only behaviour that is certain.
 */
export async function reshareNetworkingPlan(
  args: { contactId: string },
  cfg: GhlConfig,
  opts: ShareOptions = {},
): Promise<{ contactId: string; note: ShareResult["note"]; emailed: false }> {
  try {
    const n = await addContactNote(args.contactId, networkingPlanNoteText(opts.now) + " (updated)", cfg)
    return { contactId: args.contactId, note: { outcome: "ok", id: n.id }, emailed: false }
  } catch (e: any) {
    return {
      contactId: args.contactId,
      note: { outcome: "failed", error: String(e?.message ?? e) },
      emailed: false,
    }
  }
}

export type ResendResult = {
  removed: string[]
  added: string[]
  emailed: boolean
  /** Set when the tag was removed and could not be put back. See below. */
  tagLost: boolean
  attempts: number
  error?: string
}

/**
 * The "Re-send email" button, and the ONLY path that re-emails a client.
 *
 * Remove the tag, then add it back, because a plain re-add may or may not
 * re-fire the workflow depending on its re-entry setting -- and a button
 * labelled "Re-send email" is promising that it definitely does.
 *
 * THE DANGEROUS WINDOW is between the two calls. If the remove succeeds and the
 * add fails, the contact has lost the tag: their record no longer says a plan
 * was shared, and no email went out either. So the add is retried ONCE, and if
 * that also fails the caller is told `tagLost` so it can show the coach
 * "Re-send failed, click again" rather than a generic error. Clicking again is
 * safe and is the repair: remove is a no-op on a contact with no tag, and the
 * add is what was missing.
 */
export async function resendNetworkingPlanEmail(
  args: { contactId: string },
  cfg: GhlConfig,
): Promise<ResendResult> {
  let removed: string[] = []
  try {
    removed = await removeContactTags(args.contactId, [NETWORKING_PLAN_TAG], cfg)
  } catch (e: any) {
    // Nothing was touched, so nothing is lost.
    return { removed: [], added: [], emailed: false, tagLost: false, attempts: 0, error: String(e?.message ?? e) }
  }

  let lastError = ""
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const added = await addContactTags(args.contactId, [NETWORKING_PLAN_TAG], cfg)
      return { removed, added, emailed: true, tagLost: false, attempts: attempt }
    } catch (e: any) {
      lastError = String(e?.message ?? e)
    }
  }

  return { removed, added: [], emailed: false, tagLost: true, attempts: 2, error: lastError }
}
