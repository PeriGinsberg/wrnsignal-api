// Run: npx tsx lib/workbook/practice.test.ts
//
// The practice blocks (video, link, quiz, numeric, sort, reveal) against Sami's
// real Deloitte bootcamp content file. What these pin: the file validates, the
// answer key in the file is right (every numeric answer is recomputed here from
// the case facts, not copied), answers are accepted only in the shapes the
// renderer saves, progress counts what it should, coach_only never reaches the
// client view, and the coach's Sunday summary reports only what was answered.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  allFieldKeys, gradeAnswer, gradedItems, hasPracticeResults, isWritableKey, parseNumber, progress,
  sectionDays, sortMatches, stripCoachOnly, validateAnswerValue, validateContent,
  type Block, type WorkbookContent,
} from "./content"
import { sundaySummary } from "../../components/workbook/PracticeResults"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const file = join(__dirname, "../../docs/workbooks-v1/workbooks-v1/sami-zivitz_deloitte-case-bootcamp-01.json")
const raw = JSON.parse(readFileSync(file, "utf8"))
const v = validateContent(raw)
if (!v.ok) console.error(v.errors)
ok("Sami's content file validates", v.ok)
const c = raw as WorkbookContent
const blocks = c.sections.flatMap((s) => s.blocks)
const block = <T extends Block["type"]>(type: T, key: string) =>
  blocks.find((b) => b.type === type && (b as { key?: string }).key === key) as Extract<Block, { type: T }>

console.log("\nstructure")
ok("nine modules", c.sections.length === 9)
const days = sectionDays(c)
ok("Friday is modules 1-4, Saturday 5-9",
  days.length === 2 && days[0].day === "Friday" && days[0].sections.map((s) => s.number).join() === "1,2,3,4"
  && days[1].day === "Saturday" && days[1].sections.map((s) => s.number).join() === "5,6,7,8,9")
ok("every module says how long it takes", c.sections.every((s) => !!s.minutes))
ok("both required videos are present", ["lmQt9ak2jjA", "cydnRA25gAw"].every((id) => blocks.some((b) => b.type === "video" && b.url.endsWith(id))))
ok("the Deloitte tool link is optional", blocks.some((b) => b.type === "link" && b.kind === "tool" && b.optional))
ok("has practice results", hasPracticeResults(c))
ok("no em dashes anywhere in the file", !readFileSync(file, "utf8").includes("—"))
ok("no placeholder text", !/\b(TODO|TBD|lorem|\[[A-Z ]+\])/i.test(readFileSync(file, "utf8")))
const client = stripCoachOnly(c)
ok("coach_only blocks never reach the client view", !client.sections.some((s) => s.blocks.some((b) => b.type === "coach_only")))
ok("...and the content has some to strip", blocks.some((b) => b.type === "coach_only"))

console.log("\nanswer key, recomputed from the case facts")
const n = (key: string) => block("numeric", key).answer
ok("gym profit fell (12-8)/12 = 33.3%", Math.abs(n("m4.pct") - ((12 - 8) / 12) * 100) < 0.05)
ok("coffee revenue 5 x 400", n("m6.revenue") === 5 * 400)
ok("software profit 30M - 24M", n("m6.profit") === 30e6 - 24e6)
ok("store sales fell (80k-60k)/80k = 25%", n("m6.pct") === ((80000 - 60000) / 80000) * 100)
ok("printing savings 600k x 40%", n("m6.savings") === 600000 * 0.4)
ok("machine payback 900k / 300k", n("m6.payback") === 900000 / 300000)
ok("streaming 40,000 x $25 x 12", n("m6.annual") === 40000 * 25 * 12)
ok("bank saves 4M x 25%", n("m8.savings") === 4e6 * 0.25)
ok("bank payback 6M / 1M", n("m8.payback") === 6e6 / (4e6 * 0.25))
ok("5 years of savings is less than the cost (the m8.q_life answer)", 5 * n("m8.savings") < 6e6)

