// Run: npx tsx lib/workbook/coachguide.test.ts
//
// The Coach Command Center content model, against a small self-contained case
// (no client file, so no real case data in git). What these pin: a structured
// coach guide validates, the whole guide (Teams messages, private working,
// hints, rubric) is gone from the client view, the coach's case prompt IS the
// client's block and not a copy, evaluations are checked against the content's
// own rubric keys, and the Performance Package keeps the guide in the coach's
// copy and out of the student-facing part.

import {
  DEFAULT_RUBRIC_SCALE, casePromptBlocks, evaluationError, hasPracticeResults, sectionRubric,
  stripCoachOnly, validateContent, type WorkbookContent,
} from "./content"
import { coachFeedbackMarkdown, performanceData, workbookMarkdown, type PackageInput } from "../academy/package"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const PROMPT = "A regional bakery chain's profits have fallen for two quarters. The owner wants to know why."
const SEND_A = "Revenue $10M last year, $9M this year. Costs $8M both years."
const PRIVATE_A = "PRIVATE-WORKING: profit fell from $2M to $1M, down 50%."
const HINT = "PRIVATE-HINT: what equation connects revenue, cost and profit?"

const raw = {
  schema_version: 1, slug: "guide-fixture", title: "Live case fixture", section_word: "Session",
  client: { first_name: "Alex", full_name: "Alex Example" }, coach: { first_name: "Peri" },
  interview: null,
  sections: [
    { id: "c1", number: 1, title: "Case 1", blocks: [
      { type: "heading", text: "The case" },
      { type: "text", body: PROMPT, case_prompt: true },
      { type: "field", key: "c1.restate", input: "long", label: "Restate the problem." },
      { type: "coach_only", title: "Playbook", guide: {
        opening: ["Read only the case prompt."],
        clarify: [{ ask: "Objective", answer: "PRIVATE-CLARIFY: restore profit." }],
        messages: [
          { label: "A", title: "Financials", send: SEND_A, private: PRIVATE_A },
          { label: "B", title: "Coaching move", private: "PRIVATE-MOVE: ask what else would matter." },
        ],
        hints: [HINT], hint_note: "Note which hint was used.",
        checklist: ["Clarified the objective"], notes: ["PRIVATE-NOTE"],
      } },
    ] },
    { id: "c2", number: 2, title: "Debrief", blocks: [
      { type: "field", key: "c2.strong", input: "long", label: "What felt strongest?" },
      { type: "coach_only", title: "Scoring", guide: { rubric: { items: [
        { key: "structure", label: "Structure" }, { key: "math", label: "Quantitative reasoning" },
      ], note: "Record the exact prompt used." } } },
    ] },
  ],
  summary: { title: "Notes", eyebrow: "After", blocks: [] },
}

console.log("validateContent")
const v = validateContent(raw)
ok("a guide-only coach_only block is valid", v.ok)
if (!v.ok) { console.error(v.errors); process.exit(1) }
const c: WorkbookContent = v.content
const bad = (mut: (x: any) => void) => { const x = JSON.parse(JSON.stringify(raw)); mut(x); return validateContent(x) }
ok("a coach_only with neither body nor guide is refused", !bad((x) => { delete x.sections[0].blocks[3].guide }).ok)
ok("a Teams message with nothing to send and nothing private is refused", !bad((x) => { x.sections[0].blocks[3].guide.messages[0] = { label: "A" } }).ok)
ok("a rubric item key with spaces is refused", !bad((x) => { x.sections[1].blocks[1].guide.rubric.items[0].key = "Logical structure" }).ok)
ok("duplicate rubric item keys are refused", !bad((x) => { x.sections[1].blocks[1].guide.rubric.items[1].key = "structure" }).ok)
ok("case_prompt must be true or absent", !bad((x) => { x.sections[0].blocks[1].case_prompt = "yes" }).ok)
ok("an old body-only coach_only is still valid", bad((x) => { x.sections[0].blocks[3] = { type: "coach_only", body: "Free text notes" } }).ok)

