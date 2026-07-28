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
