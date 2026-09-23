// Run: npx tsx lib/workbook/content.test.ts
//
// The workbook content model, against Ryan's real content file. What these
// pin: the field-key contract (STAR and scenario sub-keys), coach_only never
// surviving the client view, the reserved checklist keys, and the validator
// refusing a file that would render half a workbook.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  CHECKLIST_PREFIX, allFieldKeys, anchorError, answerText, applyTemplate, isFilled, isWritableKey,
  lastHomeworkSectionId, progress, quoteText, sectionOfField, stripCoachOnly, unresolvedPlaceholders,
  displayValue, validateAnswerValue, validateContent,
  type WorkbookContent,
} from "./content"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const raw = JSON.parse(readFileSync(join(__dirname, "../../docs/workbooks-v1/workbooks-v1/ryan-hecht_skyhawks-le-coordinator.json"), "utf8"))

console.log("validateContent")
const parsed = validateContent(raw)
ok("Ryan's file is valid", parsed.ok)
if (!parsed.ok) { console.error(parsed.errors); process.exit(1) }
const c: WorkbookContent = parsed.content

const clone = () => JSON.parse(JSON.stringify(raw))
{
  const bad = clone(); bad.sections[0].blocks.push({ type: "mystery" })
  const r = validateContent(bad)
  ok("unknown block type is refused", !r.ok && r.errors.some((e) => e.includes("mystery")))
}
{
  const bad = clone(); bad.sections[1].blocks.push({ type: "field", key: "decode.part1", input: "short", label: "dup" })
  const r = validateContent(bad)
  ok("duplicate field key is refused", !r.ok && r.errors.some((e) => e.includes("duplicate field key")))
}
{
  const bad = clone(); bad.summary.blocks[1].field = "hook.nope"
  const r = validateContent(bad)
  ok("summary pointing at a missing field is refused", !r.ok && r.errors.some((e) => e.includes("hook.nope")))
}
{
  const bad = clone(); bad.sections[0].id = "_general"
  ok("reserved section id is refused", !validateContent(bad).ok)
}
{
  const bad = clone(); bad.sections[0].blocks.push({ type: "field", key: "summary.check.9", input: "short", label: "x" })
  ok("a content key inside the checklist namespace is refused", !validateContent(bad).ok)
}

console.log("field keys")
const keys = allFieldKeys(c)
ok("STAR expands to its seven parts", ["story", "s", "t", "a", "r", "reflection", "time"].every((p) => keys.includes(`star.plan.${p}`)))
ok("scenario expands to its five parts", ["calm", "fix", "communicate", "prevent", "before"].every((p) => keys.includes(`scn.anthem.${p}`)))
ok("pick is one key", keys.includes("tmay.longterm_pick"))
ok("keys are unique", new Set(keys).size === keys.length)
ok("7 STAR x 7 + 6 scenarios x 5 are all present", keys.filter((k) => k.startsWith("star.")).length === 49 && keys.filter((k) => k.startsWith("scn.")).length === 30)
ok("sectionOfField finds a STAR part", sectionOfField(c, "star.team.r") === "stories")

console.log("coach_only")
const hasCoachOnly = (x: WorkbookContent) => x.sections.some((s) => s.blocks.some((b) => b.type === "coach_only"))
ok("the source file has a coach_only block", hasCoachOnly(c))
const client = stripCoachOnly(c)
ok("stripped content has none", !hasCoachOnly(client))
ok("stripping keeps every field", allFieldKeys(client).length === keys.length)
ok("stripping does not mutate the original", hasCoachOnly(c))
ok("no coach_only text survives anywhere in the client JSON", !JSON.stringify(client).includes("Hawks Smile Maker"))

console.log("writable keys and values")
ok("a content field is writable", isWritableKey(c, "hook.final"))
ok("checklist 0 is writable", isWritableKey(c, `${CHECKLIST_PREFIX}0`))
ok("checklist past the end is not", !isWritableKey(c, `${CHECKLIST_PREFIX}5`))
ok("an invented key is not", !isWritableKey(c, "hook.nope"))
ok("text accepts a string", validateAnswerValue(c, "hook.final", "grew up on a farm") === null)
ok("text refuses an object", validateAnswerValue(c, "hook.final", { choice: "x", other: "" }) !== null)
const pick = c.sections.flatMap((s) => s.blocks).find((b) => b.type === "pick") as { options: string[] }
ok("pick accepts an option", validateAnswerValue(c, "tmay.longterm_pick", { choice: pick.options[0], other: "" }) === null)
ok("pick accepts other with text", validateAnswerValue(c, "tmay.longterm_pick", { choice: "__other__", other: "running a venue" }) === null)
ok("pick refuses an invented option", validateAnswerValue(c, "tmay.longterm_pick", { choice: "astronaut", other: "" }) !== null)
ok("checklist accepts 1 and empty only", validateAnswerValue(c, `${CHECKLIST_PREFIX}0`, "1") === null && validateAnswerValue(c, `${CHECKLIST_PREFIX}0`, "yes") !== null)

console.log("answers and progress")
ok("blank string is not filled", !isFilled("   "))
ok("pick with other text is filled", isFilled({ choice: "__other__", other: "x" }))
ok("answerText of an other pick is the free text", answerText({ choice: "__other__", other: "running a venue" }) === "running a venue")
const decodeKeys = ["decode.part1", "decode.part2", "decode.part3"]
const p = progress(c, { ...Object.fromEntries(decodeKeys.map((k) => [k, "yes"])), [`${CHECKLIST_PREFIX}0`]: "1" })
ok("a fully answered section is done", p.sectionsDone.has("job-decoded") && p.sectionsDone.size === 1)
ok("checklist ticks never count as progress", p.filled === 3 && p.total === keys.length)

