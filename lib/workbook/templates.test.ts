// Run: npx tsx lib/workbook/templates.test.ts
//
// THE TEMPLATE LIBRARY IS CODE, SO THIS IS ITS GATE. A template that does not
// validate, or that carries a placeholder nobody fills, would otherwise reach a
// client as a workbook with "{frist_name}" printed in it. lib/workbook/templates
// throws on a bad template; the point of this file is that the throw happens in
// CI rather than in a coach's face.

import { allFieldKeys, applyTemplate, unresolvedPlaceholders, validateContent, TEMPLATE_KEYS } from "./content"
import { getTemplate, listTemplates } from "./templates"

let failures = 0
function ok(label: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok    ${label}`)
  else { failures++; console.error(`  FAIL  ${label}`, detail ?? "") }
}

console.log("the library")
const all = listTemplates()
ok("there is at least one template", all.length > 0, all.length)
ok("no summary leaks the content", all.every((t) => !("content" in t)))
ok("template ids are unique", new Set(all.map((t) => t.template_id)).size === all.length)

const VALUES = { first_name: "Alex", full_name: "Alex Rivera", coach_first_name: "Peri" }

for (const summary of all) {
  console.log(`\n${summary.template_id}`)
  const t = getTemplate(summary.template_id)!
  ok("getTemplate finds it", !!t)
  ok("it is marked as a template", t.content.template === true && t.content.template_id === summary.template_id)
  // The homework webhook reports this number to GoHighLevel. A template that
  // does not state it gets reported as Session 1 by a fallback, which is how a
  // Session 2 workbook would quietly file itself as a Session 1 completion.
  ok("it states which session it is",
    Number.isInteger(t.content.session) && (t.content.session ?? 0) > 0, t.content.session)
  ok("it has a description for the picker", summary.description.trim().length > 0)
  ok("the counts match the content",
    summary.sections === t.content.sections.length && summary.fields === allFieldKeys(t.content).length,
    `${summary.sections}/${summary.fields}`)

  // The whole point of a template: placeholders in, names out.
  ok("it carries placeholders", unresolvedPlaceholders(t.content).length > 0)
  const filled = applyTemplate(t.content, VALUES)
  ok("every placeholder is filled", unresolvedPlaceholders(filled).length === 0,
    unresolvedPlaceholders(filled))
  ok("the registry copy is not mutated", unresolvedPlaceholders(t.content).length > 0)
  ok("it only uses placeholders we fill",
    unresolvedPlaceholders(t.content).every((p) => TEMPLATE_KEYS.includes(p.slice(1, -1) as any)),
    unresolvedPlaceholders(t.content))

  // What the create route stores: the filled content, whole.
  const parsed = validateContent(filled)
  ok("the filled result is a valid workbook", parsed.ok, parsed.ok ? "" : parsed.errors)
  if (parsed.ok) {
    ok("names reached the content",
      parsed.content.client.first_name === "Alex" && parsed.content.coach.first_name === "Peri")
    // Both survive the fill, because the webhook reads them off the stored row.
    ok("the session number survives", parsed.content.session === t.content.session)
    ok("template_id survives", parsed.content.template_id === summary.template_id)
  }
}

console.log("\nunknown ids")
ok("an unknown id is null, not a throw", getTemplate("no-such-template") === null)
ok("an empty id is null", getTemplate("") === null)

console.log(failures ? `\n${failures} FAILED\n` : "\nall template assertions passed\n")
process.exit(failures ? 1 : 0)
