/**
 * Exercise the Networking Plan → GHL sync against a real contact.
 *
 *   GHL_API_KEY=... GHL_LOCATION_ID=... \
 *     npx tsx tests/ghl/run-networking-plan-sync.ts --email <addr> [--share] [--resend]
 *
 * Default is READ ONLY: resolve the contact by email and print what matched.
 *
 *   --share   adds the note, then ADDS THE TAG
 *   --resend  removes and re-adds the tag
 *
 * BOTH WRITE FLAGS SEND A REAL EMAIL. Erin's workflow triggers on
 * networking-plan-shared. Only run them against an address you own.
 */

import { ghlConfig } from "../../lib/ghl/client"
import {
  NETWORKING_PLAN_TAG,
  getContactById,
  networkingPlanNoteText,
} from "../../lib/ghl/contacts"
import {
  resolveByEmail,
  shareNetworkingPlan,
  resendNetworkingPlanEmail,
} from "../../lib/ghl/networkingPlanSync"
import { ghlRequest } from "../../lib/ghl/client"

const arg = (n: string) => {
  const i = process.argv.indexOf("--" + n)
  const v = process.argv[i + 1]
  return i >= 0 && v && !v.startsWith("--") ? v : undefined
}
const EMAIL = arg("email")
const SHARE = process.argv.includes("--share")
const RESEND = process.argv.includes("--resend")
const PLAN_URL = arg("url") ?? "https://drive.google.com/file/d/SIGNAL-TEST-PLAN/view"

/** Read the contact back so tags and notes are confirmed from GHL, not assumed. */
async function showContactState(contactId: string, cfg: ReturnType<typeof ghlConfig>) {
  const c = await ghlRequest<any>(`/contacts/${encodeURIComponent(contactId)}`, { method: "GET" }, cfg)
  const contact = c.data?.contact ?? c.data
  console.log("    tags on contact : " + JSON.stringify(contact?.tags ?? []))
  try {
    const n = await ghlRequest<any>(
      `/contacts/${encodeURIComponent(contactId)}/notes`,
      { method: "GET" },
      cfg,
    )
    const notes: any[] = n.data?.notes ?? []
    console.log("    notes on contact: " + notes.length)
    for (const note of notes.slice(0, 3)) {
      console.log("       " + String(note.dateAdded ?? "").slice(0, 19) + "  " + JSON.stringify(String(note.body ?? "").slice(0, 70)))
    }
  } catch (e: any) {
    console.log("    notes: could not read back (" + String(e?.message ?? e).slice(0, 80) + ")")
  }
}

;(async () => {
  if (!EMAIL) {
    console.error("--email <address> is required")
    process.exit(1)
  }
  const cfg = ghlConfig()

  console.log("NETWORKING PLAN GHL SYNC")
  console.log("  location   : " + cfg.locationId)
  console.log("  version    : " + cfg.version)
  console.log("  email      : " + EMAIL)
  console.log("  mode       : " + (RESEND ? "RESEND" : SHARE ? "SHARE (sends email)" : "read-only resolve") + "\n")

  // ---- 1. resolution, as it happens at folder setup
  console.log("1. RESOLVE BY EMAIL  (GET /contacts/search/duplicate, read-only)")
  const r = await resolveByEmail(EMAIL, cfg)
  console.log("   status : " + r.status)
  if (r.status !== "matched") {
    console.log("   no contact matched; at folder setup the coach would paste a GHL contact link here.")
    process.exit(0)
  }
  console.log("   contact: " + r.contactId)
  console.log("   name   : " + r.displayName)
  console.log("   source : " + r.source)

  const before = await getContactById(r.contactId, cfg)
  console.log("\n   BEFORE")
  await showContactState(r.contactId, cfg)

  if (!SHARE && !RESEND) {
    console.log("\nread-only run complete. Pass --share to add the note and tag (sends an email).")
    return
  }

  if (RESEND) {
    console.log("\n2. RE-SEND EMAIL  (remove tag, then add it back)")
    const res = await resendNetworkingPlanEmail({ contactId: r.contactId }, cfg)
    console.log("   removed  -> " + JSON.stringify(res.removed))
    console.log("   added    -> " + JSON.stringify(res.added))
    console.log("   attempts : " + res.attempts)
    console.log("   emailed  : " + res.emailed + (res.error ? "   ERROR " + res.error : ""))
    if (res.tagLost) {
      console.log("   TAG LOST : removed but could not be re-added after 2 tries.")
      console.log("              The coach sees: \"Re-send failed, click again\"")
    }
  } else {
    console.log("\n2. SHARE  (note, then tag)")
    const res = await shareNetworkingPlan({ contactId: r.contactId }, cfg)
    console.log("   note  : " + res.note.outcome + (res.note.id ? "   id " + res.note.id : "") + (res.note.error ? "   " + res.note.error : ""))
    console.log("   tag   : " + res.tag.outcome + (res.tag.tags ? "   now " + JSON.stringify(res.tag.tags) : "") + (res.tag.error ? "   " + res.tag.error : ""))
    console.log("   emailed: " + res.emailed)
  }

  console.log("\n   AFTER")
  await showContactState(r.contactId, cfg)
  console.log("\n   expected note text: " + JSON.stringify(networkingPlanNoteText()))
  console.log("   expected tag      : " + NETWORKING_PLAN_TAG)
})().catch((e) => {
  console.error("\nFAILED: " + (e?.message ?? e))
  process.exit(1)
})
