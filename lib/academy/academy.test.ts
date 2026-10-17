// Run: npx tsx lib/academy/academy.test.ts
//
// The Casing Academy against Will's real content: the case library entry is
// well formed and its answer key is right (recomputed here from the exhibit,
// not copied), the Case Accelerator workbook validates and its math answers
// are right, drill answers are accepted only in the shapes the renderer
// saves, coach_only never reaches the client view, the Performance Package
// keeps coach feedback in its own section after the student's work and says
// so when anything is missing, and the ZIP writer produces a valid archive.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  allFieldKeys, drillKeys, gradeAnswer, isWritableKey, progress, stripCoachOnly, validateAnswerValue, validateContent,
  type Block, type WorkbookContent,
} from "../workbook/content"
import { CASES, caseErrors, getCase } from "./cases"
import { cleanRubric, DIMENSIONS, rubricAverage } from "./rubric"
import { chatgptMarkdown, coachFeedbackMarkdown, packageFiles, recordingRefs, transcriptMarkdown, workbookMarkdown, type PackageInput } from "./package"
import { crc32, zipParts } from "./zip"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

// ── Case library ──────────────────────────────────────────────────────────
const def = getCase("meridian-card-baseline")!
ok("meridian case is registered", !!def)
for (const c of Object.values(CASES)) ok(`case ${c.id} has no errors`, caseErrors(c).length === 0)
ok("eight questions in order q1..q8", def.questions.map((q) => q.qkey).join(",") === "q1,q2,q3,q4,q5,q6,q7,q8")
ok("time limits are the prompt's", def.questions.map((q) => q.answer_seconds).join(",") === "45,120,60,90,180,90,90,60")
ok("Q5 and Q7 carry exhibits", !!def.questions[4].exhibit && !!def.questions[6].exhibit)
ok("five self-assessment questions", def.self_assessment.length === 5)

// The answer key, recomputed from the exhibit.
const holders = 2_000_000, share = 0.25, extra = 200, take = 0.018, cost = 12_000_000
const volume = holders * share * extra * 12
const revenue = volume * take
ok("volume is $1.2 billion", volume === 1_200_000_000)
ok("revenue is $21.6 million", Math.abs(revenue - 21_600_000) < 1)
ok("contribution is $9.6 million", Math.abs(revenue - cost - 9_600_000) < 1)
ok("answer key states all three", ["$1.2 billion", "$21.6 million", "$9.6 million"].every((x) => def.coach.answer_key.join(" ").includes(x)))
const beVolume = cost / take
const beShare = beVolume / (extra * 12) / holders
const beMonthly = beVolume / (holders * share) / 12
ok("break-even participation about 13.9%", Math.abs(beShare - 0.139) < 0.001)
ok("break-even spend about $111 a month", Math.abs(beMonthly - 111.1) < 0.1)
ok("break-even figures in the key match", def.coach.answer_key.join(" ").includes("13.9%") && def.coach.answer_key.join(" ").includes("$111"))
ok("the five coaching prompts are present", ["What's your headline?", "Which two factors matter most?", "Give me your answer in one sentence.", "What does that number mean for the business?", "What would you tell the Chief Strategy Officer?"].every((p) => def.coach.coaching_prompts.includes(p)))
const allText = JSON.stringify(def) + readFileSync(join(__dirname, "rubric.ts"), "utf8")
ok("no em or en dashes in case or rubric prose", !/[–—]/.test(allText))

// ── Rubric ────────────────────────────────────────────────────────────────
ok("ten rubric dimensions", DIMENSIONS.length === 10)
const r = cleanRubric({ conciseness: { score: 3, note: "ran long" }, clarity: { score: 9 }, bogus: { score: 2 } })
ok("rubric keeps known dimensions, drops bad scores", r.conciseness?.score === 3 && !r.clarity && !("bogus" in r))
ok("rubric average", rubricAverage({ conciseness: { score: 3, note: "" }, clarity: { score: 4, note: "" } }) === 3.5)

