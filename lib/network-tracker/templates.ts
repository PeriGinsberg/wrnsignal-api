// lib/network-tracker/templates.ts
// Phase 8a — merging the 24 code defaults with a client's overrides.
//
// Defaults live in code (template-defaults.ts); the DB holds a row only when
// someone edits one. So the merge is the whole of 8a's logic and it is pure —
// no I/O, testable without a database.

import { TEMPLATE_DEFAULTS, type TemplateDefault } from "./template-defaults"

export type TemplateOverrideRow = {
  template_id: string
  body: string
  edited_by: "client" | "coach"
  updated_at?: string | null
}

export type MergedTemplate = {
  template_id: string
  label: string
  body: string
  source: "default" | "override"
  edited_by?: "client" | "coach"
  updated_at?: string | null
}

export const TEMPLATE_IDS: string[] = TEMPLATE_DEFAULTS.map((t) => t.id)
export const DEFAULTS_BY_ID: Record<string, TemplateDefault> =
  Object.fromEntries(TEMPLATE_DEFAULTS.map((t) => [t.id, t]))

export function isKnownTemplateId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEFAULTS_BY_ID, id)
}

/**
 * All 24, in the defaults' order, each marked default-or-override.
 *
 * Order comes from the defaults array, not from the override rows — a client who
 * has edited three templates must still see the same list in the same places,
 * not those three floating to the top. The LABEL always comes from the default
 * even when the body is overridden: the label is what the template is FOR
 * ("Touch 2 · day 7"), which editing the wording does not change.
 *
 * An override whose template_id is not a known default is IGNORED rather than
 * surfaced. That can only happen if a default is renamed or removed after
 * someone edited it, and showing a labelless orphan row is worse than showing
 * the current default.
 */
export function mergeTemplates(overrides: TemplateOverrideRow[]): MergedTemplate[] {
  const byId = new Map(overrides.map((o) => [o.template_id, o]))
  return TEMPLATE_DEFAULTS.map((d) => {
    const o = byId.get(d.id)
    if (!o) {
      return { template_id: d.id, label: d.label, body: d.body, source: "default" as const }
    }
    return {
      template_id: d.id,
      label: d.label,
      body: o.body,
      source: "override" as const,
      edited_by: o.edited_by,
      updated_at: o.updated_at ?? null,
    }
  })
}

// ─── Variable vocabulary (defined in 8a, ACTED ON in 8b) ─────────────────────
//
// Recorded here now so 8a cannot accidentally build a data shape 8b can't use.
// Three kinds, and the third is why no layer may validate or normalise brackets:
// fill-at-send tokens contain spaces and slashes, so a rule requiring
// UPPER_SNAKE would reject the templates a client uses most.
//
// See docs/network-tracker/template-variables.md.

/** Prompts to the WRITER, never resolved from data. Not errors — the message is
 *  meant to be finished by hand before sending. */
export const FILL_AT_SEND_VARIABLES = new Set([
  "MUTUAL",
  "ONE SPECIFIC QUESTION",
  "OPTION 1", "OPTION 2", "OPTION 3",
  "SPECIFIC THING THEY SAID",
  "ONE CONCRETE THING YOU'LL DO BECAUSE OF IT",
  "SPECIFIC THING THEY MENTIONED",
  "ARTICLE / NEWS ABOUT THEIR FIRM",
])

/** Resolve from the contact record. */
export const CONTACT_VARIABLES = new Set(["NAME", "FIRM", "ADDITIONAL_INFO"])

/** Everything else that is a single UPPER_SNAKE token resolves from
 *  network_client_profile — [CURRENT_ROLE] → current_role_title, and so on. The
 *  mapping itself belongs to the 8b renderer. */
export function classifyVariable(token: string): "fill" | "contact" | "profile" {
  if (FILL_AT_SEND_VARIABLES.has(token)) return "fill"
  if (CONTACT_VARIABLES.has(token)) return "contact"
  // Heuristic backstop for a fill-at-send prompt nobody added to the set: every
  // profile/contact token is a single UPPER_SNAKE word, so a space or slash
  // means prose. [MUTUAL] is the single-token exception, which is exactly why
  // the explicit set above exists and is checked first.
  if (/[\s/]/.test(token)) return "fill"
  return "profile"
}

/** Every [BRACKET] token in a body, in order, deduplicated. */
export function extractVariables(body: string): string[] {
  const found = body.match(/\[([^\]]+)\]/g) ?? []
  return [...new Set(found.map((m) => m.slice(1, -1)))]
}

