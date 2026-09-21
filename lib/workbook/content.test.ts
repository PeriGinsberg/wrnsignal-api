// Run: npx tsx lib/workbook/content.test.ts
//
// The workbook content model, against Ryan's real content file. What these
// pin: the field-key contract (STAR and scenario sub-keys), coach_only never
// surviving the client view, the reserved checklist keys, and the validator
// refusing a file that would render half a workbook.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  CHECKLIST_PREFIX, allFieldKeys, anchorError, answerText, isFilled, isWritableKey,
  progress, sectionOfField, stripCoachOnly, validateAnswerValue, validateContent,
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

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log("\nall passed")
