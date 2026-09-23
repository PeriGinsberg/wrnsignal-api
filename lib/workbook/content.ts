// lib/workbook/content.ts
//
// The workbook content file format (docs/workbooks-v1/workbooks-v1/). The app
// renders any file in this shape; there is no per-client code. Everything here
// is pure so the renderer, the routes, the operator script and the tests share
// one definition of what a field key is.

export type Tone = "peach" | "paleblue"

export type Block =
  | { type: "text"; body: string; label?: string; size?: "lead" }
  | { type: "heading"; text: string }
  | { type: "list"; style: "bullets" | "numbers" | "quotes"; items: string[]; title?: string }
  | { type: "callout"; tone: Tone; body: string; title?: string }
  | { type: "coach_note"; body: string }
  // Templates write `body`; the interview-prep files write `text`. Both render.
  | { type: "big_quote"; text?: string; body?: string }
  | {
      type: "field"
      key: string
      input: "short" | "long"
      label: string
      number?: number
      prefix?: string
      placeholder?: string
      style?: "hook"
    }
  | { type: "word_track"; body: string; label?: string }
  | { type: "pick"; key: string; label: string; options: string[]; help?: string; allow_other?: boolean }
  | { type: "star"; key: string; title: string; question: string; number?: number; skill?: string }
  | { type: "scenario"; key: string; prompt: string; number?: number }
  | { type: "coach_only"; body: string; title?: string }

/** in_session: worked through with the coach. homework: done alone afterwards. */
export type SectionMode = "in_session" | "homework"

export type Section = { id: string; number: number; title: string; mode?: SectionMode; blocks: Block[] }

export type SummaryBlock =
  | { type: "interview_details" }
  | { type: "hook"; field: string; prefix: string; note?: string }
  | { type: "tmay"; present: string; past: string; future: string; close?: string; note?: string }
  | { type: "story_map"; title: string; stars: string[]; note?: string }
  | { type: "quick_answers"; items: ({ label: string; field: string } | { label: string; static: string })[] }
  | { type: "questions"; first: string; fields: string[]; note?: string }
  | { type: "checklist"; items: string[] }
  | { type: "signoff"; text: string; from?: string }

export type Interview = {
  company: string | null
  role: string | null
  date: string | null
  time: string | null
  interviewer_name: string | null
  interviewer_title: string | null
  location: string | null
}

export type WorkbookContent = {
  schema_version: 1
  slug: string
  /** Session templates: the same content for every client, with placeholders. */
  template?: boolean
  template_id?: string
  title?: string
  client: { first_name: string; full_name: string }
  /** null on a session workbook: it is not about one interview. */
  interview: Interview | null
  coach: { first_name: string }
  sections: Section[]
  summary: { title: string; eyebrow: string; blocks: SummaryBlock[] }
}

/** A pick answer. Text fields store a plain string. */
export type PickValue = { choice: string | null; other: string }
export type AnswerValue = string | PickValue

export const STAR_PARTS = [
  { part: "story", label: "The story I'm using" },
  { part: "s", label: "Situation" },
  { part: "t", label: "Task" },
  { part: "a", label: "Action" },
  { part: "r", label: "Result" },
  { part: "reflection", label: "That experience taught me..." },
  { part: "time", label: "My time" },
] as const

export const SCENARIO_PARTS = [
  { part: "calm", label: "Stay calm" },
  { part: "fix", label: "Fix it now" },
  { part: "communicate", label: "Communicate" },
  { part: "prevent", label: "Prevent it next time" },
  { part: "before", label: "Has this happened to me before?" },
] as const

/** Answers the summary checklist writes. Reserved: never counted as progress. */
export const CHECKLIST_PREFIX = "summary.check."
/** Placeholders a template carries, filled from the client and coach records. */
export const TEMPLATE_KEYS = ["first_name", "full_name", "coach_first_name"] as const
export type TemplateValues = Record<(typeof TEMPLATE_KEYS)[number], string>
export const GENERAL_SECTION_ID = "_general"

/** The field keys one block owns, in render order. */
export function blockFieldKeys(b: Block): string[] {
  switch (b.type) {
    case "field":
    case "pick":
      return [b.key]
    case "star":
      return STAR_PARTS.map((p) => `${b.key}.${p.part}`)
    case "scenario":
      return SCENARIO_PARTS.map((p) => `${b.key}.${p.part}`)
    default:
      return []
  }
}

export function sectionFieldKeys(s: Section): string[] {
  return s.blocks.flatMap(blockFieldKeys)
}

export function allFieldKeys(c: Pick<WorkbookContent, "sections">): string[] {
  return c.sections.flatMap(sectionFieldKeys)
}

/** The section a field key lives in, or null for keys the content does not own. */
export function sectionOfField(c: Pick<WorkbookContent, "sections">, key: string): string | null {
  for (const s of c.sections) if (sectionFieldKeys(s).includes(key)) return s.id
  return null
}

