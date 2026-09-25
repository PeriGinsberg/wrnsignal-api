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
 * WHAT THIS FILE DOES NOW: resolves a client to their GoHighLevel contact, and
 * writes one audit note on it.
 *
 *   1. note   "Networking Plan shared from SIGNAL on <date>"
 *
 * THERE IS NO STEP 2 ANY MORE. Until 2026-09-26 the note was followed by the
 * tag `networking-plan-shared`, and a GHL workflow watching that tag sent the
 * client their email. That made GoHighLevel the thing that told the client,
 * with SIGNAL blind to whether it worked.
 *
 * SIGNAL now sends that email itself, through the Postmark template
 * `networking-plan-ready`. See lib/email/sendNetworkingPlanReady.ts and
 * emailClientPlanReady in lib/networking-plan/job.ts.
 *
 * So nothing in this file is irreversible any more. The note is an audit line
 * for people working in GHL; it is not, and never was, how the plan reaches the
 * client. That is the Drive link and the SIGNAL library.
 */

import type { GhlConfig } from "./client"
import {
  addContactNote,
  contactDisplayName,
  findContactByEmail,
  networkingPlanNoteText,
  parseContactLink,
  searchContactsByEmail,
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

/**
 * Resolve a client's GHL contact with NO human in the loop.
 *
 * Tries each candidate address in order and accepts a match only when that
 * address returns EXACTLY ONE contact. Anything else is refused:
 *
 *   0 matches  -> try the next address, then give up as "not_found"
 *   1 match    -> store it and proceed
 *   2+ matches -> "ambiguous", store NOTHING
 *
 * WHY AMBIGUOUS IS A REFUSAL AND NOT A COIN FLIP. The cost of picking wrong is
 * not a misfiled document: it emails one client's plan to a different person.
 * Two contacts sharing an address is rare and is somebody's data problem; the
 * right response is to leave it alone and let a human paste the link, which is
 * the same escape hatch "not_found" uses.
 *
 * Returns the address that produced the answer so the coach can be told which
 * email was searched, not just that nothing was found.
 */
export type AutoResolution =
  | { status: "matched"; contactId: string; displayName: string; matchedOn: string; contact: GhlContact }
  | { status: "not_found"; triedEmails: string[] }
  | { status: "ambiguous"; email: string; count: number }
  | { status: "no_email" }

export async function autoResolveContact(
  args: { loginEmail?: string | null; invitedEmail?: string | null },
  cfg: GhlConfig,
): Promise<AutoResolution> {
  const emails = candidateEmails(args)
  if (emails.length === 0) return { status: "no_email" }

  for (const email of emails) {
    const hits = await searchContactsByEmail(email, cfg)
    if (hits.length === 1) {
      return {
        status: "matched",
        contactId: hits[0].id,
        displayName: contactDisplayName(hits[0]),
        matchedOn: email,
        contact: hits[0],
      }
    }
    if (hits.length > 1) return { status: "ambiguous", email, count: hits.length }
  }
  return { status: "not_found", triedEmails: emails }
}

/** What the coach is told when nothing was wired and nothing was sent. */
export function noContactMessage(r: AutoResolution): string {
  if (r.status === "not_found") {
    return `No GHL contact found for ${r.triedEmails.join(" or ")}, client was not emailed.`
  }
  if (r.status === "ambiguous") {
    return `${r.count} GHL contacts share ${r.email}, so none was chosen and the client was not emailed. Paste the right contact link.`
  }
  if (r.status === "no_email") {
    return "This client has no email on file, so no GHL contact could be found and the client was not emailed."
  }
  return ""
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

export type StepOutcome = "ok" | "failed"

export type ShareResult = {
  contactId: string
  note: { outcome: StepOutcome; id?: string | null; error?: string }
}

export type ShareOptions = { now?: Date }

/**
 * Write the audit note on the client's GoHighLevel contact.
 *
 * THE TAG IS GONE. Until 2026-09-26 this also put `networking-plan-shared` on
 * the contact, and a GHL workflow watching that tag sent the client their
 * email. SIGNAL now sends that email itself through Postmark, so writing the
 * tag as well would send it twice. The GHL workflow was confirmed to be the
 * only thing keying off that tag before it was removed.
 *
 * What is left is the note, which is what it always was: a line on the contact
 * so anyone working in GHL can see the plan went out. It is not how the client
 * is told, and it never was.
 */
export async function shareNetworkingPlan(
  args: { contactId: string },
  cfg: GhlConfig,
  opts: ShareOptions = {},
): Promise<ShareResult> {
  try {
    const n = await addContactNote(args.contactId, networkingPlanNoteText(opts.now), cfg)
    return { contactId: args.contactId, note: { outcome: "ok", id: n.id } }
  } catch (e: any) {
    return { contactId: args.contactId, note: { outcome: "failed", error: String(e?.message ?? e) } }
  }
}

/**
 * A RE-SHARE SENDS NOTHING.
 *
 * The coach regenerates a plan and shares again. The client already has the
 * link, so all that is left to record is that it happened. A second "your plan
 * is ready" email erodes trust in the tool faster than a missing feature does.
 */
export async function reshareNetworkingPlan(
  args: { contactId: string },
  cfg: GhlConfig,
  opts: ShareOptions = {},
): Promise<{ contactId: string; note: ShareResult["note"] }> {
  try {
    const n = await addContactNote(args.contactId, networkingPlanNoteText(opts.now) + " (updated)", cfg)
    return { contactId: args.contactId, note: { outcome: "ok", id: n.id } }
  } catch (e: any) {
    return { contactId: args.contactId, note: { outcome: "failed", error: String(e?.message ?? e) } }
  }
}

// resendNetworkingPlanEmail lived here until 2026-09-26. It removed the tag
// and added it back, because a plain re-add might not re-fire the GHL workflow
// and a button labelled "Re-send email" has to actually re-send. That whole
// dance existed only because GoHighLevel owned the email. SIGNAL owns it now,
// so re-sending is simply sending again: see resendPlanEmail in
// lib/networking-plan/job.ts.