// ── Will's workbook ───────────────────────────────────────────────────────
const file = join(__dirname, "../../docs/workbooks-v1/workbooks-v1/will-friedman_amex-case-accelerator-01.json")
const rawText = readFileSync(file, "utf8")
ok("workbook has the practice-round token", rawText.includes("__PRACTICE_ROUND_ID__"))
const v = validateContent(JSON.parse(rawText.split("__PRACTICE_ROUND_ID__").join("00000000-0000-0000-0000-000000000000")))
if (!v.ok) console.error(v.errors)
ok("Will's workbook validates", v.ok)
const c = (v as { content: WorkbookContent }).content
ok("seven modules, all Saturday", c.sections.length === 7 && c.sections.every((s) => s.day === "Saturday"))
ok("title is the Case Accelerator", (c.title ?? "").startsWith("Case Accelerator"))
ok("no em or en dashes in the workbook", !/[–—]/.test(rawText))
const blocks = c.sections.flatMap((s) => s.blocks)
const drills = blocks.filter((b): b is Extract<Block, { type: "drill" }> => b.type === "drill")
ok("3 headline + 4 structure + 2 brainstorm + 2 recommendation drills", drills.length === 11)
ok("headline drills give 20 to 30 seconds to prepare", drills.filter((d) => d.key.startsWith("m2.")).every((d) => d.prep_seconds >= 20 && d.prep_seconds <= 30))
ok("recommendation drills target 60 seconds", drills.filter((d) => d.key.startsWith("m6.")).every((d) => d.speak_seconds === 60))
ok("every headline drill asks if he led with his conclusion", drills.filter((d) => d.key.startsWith("m2.")).every((d) => d.check?.question === "Did you lead with your conclusion?"))
const link = blocks.find((b) => b.type === "link" && b.kind === "practice") as Extract<Block, { type: "link" }>
ok("module 7 links to the practice round", !!link && link.url === "/dashboard/practice/00000000-0000-0000-0000-000000000000")
const amex = blocks.find((b) => b.type === "link" && b.url.includes("americanexpress.com")) as Extract<Block, { type: "link" }>
ok("the official Amex practice case is linked", !!amex && amex.url.endsWith("spg-practice-case.pdf?linknav=practice-case"))
ok("no behavioral interview prep", !/tell me about a time|behavioral/i.test(rawText))

// Math answers, recomputed.
const num = (k: string) => (blocks.find((b) => b.type === "numeric" && b.key === k) as Extract<Block, { type: "numeric" }>).answer
ok("revenue: 4M x $1,500 x 12 x 2%", num("m5.rev") === 4e6 * 1500 * 12 * 0.02)
ok("profit: 30 - 12 - 6", num("m5.profit") === 12e6)
ok("margin: 12 / 30", num("m5.margin") === 40)
ok("lifetime profit: 150 x 4 - 300", num("m5.ltv") === 300)
ok("payback: 300 / 150", num("m5.payback") === 2)
ok("coffee market: 260M x 40% x 2 x $6 x 50", Math.abs(num("m5.market") - 260e6 * 0.4 * 2 * 6 * 50) < 1)
ok("growth: (10 - 8) / 8", num("m5.growth") === 25)
ok("next year: 10B x 1.25", num("m5.next") === 12.5e9)
const n5 = blocks.find((b) => b.type === "numeric" && b.key === "m5.market")!
ok("market accepts 62.4B", gradeAnswer(n5, "62.4B") === "correct")
ok("market rejects 6.24B", gradeAnswer(n5, "6.24B") === "wrong")
for (const b of blocks.filter((x) => x.type === "numeric")) {
  ok(`every math question is followed by an interpretation (${(b as any).key})`, blocks.some((x) => x.type === "field" && x.key.startsWith(String((b as any).key).split("_")[0]) && x.key.endsWith("_mean")) || ["m5.margin", "m5.payback", "m5.next"].includes((b as any).key))
}

