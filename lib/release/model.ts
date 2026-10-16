// lib/release/model.ts
//
// The Release-step email: the coach's template for a client step, turned into
// a draft for one client. No database here, so the Message panel and the
// Settings tab can use it in the browser.
//
// THE FIELDS. SIGNAL fills three before the draft opens:
//   [First Name]          the client's first name ("there" when unknown)
//   [Drive folder link]   the client's Drive workspace (coach_clients.workspace_folder_url)
//   [Scheduling link]     this step's Calendly link, from the template
// Any other [bracket], such as [TRACK] or [RESUME LINK], is for the coach to
// fill. The email cannot go while a bracket is left, and that includes a field
// SIGNAL had nothing to fill with (no Drive workspace yet, no scheduling link).
//
// The draft is plain text in the Message panel and goes out as a coach message
// (lib/messaging/sendCoachMessage.ts), so links stay as typed addresses.

export const RELEASE_SUBJECT_MAX = 200
export const RELEASE_BODY_MAX = 6000
export const RELEASE_LINK_MAX = 500

export const FIRST_NAME_TOKEN = "[First Name]"
export const DRIVE_TOKEN = "[Drive folder link]"
export const SCHEDULING_TOKEN = "[Scheduling link]"

const FIRST_NAME_RE = /\[\s*first\s+name\s*\]/gi
const DRIVE_RE = /\[\s*drive\s+folder\s+link\s*\]/gi
const SCHED_RE = /\[\s*scheduling\s+link\s*\]/gi
const BRACKET_RE = /\[[^[\]\n]{1,200}\]/g

export type ReleaseTemplate = { activity_id: string; subject: string; body: string; scheduling_link: string | null }

/** The three fields SIGNAL fills. A field with no value is left for the bracket check to catch. */
export function fillReleaseFields(text: string, v: { firstName: string | null | undefined; drive: string | null; scheduling: string | null }): string {
  let out = text.replace(FIRST_NAME_RE, v.firstName?.trim() || "there")
  if (v.drive) out = out.replace(DRIVE_RE, v.drive)
  if (v.scheduling) out = out.replace(SCHED_RE, v.scheduling)
  return out
}

/** Every [bracket] still in the text, once each, in the order they appear. */
export function leftoverBrackets(text: string): string[] {
  return [...new Set(text.match(BRACKET_RE) ?? [])]
}

/**
 * Why this draft can't go yet, or null. The send checks it again on the server.
 * A field SIGNAL fills gets its own reason, since the coach can't fix it by typing.
 */
export function releaseProblem(subject: string, body: string): string | null {
  const left = leftoverBrackets(`${subject}\n${body}`)
  if (!left.length) return null
  if (left.some((b) => new RegExp(DRIVE_RE.source, "i").test(b))) {
    return `This client has no Drive workspace yet, so ${DRIVE_TOKEN} has nothing to link to.`
  }
  if (left.some((b) => new RegExp(SCHED_RE.source, "i").test(b))) {
    return `This step's email has no scheduling link. Add it in Settings > Services > Release emails, or take ${SCHEDULING_TOKEN} out.`
  }
  return `Fill in ${left.join(", ")} before sending.`
}

/** A scheduling link as typed: blank is none; anything else must be a web address. */
export function normalizeReleaseLink(v: unknown): { value: string | null } | { error: string } {
  if (v === null || v === undefined) return { value: null }
  if (typeof v !== "string") return { error: "The scheduling link must be text." }
  const s = v.trim()
  if (!s) return { value: null }
  if (s.length > RELEASE_LINK_MAX) return { error: `The scheduling link can be at most ${RELEASE_LINK_MAX} characters.` }
  if (!/^https?:\/\/\S+$/i.test(s)) return { error: "The scheduling link must start with https:// (copy it from Calendly)." }
  return { value: s }
}
