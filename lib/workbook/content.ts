// lib/workbook/content.ts
//
// The workbook content file format (docs/workbooks-v1/workbooks-v1/). The app
// renders any file in this shape; there is no per-client code. Everything here
// is pure so the renderer, the routes, the operator script and the tests share
// one definition of what a field key is.

export type Tone = "peach" | "paleblue"

/** A choice, or a named group of choices that renders as an <optgroup>. */
export type SelectOption = string | { group: string; items: string[] }

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
      /**
       * Pre-seeded text the client edits into their own words. Shown in the box
       * until they save anything, and never stored as an answer on their behalf:
       * an untouched starter is not something they wrote, so it does not count
       * as progress and does not reach the summary.
       */
      starter?: string
      /**
       * Not required to finish the section. The spec marks Reflection, the
       * scratch notes and the out-loud timing as nice to have, and a client who
       * did everything asked should not see an incomplete bar.
       */
      optional?: boolean
    }
  | { type: "word_track"; body: string; label?: string }
  | { type: "pick"; key: string; label: string; options: string[]; help?: string; allow_other?: boolean; optional?: boolean }
  /**
   * A dropdown. Radios do not scale: Session 2 picks a trait from fifteen in
   * four groups, and fifteen radio buttons under every story slot is a wall.
   *
   * `options` are literal, and may be grouped: a group renders as an <optgroup>
   * whose header shows in the list and cannot be chosen.
   *
   * `options_from` builds the list from the CLIENT'S OWN ANSWERS instead, by
   * globbing a key pattern (one `*`). Section 8 matches twenty questions to the
   * stories they named in Section 7, and those names do not exist until they
   * type them. Literal `options` win if both are given.
   */
  | {
      type: "select"
      key: string
      label: string
      options?: SelectOption[]
      options_from?: string
      placeholder?: string
      help?: string
      multi?: boolean
      optional?: boolean
    }
  /**
   * One STAR + E story: the trait it proves, where in their life it came from,
   * and the six parts. Its own block rather than eight fields because a story
   * is one thing, and because `copy_from` has to move all of it at once.
   */
  | {
      type: "story"
      key: string
      title?: string
      question?: string
      number?: number
      /** Ask for a name the client will recognise in the Section 8 dropdown. */
      named?: boolean
      /** Also ask what other questions it answers. */
      other_questions?: boolean
      /** Seconds said out loud. Optional by the spec. */
      timed?: boolean
      traits: SelectOption[]
      life_areas: SelectOption[]
      /**
       * Another story block's key. When THIS slot is still untouched, that
       * story's answers show as starter text. Never stored on the client's
       * behalf, so an untouched copy is not progress, exactly as `starter`.
       */
      copy_from?: string
    }
  /**
   * Derived, never stored. Reads the answers already on screen and reports
   * what the client has not covered yet. Owns no field keys.
   */
  | {
      type: "coverage"
      title?: string
      /** Story slot keys to read, e.g. "s2.story*". */
      stories: string
      /** Match answer keys to read, e.g. "s2.match.*". */
      matches: string
      /** Question key -> the trait it tests. */
      question_traits: Record<string, string>
      /** Group name -> the traits in it. */
      trait_groups: SelectOption[]
      /** The full list of life areas, for the "where from" flag. */
      life_areas: SelectOption[]
      /** A story matched this many times or more is leaned on too hard. */
      overused_at?: number
    }
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
  /**
   * Every story the client built, by name, trait and life area.
   *
   * Globbed rather than listed, because the slots are only worth showing when
   * they hold something: a client who built five stories should see five rows,
   * not five rows and three blanks.
   */
  | { type: "story_list"; title: string; stories: string; note?: string }
  /** The same panel as the in-workbook coverage block, on the summary page. */
  | ({ type: "coverage"; title?: string } & CoverageConfig)
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
  /**
   * Which session this is, stated rather than parsed. The homework webhook
   * reports it to GoHighLevel, and it used to be read out of template_id with a
   * regex that fell back to 1, so a workbook with no template_id announced
   * itself as Session 1. A template says which session it is, in one place.
   */
  session?: number
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
/** string: text and single selects. string[]: a multi-select. */
export type AnswerValue = string | string[] | PickValue

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

/**
 * STAR + E, which is Session 2's shape and deliberately not STAR_PARTS.
 *
 * E is the relatable moment and is the whole point of the session, so it is a
 * required part rather than a bolt-on. `reflection` is optional by the spec.
 */