// ── Drill answers ─────────────────────────────────────────────────────────
const d1 = drills[0]
ok("drill keys: answer, secs, check", drillKeys(d1).join(",") === "m2.d1,m2.d1.secs,m2.d1.check")
ok("drill keys are writable", drillKeys(d1).every((k) => isWritableKey(c, k)))
ok("drill answer accepts text", validateAnswerValue(c, "m2.d1", "I'd start with retention.") === null)
ok("drill secs accepts a whole number", validateAnswerValue(c, "m2.d1.secs", "38") === null)
ok("drill secs refuses text", validateAnswerValue(c, "m2.d1.secs", "about 40") !== null)
ok("drill check accepts an option", validateAnswerValue(c, "m2.d1.check", d1.check!.options[0]) === null)
ok("drill check refuses anything else", validateAnswerValue(c, "m2.d1.check", "Maybe") !== null)
const withSecs = progress(c, { "m2.d1": "x", "m2.d1.secs": "40" }).filled
const withoutSecs = progress(c, { "m2.d1": "x" }).filled
ok("drill seconds do not count toward progress", allFieldKeys(c).includes("m2.d1.secs") && withSecs === withoutSecs)
const m2 = c.sections.find((s) => s.id === "m2-headline")!
const m2vals: Record<string, unknown> = {}
for (const d of drills.filter((x) => x.key.startsWith("m2."))) { m2vals[d.key] = "x"; m2vals[`${d.key}.check`] = d.check!.options[0] }
m2vals["m2.reflect"] = "x"
ok("module 2 is done without any timer seconds", progress({ sections: [m2] }, m2vals).sectionsDone.has("m2-headline"))
const stripped = stripCoachOnly(c)
ok("coach_only is stripped for the client", !JSON.stringify(stripped).includes("coach_only"))
ok("the client view keeps every drill", stripped.sections.flatMap((s) => s.blocks).filter((b) => b.type === "drill").length === 11)