// ─── 8b — the renderer ───────────────────────────────────────────────────────

/** Token → column on network_client_profile. Written out rather than derived by
 *  lower-casing, because [CURRENT_ROLE] resolves from `current_role_title` — the
 *  column was renamed to dodge the SQL reserved word and the TOKEN did not
 *  follow. A naive UPPER_SNAKE→lower_snake transform silently breaks that one. */
const PROFILE_VAR_TO_COLUMN: Record<string, string> = {
  CLIENT_FIRST: "client_first",
  CURRENT_ROLE: "current_role_title",   // <- the exception
  CURRENT_EMPLOYER: "current_employer",
  SCHOOL: "school",
  GRAD_YEAR: "grad_year",
  DEGREE: "degree",
  TARGET_FIELD: "target_field",
  TARGET_ROLE: "target_role",
  TIMEFRAME: "timeframe",
  CITY: "city",
  AFFINITY_1: "affinity_1",
  AFFINITY_2: "affinity_2",
  AFFINITY_3: "affinity_3",
  KEY_STRENGTH: "key_strength",
  RESUME_LINK: "resume_link",
  CALENDAR_LINK: "calendar_link",
  ELEVATOR_PITCH: "elevator_pitch",
}

export type RenderProfile = Record<string, string | null | undefined>
export type RenderContact = {
  first_name?: string | null
  company_name?: string | null
  additional_info?: string | null
}

/**
 * What an unresolved variable becomes in the output text.
 *
 * NEVER the raw bracket. A message with a literal [TARGET_ROLE] in it is one a
 * client can copy and send, and it reads as a mail-merge failure to the person
 * receiving it. A visible blank is obviously unfinished to the sender and
 * harmless if it somehow escapes.
 */
export const UNRESOLVED_PLACEHOLDER = "_____"

export type RenderResult = {
  text: string
  /** Profile/contact variables with no value, plus unknown tokens. Real gaps —
   *  warn before copy. */
  unresolved: string[]
  /** Fill-at-send prompts. NOT errors: the writer completes these by hand. */
  toFill: string[]
}

/**
 * Substitute a template body against a client profile and a contact.
 *
 * Three outcomes per bracket, and keeping them apart is the whole point:
 *   • profile/contact variable WITH a value  → substituted silently
 *   • profile/contact variable WITHOUT one   → UNRESOLVED_PLACEHOLDER + unresolved[]
 *   • fill-at-send prompt                    → left as [PROMPT] + toFill[]
 *
 * Fill-at-send prompts deliberately keep their bracket text. They are the
 * instruction to the writer — blanking [ONE SPECIFIC QUESTION] to "_____" would
 * destroy the only clue about what belongs there. The UI turns them into
 * editable inputs (8c/8d) and the copy step is what must refuse or warn while
 * toFill is non-empty; that is 8d's job, not the renderer's.
 *
 * Unknown tokens ([TARGETROLE], a typo) land in unresolved rather than being
 * left in or dropped, so a mistake in an edited template is caught rather than
 * shipped.
 *
 * Substitution is per whole bracket — a variable is all-or-nothing, never
 * partially resolved.
 */
export function renderTemplate(
  body: string,
  profile: RenderProfile | null | undefined,
  contact: RenderContact | null | undefined,
): RenderResult {
  const unresolved: string[] = []
  const toFill: string[] = []
  const p = profile ?? {}
  const c = contact ?? {}

  const value = (token: string): string | null => {
    if (classifyVariable(token) === "contact") {
      const v =
        token === "NAME" ? c.first_name :
        token === "FIRM" ? c.company_name :
        token === "ADDITIONAL_INFO" ? c.additional_info :
        null
      return v && v.trim() ? v.trim() : null
    }
    const col = PROFILE_VAR_TO_COLUMN[token]
    if (!col) return null                       // unknown token -> a real gap
    const v = p[col]
    return v && String(v).trim() ? String(v).trim() : null
  }

  const text = body.replace(/\[([^\]]+)\]/g, (whole, token: string) => {
    if (classifyVariable(token) === "fill") {
      if (!toFill.includes(token)) toFill.push(token)
      return whole                              // keep the prompt legible
    }
    const v = value(token)
    if (v !== null) return v
    if (!unresolved.includes(token)) unresolved.push(token)
    return UNRESOLVED_PLACEHOLDER
  })

  return { text, unresolved, toFill }
}