console.log("\nparseNumber")
ok("$2,000", parseNumber("$2,000") === 2000)
ok("33.3%", parseNumber("33.3%") === 33.3)
ok("12M", parseNumber("12M") === 12e6)
ok("1.5 million", parseNumber("1.5 million") === 1.5e6)
ok("250k", parseNumber("250k") === 250000)
ok("6 years", parseNumber("6 years") === 6)
ok("-25", parseNumber("-25") === -25)
ok("words are not a number", parseNumber("about a third") === null)

console.log("\ngrading")
const pct = block("numeric", "m4.pct")
ok("33.3 is right", gradeAnswer(pct, "33.3") === "correct")
ok("33 is right (rounding)", gradeAnswer(pct, "33") === "correct")
ok("33.33% is right", gradeAnswer(pct, "33.33%") === "correct")
ok("-33.3 is right (either sign)", gradeAnswer(pct, "-33.3") === "correct")
ok("50 (dividing by 8) is wrong", gradeAnswer(pct, "50") === "wrong")
ok("blank is unanswered", gradeAnswer(pct, "") === null)
const annual = block("numeric", "m6.annual")
ok("12M is right", gradeAnswer(annual, "12M") === "correct")
ok("12,000,000 is right", gradeAnswer(annual, "$12,000,000") === "correct")
ok("1M (monthly) is wrong", gradeAnswer(annual, "1,000,000") === "wrong")
const payback = block("numeric", "m8.payback")
ok("payback has no either-sign: -6 is wrong", gradeAnswer(payback, "-6") === "wrong")
const q1 = block("quiz", "m1.q1")
ok("single quiz right", gradeAnswer(q1, q1.correct[0]) === "correct")
ok("single quiz wrong", gradeAnswer(q1, q1.options[0]) === "wrong")
const q3 = block("quiz", "m1.q3")
ok("multi quiz needs exactly the right set", gradeAnswer(q3, q3.correct) === "correct")
ok("multi quiz missing one is wrong", gradeAnswer(q3, q3.correct.slice(1)) === "wrong")
ok("multi quiz with an extra is wrong", gradeAnswer(q3, q3.options) === "wrong")
ok("every quiz's correct answers are among its options", blocks.every((b) => b.type !== "quiz" || b.correct.every((x) => b.options.includes(x))))

console.log("\nanswer validation (what the save route accepts)")
ok("video takes 1", validateAnswerValue(c, "m2.video", "1") === null)
ok("video refuses yes", validateAnswerValue(c, "m2.video", "yes") !== null)
ok("single quiz takes an option", validateAnswerValue(c, "m1.q1", q1.options[1]) === null)
ok("single quiz refuses a made-up option", validateAnswerValue(c, "m1.q1", "anything") !== null)
ok("multi quiz takes a list of options", validateAnswerValue(c, "m1.q3", q3.correct) === null)
ok("multi quiz refuses a string", validateAnswerValue(c, "m1.q3", q3.options[0]) !== null)
ok("numeric takes text", validateAnswerValue(c, "m4.pct", "33.3") === null)
ok("numeric refuses a number type", validateAnswerValue(c, "m4.pct", 33.3) !== null)
ok("sort item takes a category", validateAnswerValue(c, "m5.sort.1", "Customer demand") === null)
ok("sort item refuses another word", validateAnswerValue(c, "m5.sort.1", "Marketing") !== null)
ok("sort checked takes 1", validateAnswerValue(c, "m5.sort.checked", "1") === null)
ok("sort keys are writable", isWritableKey(c, "m5.sort.8") && isWritableKey(c, "m5.sort.checked"))
ok("a ninth sort item is not", !isWritableKey(c, "m5.sort.9"))
ok("pick still validates as before", validateAnswerValue(c, "m8.rec", { choice: "Hold off for now", other: "" }) === null)
ok("field keys are unique", new Set(allFieldKeys(c)).size === allFieldKeys(c).length)