/** Mirrors wb_strip_coach_only() in the migration. */
export function stripCoachOnly<T extends Pick<WorkbookContent, "sections">>(c: T): T {
  return {
    ...c,
    sections: c.sections.map((s) => ({ ...s, blocks: s.blocks.filter((b) => b.type !== "coach_only") })),
  }
}

/** The text of a big_quote, whichever field the file uses. */
export function quoteText(b: Extract<Block, { type: "big_quote" }>): string {
  return (b.text ?? b.body ?? "").trim()
}

/** The last section the client finishes alone: where "Mark homework complete" goes. */
export function lastHomeworkSectionId(c: Pick<WorkbookContent, "sections">): string | null {
  const homework = c.sections.filter((s) => s.mode === "homework")
  return homework.length ? homework[homework.length - 1].id : null
}

/**
 * Fill a template's placeholders from the records. Every string is substituted,
 * so labels, prefixes and the summary title are all covered.
 */
export function applyTemplate<T>(content: T, values: TemplateValues): T {
  const swap = (text: string) =>
    text.replace(/\{(first_name|full_name|coach_first_name)\}/g, (_, k: keyof TemplateValues) => values[k])
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return swap(v)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return walk(content) as T
}

/** Placeholders left behind after substitution, e.g. a typo like {frist_name}. */
export function unresolvedPlaceholders(content: unknown): string[] {
  const found = new Set<string>()
  const walk = (v: unknown) => {
    if (typeof v === "string") for (const m of v.matchAll(/\{[a-z_]+\}/g)) found.add(m[0])
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === "object") Object.values(v).forEach(walk)
  }
  walk(content)
  return [...found]
}

export function isFilled(v: unknown): boolean {
  if (typeof v === "string") return v.trim().length > 0
  if (v && typeof v === "object") {
    const p = v as PickValue
    return !!(p.choice && p.choice.trim()) || !!(p.other && p.other.trim())
  }
  return false
}

/** The text a summary or coach view shows for an answer. */
export function answerText(v: unknown): string {
  if (typeof v === "string") return v.trim()
  if (v && typeof v === "object") {
    const p = v as PickValue
    const other = (p.other ?? "").trim()
    const choice = (p.choice ?? "").trim()
    if (choice === "__other__") return other
    return other && choice ? `${choice} ${other}` : choice || other
  }
  return ""
}

export type Progress = { filled: number; total: number; sectionsDone: Set<string> }

export function progress(c: Pick<WorkbookContent, "sections">, answers: Record<string, unknown>): Progress {
  let filled = 0
  let total = 0
  const sectionsDone = new Set<string>()
  for (const s of c.sections) {
    const keys = sectionFieldKeys(s)
    const done = keys.filter((k) => isFilled(answers[k])).length
    filled += done
    total += keys.length
    if (keys.length > 0 && done === keys.length) sectionsDone.add(s.id)
  }
  return { filled, total, sectionsDone }
}

/** Is this a key the client may write? Content-owned keys plus summary checks. */
export function isWritableKey(c: WorkbookContent, key: string): boolean {
  if (key.startsWith(CHECKLIST_PREFIX)) {
    const n = Number(key.slice(CHECKLIST_PREFIX.length))
    const list = c.summary.blocks.find((b) => b.type === "checklist") as { items: string[] } | undefined
    return Number.isInteger(n) && n >= 0 && !!list && n < list.items.length
  }
  return allFieldKeys(c).includes(key)
}

/** Answer values accepted from a client: a string, or a pick shape for pick fields. */
export function validateAnswerValue(c: WorkbookContent, key: string, value: unknown): string | null {
  if (key.startsWith(CHECKLIST_PREFIX)) return value === "1" || value === "" ? null : "Checklist value must be \"1\" or \"\""
  const pick = c.sections.flatMap((s) => s.blocks).find((b) => b.type === "pick" && b.key === key) as
    | Extract<Block, { type: "pick" }>
    | undefined
  if (pick) {
    if (!value || typeof value !== "object") return "Pick value must be {choice, other}"
    const v = value as PickValue
    if (v.choice !== null && typeof v.choice !== "string") return "choice must be a string or null"
    if (typeof v.other !== "string") return "other must be a string"
    if (v.choice && v.choice !== "__other__" && !pick.options.includes(v.choice)) return "choice is not one of the options"
    if (v.choice === "__other__" && !pick.allow_other) return "this pick has no other option"
    return v.other.length > 20000 ? "Answer is too long" : null
  }
  if (typeof value !== "string") return "Answer must be text"
  return value.length > 20000 ? "Answer is too long" : null
}

/** A comment or question anchor: a real section (or the general box) and, if given, a field in it. */
export function anchorError(c: Pick<WorkbookContent, "sections">, sectionId: unknown, fieldKey: unknown): string | null {
  if (typeof sectionId !== "string" || !sectionId) return "section_id is required"
  if (sectionId === GENERAL_SECTION_ID) return fieldKey == null ? null : "The general box has no field"
  const s = c.sections.find((x) => x.id === sectionId)
  if (!s) return "Unknown section"
  if (fieldKey == null) return null
  if (typeof fieldKey !== "string" || !sectionFieldKeys(s).includes(fieldKey)) return "Unknown field for this section"
  return null
}

