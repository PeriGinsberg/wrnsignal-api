// lib/briefs/model.ts
//
// What a Networking Campaign Brief is, and what makes one valid.
//
// A BRIEF IS A SNAPSHOT. Its values are seeded from the client's profile, but
// once saved the brief owns them and nothing writes back. See the migration
// header for why: a client's targets legitimately change between campaigns,
// and a brief that followed the profile would rewrite the history of what was
// asked for.

export const BRIEF_STATUSES = ["draft", "submitted"] as const
export type BriefStatus = (typeof BRIEF_STATUSES)[number]

/** The five list fields, in the order the form shows them. */
export const LIST_FIELDS = [
  "primary_roles",
  "secondary_roles",
  "primary_industries",
  "secondary_industries",
  "locations",
] as const
export type ListField = (typeof LIST_FIELDS)[number]

/** The two prose fields. */
export const TEXT_FIELDS = ["education_status", "immediate_goals", "notes_for_builder"] as const
export type TextField = (typeof TEXT_FIELDS)[number]

export type CampaignBrief = {
  id: string
  coach_client_id: string
  client_profile_id: string
  name: string
  status: BriefStatus
  education_status: string | null
  immediate_goals: string | null
  primary_roles: string[]
  secondary_roles: string[]
  primary_industries: string[]
  secondary_industries: string[]
  locations: string[]
  notes_for_builder: string | null
  ai_suggestions: Record<string, unknown> | null
  prefilled_fields: string[]
  submitted_at: string | null
  submitted_by_id: string | null
  created_by_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export const BRIEF_COLUMNS =
  "id, coach_client_id, client_profile_id, name, status, education_status, immediate_goals, " +
  "primary_roles, secondary_roles, primary_industries, secondary_industries, locations, " +
  "notes_for_builder, ai_suggestions, prefilled_fields, submitted_at, submitted_by_id, " +
  "created_by_id, created_at, updated_at, deleted_at"

export function isBriefStatus(v: unknown): v is BriefStatus {
  return typeof v === "string" && (BRIEF_STATUSES as readonly string[]).includes(v)
}

/**
 * Anything list-shaped into a clean string[].
 *
 * ACCEPTS A COMMA-SEPARATED STRING as well as an array, because the form sends
 * chips and a paste from a document sends "Analyst, Associate, Strategy". Both
 * are the same thing to a coach and refusing one would only teach them to
 * retype it.
 *
 * Trims, drops blanks, and de-duplicates case-insensitively while keeping the
 * first spelling: "Analyst" and "analyst" are one target, and the one the coach
 * typed first is the one they meant.
 */
export function toList(v: unknown): string[] {
  const raw: string[] = Array.isArray(v)
    ? v.map((x) => String(x ?? ""))
    : typeof v === "string"
      ? v.split(/[,\n;]/)
      : []

  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const s = item.trim()
    if (!s) continue
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(s)
  }
  return out
}

/**
 * What must be true before a brief can be submitted.
 *
 * ONLY TWO THINGS ARE REQUIRED: a name and at least one primary role. The
 * builder can work from "analyst roles in New York" and cannot work from
 * nothing, and every other field is genuinely optional. A form that demanded
 * industries would get "n/a" typed into it, which is worse than blank because
 * the plan would then target it.
 */
export function validateForSubmit(brief: Partial<CampaignBrief>): string[] {
  const errors: string[] = []
  if (!String(brief.name ?? "").trim()) errors.push("Give the campaign a name.")
  if (!toList(brief.primary_roles).length) {
    errors.push("Add at least one primary role, or the builder has nothing to search for.")
  }
  return errors
}

/** Field-level checks for any write, submitted or not. */
export function validateBriefWrite(input: Record<string, any>, opts: { partial?: boolean } = {}): string[] {
  const errors: string[] = []
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k)

  if (!opts.partial || has("name")) {
    const name = String(input.name ?? "").trim()
    if (!name) errors.push("Give the campaign a name.")
    else if (name.length > 120) errors.push("That campaign name is too long.")
  }

  for (const f of LIST_FIELDS) {
    if (!has(f)) continue
    if (input[f] !== null && !Array.isArray(input[f]) && typeof input[f] !== "string") {
      errors.push(`${f.replace(/_/g, " ")} must be a list.`)
    }
  }

  for (const f of TEXT_FIELDS) {
    if (!has(f) || input[f] == null) continue
    if (typeof input[f] !== "string") errors.push(`${f.replace(/_/g, " ")} must be text.`)
    else if (input[f].length > 4000) errors.push(`${f.replace(/_/g, " ")} is too long.`)
  }

  return errors
}

/** A default campaign name, so the coach can accept it rather than invent one. */
export function defaultBriefName(clientName: string | null, now = new Date()): string {
  const month = now.toLocaleDateString("en-US", { month: "long", year: "numeric" })
  return clientName ? `${clientName} - ${month}` : `Networking campaign - ${month}`
}

/**
 * The one-line reading of a brief used in lists and in task email.
 * Kept here so the email and the UI cannot describe the same brief differently.
 */
export function briefLine(b: Pick<CampaignBrief, "primary_roles" | "primary_industries" | "locations">): string {
  const bits: string[] = []
  if (b.primary_roles?.length) bits.push(b.primary_roles.join(", "))
  if (b.primary_industries?.length) bits.push(b.primary_industries.join(", "))
  if (b.locations?.length) bits.push(b.locations.join(", "))
  return bits.join(" · ")
}
