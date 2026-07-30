// Phase 8e: the sample contact the live preview renders against, and the
// dropped-variable check.
//
// A module rather than helpers inside page.tsx: page files should export only
// route members, and both of these need to be reachable from tests.
//
// The grouping that used to live here (TEMPLATE_GROUPS / ungroupedIds) moved to
// templateNames.ts with the redesign, where placement and naming are one
// concern: a template needs somewhere to live AND a word to live under, and
// splitting those across two modules is how one of them gets forgotten.

import { DEFAULTS_BY_ID, extractVariables, type RenderContact } from "../../../../lib/network-tracker/templates"

/**
 * The preview's stand-in contact. FIXED and synthetic on purpose: previewing
 * against a real contact would make the editor depend on having one, and
 * choosing which is a control nobody asked for.
 *
 * THE NAME IS A DELIBERATE COMPROMISE, and it replaces an earlier one. This
 * used to be "Priya Nandal at Nodal Exchange", chosen because a realistic name
 * keeps the preview believable where "[NAME]" rendering as "Contact" or "Test"
 * reads as scaffolding. It was too believable: people read the preview and
 * hunted for a contact they did not recognise.
 *
 * So the name still has to READ naturally inside a sentence, because "Hi
 * Contact," proves nothing about how a real message looks, but it must be
 * unmistakable as a placeholder at a glance. "Sam Sample at Example Co" does
 * both: "Hi Sam," scans like a real greeting, and nobody has ever met Sam
 * Sample. The framing around the preview does the rest.
 */
export const SAMPLE_CONTACT: RenderContact & { display: string } = {
  first_name: "Sam",
  company_name: "Example Co",
  additional_info: "we met at an alumni event last spring",
  display: "Sam Sample at Example Co",
}

/**
 * Variables the default had that this edit no longer contains.
 *
 * This is the "you hardcoded Hi Dana over Hi [NAME]" check. It WARNS, never
 * blocks: dropping a variable is a legitimate edit (someone who always writes
 * to the same firm may genuinely not want [FIRM]), and a client who cannot save
 * their own wording will simply stop using the editor. Naming what was dropped
 * is what makes it actionable rather than nagging.
 */
export function droppedVariables(templateId: string, editedBody: string): string[] {
  const def = DEFAULTS_BY_ID[templateId]
  if (!def) return []
  const now = new Set(extractVariables(editedBody))
  return extractVariables(def.body).filter((v) => !now.has(v))
}