export const STORY_PARTS = [
  { part: "s", label: "S: Situation", optional: false },
  { part: "t", label: "T: Task", optional: false },
  { part: "a", label: "A: Action", optional: false },
  { part: "r", label: "R: Result", optional: false },
  { part: "e", label: "E: The relatable moment", optional: false },
  { part: "reflection", label: "Reflection (optional)", optional: true },
] as const

/** Every key a story slot owns, in render order. */
export function storyKeys(b: Extract<Block, { type: "story" }>): string[] {
  const keys: string[] = []
  if (b.named) keys.push(`${b.key}.name`)
  keys.push(`${b.key}.trait`, `${b.key}.life_area`)
  for (const p of STORY_PARTS) keys.push(`${b.key}.${p.part}`)
  if (b.other_questions) keys.push(`${b.key}.other_questions`)
  if (b.timed) keys.push(`${b.key}.seconds`)
  return keys
}

/** The field keys one block owns, in render order. */
export function blockFieldKeys(b: Block): string[] {
  switch (b.type) {
    case "field":
    case "pick":
    case "select":
      return [b.key]
    case "star":
      return STAR_PARTS.map((p) => `${b.key}.${p.part}`)
    case "scenario":
      return SCENARIO_PARTS.map((p) => `${b.key}.${p.part}`)
    case "story":
      return storyKeys(b)
    default:
      return []
  }
}

/**
 * The keys that do NOT have to be filled for a section to read as done.
 *
 * Kept separate from blockFieldKeys so an optional answer is still a real
 * answer everywhere else: it saves, it reaches the summary, it is just not
 * counted against the client.
 */
export function blockOptionalKeys(b: Block): string[] {
  switch (b.type) {
    case "field":
    case "pick":
    case "select":
      return b.optional ? [b.key] : []
    case "story": {
      const out = STORY_PARTS.filter((p) => p.optional).map((p) => `${b.key}.${p.part}`)
      // Saying it out loud is homework the coach times in session, not a
      // written answer the client owes.
      if (b.timed) out.push(`${b.key}.seconds`)
      return out
    }
    default:
      return []
  }
}