// ── Performance Package ───────────────────────────────────────────────────
const now = "2026-10-17T18:00:00.000Z"
const qRows = def.questions.map((q, i) => ({
  id: `q${i + 1}`, position: i, text: q.text, source: "preset" as const, qkey: q.qkey, title: q.title,
  exhibit: q.exhibit ?? null, answer_seconds: q.answer_seconds, prep_seconds: q.prep_seconds ?? 0, fb_works: null, fb_fix: null,
}))
const takes = qRows.slice(0, 7).map((q, i) => ({
  id: `t${i + 1}`, question_id: q.id, storage_path: `round/${q.id}/v.webm`, mime: "video/webm", duration_ms: 30000 + i * 1000,
  created_at: `2026-10-17T17:0${i}:00.000Z`, audio_path: i === 2 ? null : `round/${q.id}/a.weba`,
  question_shown_at: `2026-10-17T17:0${i}:00.000Z`, response_started_at: `2026-10-17T17:0${i}:20.000Z`,
  response_ended_at: `2026-10-17T17:0${i}:50.000Z`, first_speech_ms: 1500,
  transcript: i === 1 ? null : `Um, so I'd, I'd start with answer ${i + 1}.`,
  transcript_status: (i === 1 ? "failed" : "done") as "failed" | "done", transcript_error: i === 1 ? "timeout" : null,
}))
const input: PackageInput = {
  generated_at: now, partial: true,
  student: { profile_id: "will", name: "William Friedman", email: null },
  coach: { profile_id: "peri", name: "Peri Ginsberg" },
  workbook: { id: "wb1", slug: c.slug, title: c.title ?? null, status: "with_client", created_at: now, content: c,
    answers: { "m2.d1": { value: "New users don't come back.", updated_at: now }, "m2.d1.secs": { value: "41", updated_at: now }, "m2.d1.check": { value: d1.check!.options[1], updated_at: now } }, sends: [] },
  round: {
    round: {
      id: "r1", coach_client_id: "cc", client_profile_id: "will", coach_profile_id: "peri", title: def.round_title, status: "sent",
      created_at: now, sent_at: now, submitted_at: null, kind: "case", case_id: def.id, workbook_id: "wb1", scenario: def.scenario,
      self_assessment: { longest: "Q5" }, self_assessed_at: now, fb_overall: null, feedback_sent_at: null, questions: qRows,
    },
    takes, rubric: null, review: null, review_updated_at: null, def,
  },
  attempts: [{ id: "r1", title: def.round_title, case_id: def.id, status: "sent", submitted_at: null, rubric_average: null }],
}
const files = packageFiles(input)
ok("package has the five text files", files.map((f) => f.path).join(",") === "Workbook.md,Practice_Transcript.md,Coach_Feedback.md,Performance_Data.json,ChatGPT_Review.md")
const wbMd = workbookMarkdown(input)
ok("workbook md keeps the student's words", wbMd.includes("New users don't come back."))
ok("workbook md shows drill timing", wbMd.includes("41 s"))
ok("workbook md marks unanswered questions", wbMd.includes("[Missing: no answer]"))
ok("workbook md includes the self-assessment", wbMd.includes("Which question took you the longest") && wbMd.includes("> Q5"))
const tMd = transcriptMarkdown(input)
ok("transcript keeps disfluencies verbatim", tMd.includes("> Um, so I'd, I'd start with answer 1."))
ok("transcript shows the Q5 exhibit", tMd.includes("Meridian has 2 million active cardholders."))
ok("transcript says when a transcript failed", tMd.includes("transcription failed: timeout"))
ok("transcript says when a question was not answered", tMd.includes("## Q8.") && tMd.includes("[Missing: no answer recorded"))
ok("transcript computes think time", tMd.includes("20.0 s after the question appeared"))
ok("coach feedback is pending when empty", coachFeedbackMarkdown(input).includes("PENDING"))
const gpt = chatgptMarkdown(input)
ok("chatgpt: student work comes before the coach's", gpt.indexOf("# PART A") < gpt.indexOf("# PART B"))
ok("chatgpt: tells the reviewer to assess first", gpt.includes("Do NOT read Part B until you have finished your own assessment"))
ok("chatgpt: carries the rubric anchors", DIMENSIONS.every((d) => gpt.includes(`**${d.label}**`)))
ok("chatgpt: carries the answer key in part A", gpt.indexOf("$21.6 million") < gpt.indexOf("# PART B"))
ok("chatgpt: workbook copy leaves out coach-only notes", !gpt.slice(0, gpt.indexOf("# PART B")).includes("[Coach only"))
ok("no storage URL in any file", !files.some((f) => /https?:\/\/[^\s)]*supabase/.test(f.content)))
const refs = recordingRefs(input)
ok("recording refs: video for 7 takes, audio for 6", refs.filter((x) => x.kind === "video").length === 7 && refs.filter((x) => x.path.includes("_audio")).length === 6)
ok("recording names carry the question", refs[0].path === "Recordings/Q1_business-understanding.webm")
const withFb: PackageInput = { ...input, round: { ...input.round!, rubric: { conciseness: { score: 2, note: "Q2 ran 118s" } }, review: { strengths: "Sound math" }, review_updated_at: now } }
const fbMd = coachFeedbackMarkdown(withFb)
ok("coach feedback shows scores and strengths", fbMd.includes("| Conciseness | 2 | Q2 ran 118s |") && fbMd.includes("Sound math"))
ok("coach feedback says it is private until released", fbMd.includes("no (private to the coach)"))
const data = JSON.parse(files.find((f) => f.path === "Performance_Data.json")!.content)
ok("data: stable ids", data.student.profile_id === "will" && data.round.id === "r1" && data.round.case.id === def.id && data.round.questions[0].qkey === "q1")
ok("data: think time in ms", data.round.questions[0].take.think_ms === 20000)

// ── ZIP ───────────────────────────────────────────────────────────────────
ok("crc32 of 'hello'", crc32(new TextEncoder().encode("hello")) === 0x3610a686)
const parts = zipParts([{ path: "a/Workbook.md", data: new TextEncoder().encode("# hi") }, { path: "a/b.bin", data: new Uint8Array([1, 2, 3]) }])
const zip = Buffer.concat(parts.map((p) => Buffer.from(p)))
ok("zip starts with a local header", zip.readUInt32LE(0) === 0x04034b50)
const eocd = zip.length - 22
ok("zip ends with the directory record", zip.readUInt32LE(eocd) === 0x06054b50 && zip.readUInt16LE(eocd + 10) === 2)
const cdOffset = zip.readUInt32LE(eocd + 16)
ok("central directory where the end record says", zip.readUInt32LE(cdOffset) === 0x02014b50)
ok("first file's content is stored as is", zip.subarray(30 + "a/Workbook.md".length, 30 + "a/Workbook.md".length + 4).toString() === "# hi")

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1) }
console.log("\nAll academy checks passed.")