console.log("\nprogress")
const empty = progress(c, {})
ok("nothing done at the start", empty.filled === 0 && empty.sectionsDone.size === 0)
ok("sort checked and the optional math reflection are not counted",
  !Number.isNaN(empty.total) && progress(c, { "m5.sort.checked": "1", "m6.hardest": "x" }).filled === 0)
const m2 = { "m2.video": "1", "m2.surprised": "a", "m2.effective": "b", "m2.difficult": "c" }
ok("module 2 is done with the video ticked and three answers", progress(c, m2).sectionsDone.has("m2-first-video"))
ok("...and not without the video", !progress(c, { ...m2, "m2.video": "" }).sectionsDone.has("m2-first-video"))

console.log("\nsort")
const sort = block("sort", "m5.sort")
const sample = Object.fromEntries(sort.items.map((it, i) => [`m5.sort.${i + 1}`, it.category]))
ok("the sample matches itself 8 of 8", sortMatches(sort, sample).matched === 8 && sortMatches(sort, sample).done)
ok("half sorted is not done", !sortMatches(sort, { "m5.sort.1": "Competition" }).done)
ok("every category is used by the sample", sort.categories.every((cat) => sort.items.some((it) => it.category === cat)))

console.log("\nSunday summary (coach only)")
const none = sundaySummary(c, {})
ok("with no answers, every part says so", [none.understands, none.needsExplaining, none.struggled].every((x) => x.length === 1 && /Not enough answers/.test(x[0])))
const some: Record<string, unknown> = {
  "m4.pct": "50", "m6.revenue": "2000", "m1.q1": q1.correct[0],
  "m9.confused": "When to do math", "m9.practice": "Opening a case", "m9.confidence": { choice: "2: A little unsure", other: "" },
}
const s = sundaySummary(c, some)
ok("a missed math answer shows with what was typed and expected", s.struggled.some((x) => x.includes("Sami answered 50") && x.includes("33.3")))
ok("a skill with all checks right is under understands", s.understands.some((x) => x.startsWith("How a case interview works")))
ok("her own confusion is quoted", s.needsExplaining.some((x) => x.includes("When to do math")))
ok("her practice wish and confidence are in the focus list", s.focus.some((x) => x.includes("Opening a case")) && s.focus.some((x) => x.includes("2: A little unsure")))
ok("case math is ranked as a focus", s.focus.some((x) => x.startsWith("Case math")))
ok("unfinished modules are listed", s.focus.some((x) => x.startsWith("Not finished yet")))
const g = gradedItems(c, some)
ok("graded items cover every quiz and numeric", g.length === blocks.filter((b) => b.type === "quiz" || b.type === "numeric").length)

console.log("\nvalidator refuses broken practice blocks")
const bad = (mutate: (x: any) => void) => {
  const x = JSON.parse(JSON.stringify(raw))
  mutate(x)
  return !validateContent(x).ok
}
ok("a quiz whose correct answer is not an option", bad((x) => { x.sections[0].blocks.find((b: any) => b.key === "m1.q1").correct = ["nope"] }))
ok("a single quiz with two correct answers", bad((x) => { const q = x.sections[0].blocks.find((b: any) => b.key === "m1.q1"); q.correct = q.options.slice(0, 2) }))
ok("a numeric with no explanation", bad((x) => { delete x.sections[3].blocks.find((b: any) => b.key === "m4.pct").explanation }))
ok("a video with an http url", bad((x) => { x.sections[1].blocks.find((b: any) => b.type === "video").url = "http://example.com" }))
ok("a reveal waiting for a key that does not exist", bad((x) => { x.sections[0].blocks.find((b: any) => b.type === "reveal").after = ["m1.nope"] }))
ok("a sort item in no category", bad((x) => { x.sections[4].blocks.find((b: any) => b.type === "sort").items[0].category = "Other" }))
ok("results pointing at a missing field", bad((x) => { x.results.confusing = ["m9.nope"] }))

console.log(failures ? `\n${failures} FAILED` : "\nall passed")
process.exit(failures ? 1 : 0)
