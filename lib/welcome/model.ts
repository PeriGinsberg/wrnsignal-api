// lib/welcome/model.ts
//
// The welcome email: its four templates, which one a plan gets, and how the
// coach's text becomes the email. No database here, so the editor and the
// Settings tab can use it in the browser.
//
// THE FOUR STARTING POINTS, matched by the phase of the welcome task's
// deliverable (agreed 2026-10-05): Know is Your SIGNAL DNA, any plan starting
// in Build is the Resume Workshop, Search is Search, Land is Land. Prove, or a
// phase the coach added, matches nothing and the coach picks.
//
// The coach's text is escaped before it becomes HTML, so nothing typed into
// the editor can change the email's markup.

export const WELCOME_STARTS = ["dna", "resume_workshop", "search", "land"] as const
export type WelcomeStart = (typeof WELCOME_STARTS)[number]

export const WELCOME_START_LABEL: Record<WelcomeStart, string> = {
  dna: "Your SIGNAL DNA",
  resume_workshop: "Resume Workshop",
  search: "Search",
  land: "Land",
}

const START_BY_PHASE: Record<string, WelcomeStart> = {
  know: "dna",
  build: "resume_workshop",
  search: "search",
  land: "land",
}

export function isWelcomeStart(v: unknown): v is WelcomeStart {
  return typeof v === "string" && (WELCOME_STARTS as readonly string[]).includes(v)
}

/** The template for a plan whose welcome task sits in this phase, or null. */
export function startForPhase(phaseKey: string | null | undefined): WelcomeStart | null {
  return (phaseKey && START_BY_PHASE[phaseKey]) || null
}

export const WELCOME_EMAIL_TEMPLATE = "welcome-email"
export const WELCOME_SUBJECT_MAX = 200
export const WELCOME_BODY_MAX = 6000
export const WELCOME_LINK_MAX = 500

export const DRIVE_TOKEN = "[Drive folder link]"
export const SCHEDULING_TOKEN = "[Scheduling link]"
export const DRIVE_BUTTON = "Open your Drive workspace"
export const SCHEDULING_BUTTON = "Book your session"

const DRIVE_RE = /\[\s*drive\s+folder\s+link\s*\]/i
const DRIVE_RE_ALL = /\[\s*drive\s+folder\s+link\s*\]/gi
const SCHED_RE = /\[\s*scheduling\s+link\s*\]/i
const SCHED_RE_ALL = /\[\s*scheduling\s+link\s*\]/gi

export const usesDrive = (body: string) => DRIVE_RE.test(body)
export const usesScheduling = (body: string) => SCHED_RE.test(body)

export type WelcomeTemplate = { start_key: WelcomeStart; subject: string; body: string; scheduling_link: string | null }

/** [First Name] filled ("there" when the name is unknown); the link placeholders stay for the send. */
export function fillFirstName(text: string, firstName: string | null | undefined): string {
  return text.replace(/\[\s*first\s+name\s*\]/gi, firstName?.trim() || "there")
}

/** A scheduling link as typed: blank is none; anything else must be a web address. */
export function normalizeLink(v: unknown): { value: string | null } | { error: string } {
  if (v === null || v === undefined) return { value: null }
  if (typeof v !== "string") return { error: "The scheduling link must be text." }
  const s = v.trim()
  if (!s) return { value: null }
  if (s.length > WELCOME_LINK_MAX) return { error: `The scheduling link can be at most ${WELCOME_LINK_MAX} characters.` }
  if (!/^https?:\/\/\S+$/i.test(s)) return { error: "The scheduling link must start with https:// (copy it from Calendly)." }
  return { value: s }
}

/**
 * Why this email can't go yet, or null. The send checks it again on the server.
 */
