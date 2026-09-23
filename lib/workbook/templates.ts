// lib/workbook/templates.ts
//
// SESSION TEMPLATES LIVE IN THE REPO, NOT THE DATABASE, and that is the design.
// Same call as lib/network-tracker/template-defaults.ts: a template is authored
// here, reviewed in the diff, and validated by the gate before it can reach a
// client. There is no seeding step, so dev and prod cannot drift, and adding a
// template is a deploy, which is what authoring one already was.
//
// A workbook made from a template FREEZES the filled-in content on the row
// (workbooks.content), so editing a template here never changes a workbook that
// already exists. That is the same rule as every other content file.

import { allFieldKeys, validateContent, type WorkbookContent } from "./content"
import sessionOneFoundations from "./templates/session-1-foundations.json"

/** One line under the title in the picker. Copy about the template, not content. */
type Registration = { description: string; raw: unknown }

const REGISTRY: Registration[] = [
  {
    description: "The first working session: where they are, what they want, and the homework that follows it.",
    raw: sessionOneFoundations,
  },
]

export type TemplateSummary = {
  template_id: string
  title: string
  description: string
  /** What the coach is committing the client to, in the picker. */
  sections: number
  fields: number
}

export type Template = TemplateSummary & { content: WorkbookContent }

let cache: Template[] | null = null

/**
 * Parsed once, loudly. A template that does not validate is a bug in this repo,
 * not a bad request, so it throws rather than being quietly skipped; the test in
 * templates.test.ts is what stops that reaching a deploy.
 */
function all(): Template[] {
  if (cache) return cache
  const out: Template[] = []
  for (const [i, entry] of REGISTRY.entries()) {
    const parsed = validateContent(entry.raw)
    if (!parsed.ok) {
      throw new Error(`Workbook template ${i} is not valid: ${parsed.errors.join("; ")}`)
    }
    const content = parsed.content
    if (!content.template || !content.template_id) {
      throw new Error(`Workbook template ${i} ("${content.slug}") is missing template: true / template_id`)
    }
    out.push({
      template_id: content.template_id,
      title: content.title ?? content.slug,
      description: entry.description,
      sections: content.sections.length,
      fields: allFieldKeys(content).length,
      content,
    })
  }
  cache = out
  return out
}

/** Every template a coach may start from. Not per coach: there is one library. */
export function listTemplates(): TemplateSummary[] {
  return all().map(({ content: _content, ...summary }) => summary)
}

export function getTemplate(templateId: string): Template | null {
  return all().find((t) => t.template_id === templateId) ?? null
}