export function sectionOptionalKeys(s: Section): string[] {
  return s.blocks.flatMap(blockOptionalKeys)
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

/** Grouped or flat options, flattened to the choosable values. */
export function selectValues(options: SelectOption[] | undefined): string[] {
  if (!options) return []
  return options.flatMap((o) => (typeof o === "string" ? [o] : o.items))
}

/**
 * Resolve `options_from` against the answers: one `*` globbed, in key order.
 *
 * Section 8's dropdowns are the client's own story names, so the list only
 * exists once they have typed some. Blank slots drop out rather than showing
 * as empty rows.
 */
export function optionsFromAnswers(pattern: string, answers: Record<string, unknown>): string[] {
  const i = pattern.indexOf("*")
  if (i < 0) return []
  const head = pattern.slice(0, i)
  const tail = pattern.slice(i + 1)
  const hits: { k: string; v: string }[] = []
  for (const [k, raw] of Object.entries(answers)) {
    if (!k.startsWith(head) || !k.endsWith(tail)) continue
    const v = answerText(raw)
    if (v) hits.push({ k, v })
  }
  hits.sort((a, b) => a.k.localeCompare(b.k, undefined, { numeric: true }))
  const seen = new Set<string>()
  return hits.map((h) => h.v).filter((v) => (seen.has(v) ? false : (seen.add(v), true)))
}

/** What a coverage panel needs, wherever it is rendered. */
export type CoverageConfig = {
  stories: string
  matches: string
  question_traits: Record<string, string>
  trait_groups: SelectOption[]
  life_areas: SelectOption[]
  overused_at?: number
}

/** The slot keys behind a glob like "s2.story*", in numeric order. */
export function globSlots(pattern: string, answers: Record<string, unknown>): string[] {
  const i = pattern.indexOf("*")
  if (i < 0) return []
  const head = pattern.slice(0, i)
  const out = new Set<string>()
  for (const k of Object.keys(answers)) {
    if (!k.startsWith(head)) continue
    const slot = k.slice(head.length).split(".")[0]
    if (slot) out.add(head + slot)
  }
  return [...out].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

/**
 * What the client has not covered yet.
 *
 * PURE, and shared by the in-workbook panel and the summary page, so the two
 * can never disagree about what is missing. Returns only the rows that have
 * something in them: a heading with nothing under it reads as a problem.
 */
export function computeCoverage(
  cfg: CoverageConfig,
  answers: Record<string, unknown>,
): { label: string; items: string[] }[] {
  const stories = globSlots(cfg.stories, answers)
    .map((k) => ({
      name: answerText(answers[`${k}.name`]),
      trait: answerText(answers[`${k}.trait`]),
      area: answerText(answers[`${k}.life_area`]),
      written: STORY_PARTS.some((p) => answerText(answers[`${k}.${p.part}`])),
    }))
    .filter((x) => x.name || x.trait || x.written)

  const mHead = cfg.matches.slice(0, cfg.matches.indexOf("*"))
  const qKeys = Object.keys(cfg.question_traits)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  const unanswered = qKeys
    .filter((q) => !answerText(answers[`${mHead}${q}.story`]))
    .map((q) => `${q} (${cfg.question_traits[q]})`)

  const used = new Map<string, number>()
  for (const q of qKeys) {
    const picked = answerText(answers[`${mHead}${q}.story`])
    if (picked) used.set(picked, (used.get(picked) ?? 0) + 1)
  }
  const cap = cfg.overused_at ?? 4
  const overused = [...used.entries()]
    .filter(([, n]) => n >= cap)
    .map(([name, n]) => `${name} (${n} questions)`)

  const chosen = new Set(stories.map((x) => x.trait).filter(Boolean))
  const missingTraits: string[] = []
  const missingGroups: string[] = []
  for (const g of cfg.trait_groups) {
    if (typeof g === "string") {
      if (!chosen.has(g)) missingTraits.push(g)
      continue
    }
    if (!g.items.some((t) => chosen.has(t))) missingGroups.push(g.group)
    for (const t of g.items) if (!chosen.has(t)) missingTraits.push(t)
  }

  // Only once ONE area is carrying more than half. Before that, a short list
  // is just a short list, and nagging about it this early is noise.
  const areaCount = new Map<string, number>()
  for (const x of stories) if (x.area) areaCount.set(x.area, (areaCount.get(x.area) ?? 0) + 1)
  const told = [...areaCount.values()].reduce((a, n) => a + n, 0)
  const lopsided = told > 0 && [...areaCount.values()].some((n) => n * 2 > told)
  const missingAreas = lopsided ? selectValues(cfg.life_areas).filter((a) => !areaCount.has(a)) : []

  return [
    { label: "Questions with no story yet", items: unanswered },
    { label: "Stories you are leaning on too hard", items: overused },
    { label: "Traits with no story", items: missingTraits },
    { label: "Groups with no story", items: missingGroups },
    { label: "Parts of your life with no story", items: missingAreas },
  ].filter((r) => r.items.length > 0)
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

/** What the box shows: their answer once saved, otherwise the starter text. */
export function displayValue(v: unknown, starter?: string): string {
  if (v === undefined && starter) return starter
  return typeof v === "string" ? v : ""
}

export function isFilled(v: unknown): boolean {
  if (typeof v === "string") return v.trim().length > 0
  // A multi-select stores an array. Empty is unanswered.
  if (Array.isArray(v)) return v.some((x) => typeof x === "string" && x.trim().length > 0)
  if (v && typeof v === "object") {
    const p = v as PickValue
    return !!(p.choice && p.choice.trim()) || !!(p.other && p.other.trim())
  }
  return false
}

/** The text a summary or coach view shows for an answer. */
export function answerText(v: unknown): string {
  if (typeof v === "string") return v.trim()
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string" && x.trim()).join(", ")
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
    // OPTIONAL KEYS ARE OUT OF THE DENOMINATOR, and out of the numerator with
    // them. Counting a filled optional answer while not requiring it would push
    // a section past 100%, and counting it in `total` means a client who did
    // everything the spec asks still sees an unfinished bar. Section 7 alone
    // carries eight optional Reflections and eight timings.
    const optional = new Set(sectionOptionalKeys(s))
    const keys = sectionFieldKeys(s).filter((k) => !optional.has(k))
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
  const all = c.sections.flatMap((s) => s.blocks)
  const sel = all.find((b) => b.type === "select" && b.key === key) as
    | Extract<Block, { type: "select" }>
    | undefined

  // A story block SYNTHESISES its trait and life-area dropdowns, so they are
  // not `select` blocks and would otherwise accept any string from the API.
  // The client can only pick from the list; nothing else should be able to.
  if (!sel) {
    const story = all.find(
      (b) => b.type === "story" && (key === `${b.key}.trait` || key === `${b.key}.life_area`),
    ) as Extract<Block, { type: "story" }> | undefined
    if (story) {
      if (typeof value !== "string") return "Answer must be text"
      if (!value) return null
      const allowed = selectValues(key.endsWith(".trait") ? story.traits : story.life_areas)
      return allowed.includes(value) ? null : "Answer is not one of the options"
    }
  }

  if (sel?.multi) {
    if (!Array.isArray(value)) return "A multi-select answer must be a list"
    if (!value.every((v) => typeof v === "string")) return "Every choice must be text"
    if (value.join("").length > 20000) return "Answer is too long"
    // options_from is checked against the client's OWN answers, which change as
    // they type, so the closed list is only enforced for literal options.
    const allowed = selectValues(sel.options)
    if (allowed.length && !value.every((v) => allowed.includes(v))) return "A choice is not one of the options"
    return null
  }
  if (typeof value !== "string") return "Answer must be text"
  if (sel && !sel.multi && value) {
    const allowed = selectValues(sel.options)
    if (allowed.length && !allowed.includes(value)) return "Answer is not one of the options"
  }
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

/** Options are strings, or {group, items[]} for an <optgroup>. */
function okOptions(v: unknown): boolean {
  if (!Array.isArray(v)) return false
  return v.every((o) =>
    typeof o === "string"
      ? o.trim().length > 0
      : !!o && typeof o === "object" &&
        typeof (o as any).group === "string" && (o as any).group.trim().length > 0 &&
        Array.isArray((o as any).items) && (o as any).items.length > 0 &&
        (o as any).items.every((i: unknown) => typeof i === "string" && i.trim().length > 0),
  )
}

const BLOCK_TYPES = new Set([
  "text", "heading", "list", "callout", "coach_note", "big_quote", "field",
  "word_track", "pick", "star", "scenario", "coach_only",
  "select", "story", "coverage",
])
const SUMMARY_TYPES = new Set([
  "interview_details", "hook", "tmay", "story_map", "quick_answers", "questions", "checklist", "signoff",
  "story_list", "coverage",
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
  if (c.session != null && (!Number.isInteger(c.session) || c.session < 1)) {
    errors.push("session must be a whole number of 1 or more")
  }
  // A session template drives the homework webhook, so it must say WHICH session.
  if (c.template && c.session == null) errors.push("a session template needs a session number")
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
      if (b.starter != null && (b.type !== "field" || typeof b.starter !== "string")) errors.push(`${bt}: starter text belongs on a field`)
      if (b.type === "pick" && (!Array.isArray(b.options) || b.options.length === 0)) errors.push(`${bt}: pick needs options`)
      if (b.type === "select") {
        const hasLiteral = Array.isArray(b.options) && b.options.length > 0
        const hasSource = str(b.options_from) && b.options_from.includes("*")
        if (!hasLiteral && !hasSource) {
          errors.push(`${bt}: select needs options, or options_from with a * to glob`)
        }
        if (hasLiteral && !okOptions(b.options)) {
          errors.push(`${bt}: select options must be strings, or {group, items[]}`)
        }
        if (!str(b.label)) errors.push(`${bt}: select needs a label`)
      }
      if (b.type === "story") {
        if (!okOptions(b.traits) || selectValues(b.traits).length === 0) errors.push(`${bt}: story needs traits`)
        if (!okOptions(b.life_areas) || selectValues(b.life_areas).length === 0) errors.push(`${bt}: story needs life_areas`)
        if (b.copy_from != null && !str(b.copy_from)) errors.push(`${bt}: copy_from must be a story key`)
      }
      if (b.type === "coverage") {
        if (!str(b.stories) || !b.stories.includes("*")) errors.push(`${bt}: coverage.stories needs a * to glob`)
        if (!str(b.matches) || !b.matches.includes("*")) errors.push(`${bt}: coverage.matches needs a * to glob`)
        if (!b.question_traits || typeof b.question_traits !== "object") errors.push(`${bt}: coverage needs question_traits`)
        if (!okOptions(b.trait_groups)) errors.push(`${bt}: coverage needs trait_groups`)
        if (!okOptions(b.life_areas)) errors.push(`${bt}: coverage needs life_areas`)
      }
      if (b.type === "list" && (!["bullets", "numbers", "quotes"].includes(b.style) || !Array.isArray(b.items))) errors.push(`${bt}: list needs style and items`)
      if (b.type === "callout" && !["peach", "paleblue"].includes(b.tone)) errors.push(`${bt}: callout tone must be peach or paleblue`)
      if (b.type === "big_quote" && !str(b.text) && !str(b.body)) errors.push(`${bt}: big_quote needs text or body`)
      if (["field", "pick", "star", "scenario", "select", "story"].includes(b.type)) {
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