export function welcomeProblem(args: { subject: string; body: string; driveUrl: string | null; schedulingLink: string | null }): string | null {
  if (!args.subject.trim()) return "The email needs a subject."
  if (args.subject.trim().length > WELCOME_SUBJECT_MAX) return `The subject can be at most ${WELCOME_SUBJECT_MAX} characters.`
  if (!args.body.trim()) return "The email needs a message."
  if (args.body.trim().length > WELCOME_BODY_MAX) return `The message can be at most ${WELCOME_BODY_MAX} characters.`
  if (usesDrive(args.body) && !args.driveUrl) return `This client has no Drive workspace yet, so ${DRIVE_TOKEN} has nothing to link to.`
  if (usesScheduling(args.body) && !args.schedulingLink) return `This template has no scheduling link. Add it in Settings > Services > Welcome emails, or take ${SCHEDULING_TOKEN} out.`
  return null
}

const INK = "#08203F"
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

/** A solid navy button, table-wrapped for Outlook (the SOW email's button). */
function button(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px 0;">
  <tr><td align="center" bgcolor="${INK}" style="border-radius:8px;">
    <a href="${esc(url)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;">${esc(label)}</a>
  </td></tr>
</table>`
}

/** A heading line: all capitals, like "YOUR WORKSPACE". */
const isHeading = (line: string) => /[A-Z]/.test(line) && line === line.toUpperCase() && !/[a-z]/.test(line) && line.length <= 80

/**
 * The coach's text as the email's HTML and plain-text bodies. Paragraphs split
 * on blank lines. In a paragraph, a line that is only a link placeholder
 * becomes its button, a placeholder inside a sentence becomes a plain link, and
 * an all-capitals first line is bold.
 */
export function renderWelcomeEmail(body: string, links: { drive: string | null; scheduling: string | null }): { html: string; text: string } {
  const paras = body.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const inline = (s: string) => {
    let out = esc(s)
    if (links.drive) out = out.replace(DRIVE_RE_ALL, `<a href="${esc(links.drive)}" style="color:${INK};font-weight:bold;">${DRIVE_BUTTON}</a>`)
    if (links.scheduling) out = out.replace(SCHED_RE_ALL, `<a href="${esc(links.scheduling)}" style="color:${INK};font-weight:bold;">${SCHEDULING_BUTTON}</a>`)
    return out
  }
  const html = paras.map((p) => {
    const parts: string[] = []
    let text: string[] = []
    const flush = () => {
      if (!text.length) return
      parts.push(`<p style="margin:0 0 14px 0;font-family:${FONT};font-size:15px;line-height:1.6;color:${INK};">${text.join("<br>")}</p>`)
      text = []
    }
    p.split("\n").map((l) => l.trim()).forEach((line, i) => {
      if (links.drive && DRIVE_RE.test(line) && line.replace(DRIVE_RE_ALL, "").trim() === "") { flush(); parts.push(button(links.drive, DRIVE_BUTTON)); return }
      if (links.scheduling && SCHED_RE.test(line) && line.replace(SCHED_RE_ALL, "").trim() === "") { flush(); parts.push(button(links.scheduling, SCHEDULING_BUTTON)); return }
      text.push(i === 0 && isHeading(line) ? `<strong>${esc(line)}</strong>` : inline(line))
    })
    flush()
    return parts.join("\n")
  }).join("\n")
  const plain = paras.map((p) => {
    let t = p
    if (links.drive) t = t.replace(DRIVE_RE_ALL, links.drive)
    if (links.scheduling) t = t.replace(SCHED_RE_ALL, links.scheduling)
    return t
  }).join("\n\n") + "\n"
  return { html, text: plain }
}

/** Is this To-Do item the one for a plan's welcome task? (lib/plan/model taskTitle writes it.) */
export function isWelcomeTodo(t: { plan_activity_id?: string | null; title?: string | null; coach_client_id?: string | null }): boolean {
  return !!t.plan_activity_id && !!t.coach_client_id && (t.title ?? "").startsWith("Send welcome email (releases: ")
}
