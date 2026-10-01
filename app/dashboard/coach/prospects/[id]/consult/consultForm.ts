// The consult screen's form state: built from what the server returns, and
// turned back into the PUT body. Kept apart from the page so it can be tested
// without rendering it.
//
// Strings throughout ("" for empty), as inputs want them; the server turns
// "" back into NULL and works out what actually changed.

import type { MaterialState, SearchGoal, Service } from "../../../../../../lib/prospects/model"

export type ConsultProspect = {
  id: string
  lifecycle_status: string
  prospect_status: string | null
  name: string | null
  invited_email: string | null
  phone: string | null
  parent_name: string | null
  parent_email: string | null
  parent_phone: string | null
  source_category: string | null
  source_detail: string | null
  referred_by_name: string | null
  referred_by_email: string | null
  current_title: string | null
  current_company: string | null
  university: string | null
  field_of_study: string | null
  grad_date: string | null
  target_roles: string | null
  target_industries: string | null
  target_locations: string | null
}

export type ConsultRecord = {
  scheduled_for: string | null
  why_now: string | null
  search_goal: SearchGoal | null
  search_goal_other: string | null
  services: Service[]
  timeline_deadlines: string | null
  timeline_start: string | null
  timeline_season: string | null
  tried_so_far: string | null
  material_resume: MaterialState | null
  material_linkedin: MaterialState | null
  material_cover_letter: MaterialState | null
  recommendation: string | null
  next_steps: string | null
  outcome: "completed" | "no_show" | "not_a_fit" | null
  outcome_at: string | null
  minutes_logged: number | null
}

export const KNOWN_FIELDS = [
  "name", "invited_email", "phone", "parent_name", "parent_email", "parent_phone",
  "source_category", "source_detail", "referred_by_name", "referred_by_email",
  "current_title", "current_company", "university", "field_of_study", "grad_date",
  "target_roles", "target_industries", "target_locations",
] as const
export type KnownField = (typeof KNOWN_FIELDS)[number]

export const LIVE_TEXT_FIELDS = [
  "why_now", "search_goal", "search_goal_other", "timeline_deadlines", "timeline_start", "timeline_season",
  "tried_so_far", "material_resume", "material_linkedin", "material_cover_letter", "recommendation", "next_steps",
] as const
export type LiveField = (typeof LIVE_TEXT_FIELDS)[number]

export type ConsultForm = {
  known: Record<KnownField, string>
  live: Record<LiveField, string>
  services: Service[]
}

export function formFrom(p: ConsultProspect, c: ConsultRecord): ConsultForm {
  const known = {} as Record<KnownField, string>
  for (const k of KNOWN_FIELDS) known[k] = (p[k] as string | null) ?? ""
  const live = {} as Record<LiveField, string>
  for (const k of LIVE_TEXT_FIELDS) live[k] = (c[k] as string | null) ?? ""
  return { known, live, services: [...(c.services ?? [])] }
}

/** The PUT body. Every field is sent; the server saves only what changed. */
export function saveBody(f: ConsultForm): { prospect: Record<string, string | null>; consult: Record<string, unknown> } {
  const prospect: Record<string, string | null> = {}
  for (const k of KNOWN_FIELDS) prospect[k] = f.known[k].trim() || null
  // Referred-by and Other's text only mean something with their source.
  if (prospect.source_category !== "other") prospect.source_detail = null
  if (prospect.source_category !== "friend_family" && prospect.source_category !== "past_client") {
    delete prospect.referred_by_name
    delete prospect.referred_by_email
  }
  if (prospect.name === null) delete prospect.name // a blank name is not a change
  // An older prospect may have no lead source. Sending an empty one would be
  // refused (it is required once set), so leave all four keys out until one
  // is picked.
  if (prospect.source_category === null) {
    for (const k of ["source_category", "source_detail", "referred_by_name", "referred_by_email"]) delete prospect[k]
  }
  const consult: Record<string, unknown> = { services: f.services }
  for (const k of LIVE_TEXT_FIELDS) consult[k] = f.live[k].trim() || null
  if (consult.search_goal !== "other") consult.search_goal_other = null
  return { prospect, consult }
}

/** True when the form differs from what was loaded. */
export function isDirty(form: ConsultForm, loaded: ConsultForm): boolean {
  return JSON.stringify(saveBody(form)) !== JSON.stringify(saveBody(loaded))
}

/** "Draft SOW for [name]" with the name filled in. */
export function fillName(step: string, name: string | null): string {
  return step.replace(/\[name\]/g, name?.trim() || "this prospect")
}
