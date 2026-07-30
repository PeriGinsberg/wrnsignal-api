// Phase 8e — how the 24 templates are grouped in the editor, the sample contact
// the live preview renders against, and the dropped-variable check.
//
// A module rather than helpers inside page.tsx: page files should export only
// route members, and these three all need to be reachable from tests.

import { RELATIONSHIPS, RELATIONSHIP_LABELS, RELATIONSHIP_TO_FAMILY } from "../vocab"
import { TEMPLATE_IDS, DEFAULTS_BY_ID, extractVariables, type RenderContact } from "../../../../lib/network-tracker/templates"

export type TemplateGroup = { heading: string; hint?: string; ids: string[] }

// The five 3-touch sequences are DERIVED from RELATIONSHIP_TO_FAMILY, not
// restated. pickTemplate (8c) routes a contact to a family through that same
// map, so a heading here can never claim a grouping the join does not use.
const SEQUENCE_GROUPS: TemplateGroup[] = RELATIONSHIPS.map((rel) => {
  const family = RELATIONSHIP_TO_FAMILY[rel]
  return {
    heading: RELATIONSHIP_LABELS[rel],
    hint: "sequence",
    ids: TEMPLATE_IDS.filter((id) => id.startsWith(family) && /^[A-Z]\d$/.test(id)),
  }
})

export const TEMPLATE_GROUPS: TemplateGroup[] = [
  { heading: "Intro request", ids: ["IN"] },
  ...SEQUENCE_GROUPS,
  { heading: "Moments", hint: "same whoever you are writing to", ids: TEMPLATE_IDS.filter((id) => id.startsWith("S")) },
  { heading: "LinkedIn", ids: TEMPLATE_IDS.filter((id) => id.startsWith("L")) },
]

// Every template must appear exactly once. A family added to the vocab without
// a group here would otherwise be silently uneditable — invisible, not broken,
// which is the harder failure to notice.
export function ungroupedIds(): string[] {
  const placed = new Set(TEMPLATE_GROUPS.flatMap((g) => g.ids))
  return TEMPLATE_IDS.filter((id) => !placed.has(id))
}

/**
 * The preview's stand-in contact. FIXED and synthetic on purpose: previewing
 * against a real contact would make the editor depend on having one, and
 * choosing which is a control nobody asked for. A realistic name and firm
 * matter — "[NAME]" rendering as "Contact" or "Test" reads as scaffolding and
 * stops anyone believing the preview.
 */
export const SAMPLE_CONTACT: RenderContact & { display: string } = {
  first_name: "Priya",
  company_name: "Nodal Exchange",
  additional_info: "we both spoke at the Chicago derivatives panel",
  display: "Priya Nandal · Nodal Exchange",
}

/**
 * Variables the default had that this edit no longer contains.
 *
 * This is the "you hardcoded Hi Dana over Hi [NAME]" check. It WARNS, never
 * blocks: dropping a variable is a legitimate edit — someone who always writes
 * to the same firm may genuinely not want [FIRM] — and a client who cannot save
 * their own wording will simply stop using the editor. Naming what was dropped
 * is what makes it actionable rather than nagging.
 */
export function droppedVariables(templateId: string, editedBody: string): string[] {
  const def = DEFAULTS_BY_ID[templateId]
  if (!def) return []
  const now = new Set(extractVariables(editedBody))
  return extractVariables(def.body).filter((v) => !now.has(v))
}