console.log("privacy: the client view")
const client = stripCoachOnly(c)
const clientJson = JSON.stringify(client)
ok("no coach_only block survives", !client.sections.some((s) => s.blocks.some((b) => b.type === "coach_only")))
ok("no guide survives", !clientJson.includes("\"guide\""))
for (const secret of [PRIVATE_A, HINT, SEND_A, "PRIVATE-CLARIFY", "PRIVATE-MOVE", "PRIVATE-NOTE", "Quantitative reasoning"]) {
  ok(`client JSON does not contain "${secret.slice(0, 30)}"`, !clientJson.includes(secret))
}
ok("the case prompt is still there for the client", clientJson.includes(PROMPT))
ok("client blocks are the non-coach blocks, unchanged and in order",
  JSON.stringify(client.sections.map((s) => s.blocks)) === JSON.stringify(c.sections.map((s) => s.blocks.filter((b) => b.type !== "coach_only"))))

console.log("case prompt")
const prompts = casePromptBlocks(c.sections[0])
ok("the section has one case prompt", prompts.length === 1)
ok("it is the client's own block object, not a copy", prompts[0] === c.sections[0].blocks[1])
ok("a section without a flagged block has none", casePromptBlocks(c.sections[1]).length === 0)

console.log("rubric and evaluations")
const r = sectionRubric(c.sections[1])
ok("the debrief has a rubric", !!r && r.items.length === 2)
ok("the default scale is Independent / Prompted / Not demonstrated", JSON.stringify(r?.scale) === JSON.stringify(DEFAULT_RUBRIC_SCALE))
ok("a rubric makes the Results view available", hasPracticeResults(c))
ok("a valid evaluation passes", evaluationError(c, { section_id: "c2", ratings: { structure: { rating: "prompted", note: "Used hint 2" } }, note: "Strong close" }) === null)
ok("clearing a rating (null) passes", evaluationError(c, { section_id: "c2", ratings: { math: { rating: null } }, note: null }) === null)
ok("an unknown item is refused", evaluationError(c, { section_id: "c2", ratings: { charisma: { rating: "prompted" } } }) !== null)
ok("a rating off the scale is refused", evaluationError(c, { section_id: "c2", ratings: { structure: { rating: "excellent" } } }) !== null)
ok("a section without a rubric is refused", evaluationError(c, { section_id: "c1", ratings: {} }) !== null)
ok("an unknown section is refused", evaluationError(c, { section_id: "zz", ratings: {} }) !== null)

console.log("Performance Package")
const input: PackageInput = {
  generated_at: "2026-10-18T18:00:00.000Z", partial: true,
  student: { profile_id: "s", name: "Alex Example", email: null }, coach: { profile_id: "k", name: "Peri" },
  workbook: { id: "w", slug: "guide-fixture", title: "Live case fixture", status: "with_client", created_at: "2026-10-18T12:00:00.000Z",
    content: c, answers: {}, sends: [],
    evaluations: [{ section_id: "c2", ratings: { structure: { rating: "independent" }, math: { rating: "prompted", note: "Used hint 1" } }, note: "Clear structure.", updated_at: "2026-10-18T17:00:00.000Z" }] },
  round: null, attempts: [],
}
const coachMd = workbookMarkdown(input)
const studentMd = workbookMarkdown(input, { coachOnly: false })
ok("the coach's Workbook.md carries the Teams message and the private working", coachMd.includes(SEND_A) && coachMd.includes(PRIVATE_A))
ok("the student-facing workbook export has no guide", !studentMd.includes(PRIVATE_A) && !studentMd.includes(HINT) && !studentMd.includes(SEND_A))
const fb = coachFeedbackMarkdown(input)
ok("Coach_Feedback.md has the evaluation table", fb.includes("| Structure | Independent |") && fb.includes("| Quantitative reasoning | Prompted | Used hint 1 |"))
const data = performanceData(input) as any
const ev = data.workbook.evaluations[0]
ok("Performance_Data.json has structured evaluations with stable keys", ev.section_id === "c2" && ev.items[1].key === "math" && ev.items[1].rating === "prompted" && ev.items[1].rating_label === "Prompted" && ev.note === "Clear structure.")

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log("\nall coach guide checks pass")