console.log("anchors")
ok("section anchor", anchorError(c, "hook", null) === null)
ok("field in its section", anchorError(c, "hook", "hook.q1") === null)
ok("field in the wrong section", anchorError(c, "tmay", "hook.q1") !== null)
ok("general box has no field", anchorError(c, "_general", null) === null && anchorError(c, "_general", "hook.q1") !== null)
ok("unknown section", anchorError(c, "nope", null) !== null)

// ---------------------------------------------------------------------------
// Session templates (docs/workbook-templates/session-1-foundations.json)
// ---------------------------------------------------------------------------

console.log("templates")
const tRaw = JSON.parse(readFileSync(join(__dirname, "../../docs/workbook-templates/session-1-foundations.json"), "utf8"))
const VALUES = { first_name: "Alex", full_name: "Alex Rivera", coach_first_name: "Peri" }
ok("the template still carries placeholders", unresolvedPlaceholders(tRaw).length > 0)
const filled = applyTemplate(tRaw, VALUES)
ok("nothing is left unfilled", unresolvedPlaceholders(filled).length === 0)
ok("the source file is not mutated", unresolvedPlaceholders(tRaw).length > 0)
ok("client names are filled", filled.client.first_name === "Alex" && filled.client.full_name === "Alex Rivera")
ok("the coach name is filled", filled.coach.first_name === "Peri")
ok("a field prefix is filled", JSON.stringify(filled).includes("Oh yeah, Alex. The one who"))
ok("the summary title is filled", filled.summary.title === "Alex, here's your Session 1 work.")

const tParsed = validateContent(filled)
ok("a filled template validates", tParsed.ok)
if (!tParsed.ok) console.error(tParsed.errors)
const t = (tParsed as { ok: true; content: WorkbookContent }).content
ok("a session workbook has no interview", t.interview === null)
ok("template keys survive validation", t.template === true && t.template_id === "session-1-foundations")
ok("section modes are read", t.sections.filter((s) => s.mode === "in_session").length === 5 && t.sections.filter((s) => s.mode === "homework").length === 2)
ok("the homework button belongs to the last homework section", lastHomeworkSectionId(t) === "finish")
ok("an interview workbook has no homework section", lastHomeworkSectionId(c) === null)
ok("coach_only blocks carry titles", t.sections.every((s) => s.blocks.filter((b) => b.type === "coach_only").every((b) => !!(b as { title?: string }).title)))
ok("coach guides never reach the client", !JSON.stringify(stripCoachOnly(t)).includes("Coach guide"))
const quote = t.sections.flatMap((s) => s.blocks).find((b) => b.type === "big_quote")!
ok("a big_quote written as body still has text", quoteText(quote as Extract<typeof quote, { type: "big_quote" }>).startsWith("Hi, as you already know"))
ok("the template has 33 fields", allFieldKeys(t).length === 33)

{
  const bad = JSON.parse(JSON.stringify(tRaw)); bad.sections[0].mode = "in session"
  ok("an unknown section mode is refused", !validateContent(applyTemplate(bad, VALUES)).ok)
}
{
  const bad = JSON.parse(JSON.stringify(tRaw)); bad.summary.title = "{frist_name}, here's your work."
  ok("a misspelled placeholder is detected", unresolvedPlaceholders(applyTemplate(bad, VALUES)).includes("{frist_name}"))
}
{
  const bad = JSON.parse(JSON.stringify(tRaw))
  bad.sections[3].blocks = bad.sections[3].blocks.map((b: { type: string }) => (b.type === "big_quote" ? { type: "big_quote" } : b))
  ok("a big_quote with neither text nor body is refused", !validateContent(applyTemplate(bad, VALUES)).ok)
}

// ---------------------------------------------------------------------------
// Starter text (Harry's recruiter-call workbook)
// ---------------------------------------------------------------------------

console.log("starter text")
const hRaw = JSON.parse(readFileSync(join(__dirname, "../../docs/workbooks-v1/workbooks-v1/harry_recruiter-call-lease-coordinator.json"), "utf8"))
const hParsed = validateContent(hRaw)
ok("Harry's workbook is valid", hParsed.ok)
if (!hParsed.ok) console.error(hParsed.errors)
const h = (hParsed as { ok: true; content: WorkbookContent }).content
const starters = h.sections.flatMap((s) => s.blocks)
  .filter((b): b is Extract<typeof b, { type: "field" }> => b.type === "field" && !!b.starter)
ok("five fields carry starter text", starters.length === 5)
ok("the questions starter keeps its seven lines",
  (starters.find((b) => b.key === "q.top3")!.starter!.match(/\n/g) ?? []).length === 6)
ok("an unanswered starter field shows the starter", displayValue(undefined, "seed") === "seed")
ok("a saved answer wins over the starter", displayValue("mine", "seed") === "mine")
ok("clearing the box does not bring the starter back", displayValue("", "seed") === "")
ok("a field with no starter is still empty", displayValue(undefined, undefined) === "")
ok("an untouched starter is never counted as progress", progress(h, {}).filled === 0)
ok("...and never reaches the summary as an answer", answerText(undefined) === "")
{
  const bad = JSON.parse(JSON.stringify(hRaw))
  bad.sections[0].blocks.push({ type: "callout", tone: "peach", body: "x", starter: "nope" })
  ok("starter on a non-field block is refused", !validateContent(bad).ok)
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log("\nall passed")