// ---------------------------------------------------------------------------
// Validation, for the operator script: a content file with a wrong shape must
// fail at creation, not render half a workbook to a client.
// ---------------------------------------------------------------------------

const BLOCK_TYPES = new Set([
  "text", "heading", "list", "callout", "coach_note", "big_quote", "field",
  "word_track", "pick", "star", "scenario", "coach_only",
])
const SUMMARY_TYPES = new Set([
  "interview_details", "hook", "tmay", "story_map", "quick_answers", "questions", "checklist", "signoff",
])

export function validateContent(raw: unknown): { ok: true; content: WorkbookContent } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const c = raw as any
  const str = (v: unknown) => typeof v === "string" && v.trim().length > 0

  if (!c || typeof c !== "object") return { ok: false, errors: ["content is not an object"] }
  if (c.schema_version !== 1) errors.push("schema_version must be 1")
  if (!str(c.slug) || !/^[a-z0-9-]+$/.test(c.slug)) errors.push("slug must be lowercase letters, digits and hyphens")
  if (!str(c.client?.first_name)) errors.push("client.first_name is required")
  if (!str(c.coach?.first_name)) errors.push("coach.first_name is required")
  if (c.interview != null && typeof c.interview !== "object") errors.push("interview must be an object or null")
  if (c.interview?.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(c.interview.date)) errors.push("interview.date must be YYYY-MM-DD or null")
  if (c.template != null && typeof c.template !== "boolean") errors.push("template must be true or absent")
  if (c.template && !str(c.template_id)) errors.push("a template needs template_id")
  if (!Array.isArray(c.sections) || c.sections.length === 0) errors.push("sections must be a non-empty array")

  const keys = new Set<string>()
  const sectionIds = new Set<string>()
  for (const [i, s] of (Array.isArray(c.sections) ? c.sections : []).entries()) {
    const at = `sections[${i}]`
    if (!str(s?.id)) errors.push(`${at}.id is required`)
    else if (s.id === GENERAL_SECTION_ID || sectionIds.has(s.id)) errors.push(`${at}.id "${s.id}" is reserved or duplicated`)
    else sectionIds.add(s.id)
    if (!str(s?.title)) errors.push(`${at}.title is required`)
    if (s?.mode != null && !["in_session", "homework"].includes(s.mode)) errors.push(`${at}.mode must be in_session or homework`)
    if (!Array.isArray(s?.blocks)) { errors.push(`${at}.blocks must be an array`); continue }
    for (const [j, b] of s.blocks.entries()) {
      const bt = `${at}.blocks[${j}]`
      if (!BLOCK_TYPES.has(b?.type)) { errors.push(`${bt}: unknown block type "${b?.type}"`); continue }
      if (b.type === "field" && (!["short", "long"].includes(b.input) || !str(b.label))) errors.push(`${bt}: field needs input short|long and a label`)
      if (b.type === "pick" && (!Array.isArray(b.options) || b.options.length === 0)) errors.push(`${bt}: pick needs options`)
      if (b.type === "list" && (!["bullets", "numbers", "quotes"].includes(b.style) || !Array.isArray(b.items))) errors.push(`${bt}: list needs style and items`)
      if (b.type === "callout" && !["peach", "paleblue"].includes(b.tone)) errors.push(`${bt}: callout tone must be peach or paleblue`)
      if (b.type === "big_quote" && !str(b.text) && !str(b.body)) errors.push(`${bt}: big_quote needs text or body`)
      if (["field", "pick", "star", "scenario"].includes(b.type)) {
        if (!str(b.key) || b.key.startsWith(CHECKLIST_PREFIX)) { errors.push(`${bt}: key is required and must not be reserved`); continue }
        for (const k of blockFieldKeys(b)) {
          if (keys.has(k)) errors.push(`${bt}: duplicate field key "${k}"`)
          keys.add(k)
        }
      }
    }
  }

  const sb = c.summary?.blocks
  if (!Array.isArray(sb)) errors.push("summary.blocks must be an array")
  for (const [i, b] of (Array.isArray(sb) ? sb : []).entries()) {
    if (!SUMMARY_TYPES.has(b?.type)) { errors.push(`summary.blocks[${i}]: unknown type "${b?.type}"`); continue }
    const refs: string[] =
      b.type === "hook" ? [b.field]
      : b.type === "tmay" ? [b.present, b.past, b.future]
      : b.type === "story_map" ? (b.stars ?? []).map((s: string) => `${s}.story`)
      : b.type === "quick_answers" ? (b.items ?? []).filter((x: any) => x.field).map((x: any) => x.field)
      : b.type === "questions" ? (b.fields ?? [])
      : []
    for (const r of refs) if (!keys.has(r)) errors.push(`summary.blocks[${i}]: field "${r}" is not in the content`)
  }

  return errors.length ? { ok: false, errors } : { ok: true, content: c as WorkbookContent }
}
