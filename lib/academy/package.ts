// lib/academy/package.ts
//
// The Performance Package: everything a coach needs to review one workbook
// and/or one practice round away from SIGNAL, and to get an independent
// ChatGPT assessment before comparing it with their own.
//
// PURE. The route loads the rows and signs the recording URLs; this turns
// them into files. It works for any workbook and any practice round, case or
// interview, because it reads the content format and the round rows rather
// than anything Will-specific.
//
// NOTHING MISSING IS SILENT. Every absent answer, recording, transcript or
// timing says so in words, because a package that quietly drops what is not
// there reads as complete.
//
// NO STORAGE URLS IN THE FILES. Recordings are referenced by their file name
// inside the ZIP. The signed URLs the browser downloads them with are short
// lived and never written into a document.

import {
  answerText, blockFieldKeys, drillKeys, gradeAnswer, isFilled, progress, sectionRubric,
  STAR_PARTS, SCENARIO_PARTS,
  type Block, type CoachGuide, type Evaluation, type WorkbookContent,
} from "@/lib/workbook/content"
import type { PracticeRound, PracticeTake } from "@/lib/practice/model"
import { answerSecondsFor, latestTakes } from "@/lib/practice/model"
import type { CaseDefinition } from "./types"
import { CASE_TYPE_LABELS } from "./types"
import { DIMENSIONS, rubricAverage, type CoachReview, type Rubric } from "./rubric"

export type Answers = Record<string, { value: unknown; updated_at: string }>

export type PackageInput = {
  generated_at: string
  partial: boolean
  student: { profile_id: string; name: string; email: string | null }
  coach: { profile_id: string; name: string }
  workbook: null | {
    id: string; slug: string; title: string | null; status: string; created_at: string
    content: WorkbookContent; answers: Answers
    sends: { direction: string; sent_at: string }[]
    /** The coach's saved rubric ratings, one per section that has a rubric. */
    evaluations?: Evaluation[]
  }
  round: null | {
    round: PracticeRound
    takes: PracticeTake[]
    rubric: Rubric | null
    review: Partial<CoachReview> | null
    review_updated_at: string | null
    def: CaseDefinition | null
  }
  attempts: { id: string; title: string; case_id: string | null; status: string; submitted_at: string | null; rubric_average: number | null }[]
}

export type RecordingRef = {
  path: string
  take_id: string
  kind: "video" | "audio"
  question: number
  storage_path: string
}

export type PackageFile = { path: string; content: string }

const MISSING = (what: string) => `_[Missing: ${what}]_`

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return MISSING("not recorded")
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? MISSING("unreadable time") : `${d.toISOString().replace("T", " ").slice(0, 19)} UTC`
}
function secs(ms: number | null | undefined): string {
  return ms == null ? MISSING("not recorded") : `${(ms / 1000).toFixed(1)} s`
}
function between(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null
  const d = new Date(b).getTime() - new Date(a).getTime()
  return Number.isFinite(d) && d >= 0 ? d : null
}
function quote(text: string): string {
  return text.split("\n").map((l) => `> ${l}`).join("\n")
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "question"
}
const EXT: Record<string, string> = { "video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov", "audio/webm": "weba", "audio/mp4": "m4a" }
function extOf(path: string, mime: string): string {
  const fromPath = path.split(".").pop()
  return fromPath && fromPath.length <= 5 ? fromPath : EXT[mime] ?? "webm"
}

// ── Workbook ─────────────────────────────────────────────────────────────

function answerLine(answers: Answers, key: string): string {
  const a = answers[key]
  if (!a || !isFilled(a.value)) return MISSING("no answer")
  return answerText(a.value)
}
function stamp(answers: Answers, key: string): string {
  const a = answers[key]
  return a && isFilled(a.value) ? ` _(saved ${fmtTime(a.updated_at)})_` : ""
}

/** A structured coach guide as Markdown, for the coach's copy of the workbook only. */
function guideMarkdown(g: CoachGuide): string {
  const out: string[] = []
  const list = (title: string, items?: string[]) => { if (items?.length) out.push(`**${title}**\n\n${items.map((x) => `- ${x}`).join("\n")}`) }
  list("Run of show", g.agenda)
  list("How to open", g.opening)
  if (g.clarify?.length) out.push(`**If the student asks**\n\n${g.clarify.map((c) => `- ${c.ask ? `${c.ask}: ` : ""}${c.answer}`).join("\n")}`)
  for (const m of g.messages ?? []) {
    out.push([`**Teams message ${m.label}${m.title ? `: ${m.title}` : ""}**`, m.send ? `Sent to the student: ${m.send}` : "Nothing sent. Coaching move only.", m.private ? `Private working: ${m.private}` : ""].filter(Boolean).join("\n\n"))
  }
  if (g.hints?.length) out.push(`**Hint ladder**\n\n${g.hints.map((h, i) => `${i + 1}. ${h}`).join("\n")}${g.hint_note ? `\n\n${g.hint_note}` : ""}`)
  if (g.checklist?.length) out.push(`**${g.checklist_title ?? "What to watch for"}**\n\n${g.checklist.map((x) => `- ${x}`).join("\n")}${g.checklist_note ? `\n\n${g.checklist_note}` : ""}`)
  if (g.rubric) out.push(`**Evaluation rubric:** ${g.rubric.items.map((i) => i.label).join("; ")}`)
  list("Coach notes", g.notes)
  return out.join("\n\n")
}

/** Each section's saved evaluation against its rubric, with the content's own labels. */
export function workbookEvaluations(input: PackageInput) {
  const wb = input.workbook
  if (!wb) return []
  return wb.content.sections.flatMap((s) => {
    const r = sectionRubric(s)
    if (!r) return []
    const ev = (wb.evaluations ?? []).find((e) => e.section_id === s.id) ?? null
    return [{
      section_id: s.id, section_title: s.title,
      scale: r.scale,
      items: r.items.map((it) => {
        const v = ev?.ratings?.[it.key]
        return { key: it.key, label: it.label, rating: v?.rating ?? null, rating_label: r.scale.find((x) => x.key === v?.rating)?.label ?? null, note: v?.note ?? null }
      }),
      note: ev?.note ?? null,
      updated_at: ev?.updated_at ?? null,
    }]
  })
}

function workbookEvaluationMarkdown(input: PackageInput): string[] {
  const out: string[] = []
  for (const e of workbookEvaluations(input)) {
    out.push(`## Workbook evaluation: ${e.section_title}`, "")
    if (!e.updated_at) { out.push(MISSING("not rated yet"), ""); continue }
    out.push(`- Last saved: ${fmtTime(e.updated_at)}`, "", "| Skill | Rating | Note |", "| --- | --- | --- |",
      ...e.items.map((i) => `| ${i.label} | ${i.rating_label ?? "not rated"} | ${(i.note ?? "").replace(/\n/g, " ").replace(/\|/g, "/")} |`),
      "", `**Overall:** ${e.note?.trim() || MISSING("not written")}`, "")
  }
  return out
}

/** One block as Markdown: instructions as written, questions with the student's answer under them. */
function blockMarkdown(b: Block, answers: Answers, opts: { coachOnly: boolean }): string {
  const vals: Record<string, unknown> = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.value]))
  switch (b.type) {
    case "text": return `${b.label ? `**${b.label}**\n\n` : ""}${b.body}`
    case "heading": return `### ${b.text}`
    case "list": return `${b.title ? `**${b.title}**\n\n` : ""}${b.items.map((x, i) => (b.style === "numbers" ? `${i + 1}. ${x}` : `- ${x}`)).join("\n")}`
    case "callout": return quote(`${b.title ? `**${b.title}**\n\n` : ""}${b.body}`)
    case "big_quote": return quote(b.text ?? b.body ?? "")
    case "word_track": return quote(`${b.label ? `**${b.label}:** ` : ""}${b.body}`)
    case "coach_note": return `_Coach's note shown to the student:_ ${b.body}`
    case "coach_only": return opts.coachOnly
      ? [`**[Coach only${b.title ? `: ${b.title}` : ""}. The student never saw this.]**`, b.body ?? "", b.guide ? guideMarkdown(b.guide) : ""].filter(Boolean).join("\n\n")
      : ""
    case "table": {
      const cols = b.columns ?? b.rows[0].map(() => "")
      return [`${b.title ? `**${b.title}**\n\n` : ""}| ${cols.join(" | ")} |`, `| ${cols.map(() => "---").join(" | ")} |`, ...b.rows.map((r) => `| ${r.join(" | ")} |`)].join("\n")
    }
    case "link": return `**Resource (${b.kind}):** ${b.title}${b.url.startsWith("/") ? "" : ` (${b.url})`}${b.body ? `\n\n${b.body}` : ""}`
    case "video": return `**Video:** ${b.title} (${b.url})\n\nWatched: ${answers[b.key]?.value === "1" ? `yes${stamp(answers, b.key)}` : MISSING("not marked as watched")}`
    case "field": return `**${b.number != null ? `${b.number}. ` : ""}${b.label}**${b.optional ? " _(optional)_" : ""}\n\n${quote(answerLine(answers, b.key))}${stamp(answers, b.key)}`
    case "pick":
    case "select":
      return `**${b.label}**\n\nOptions: ${"options" in b && b.options ? (b.options as any[]).map((o) => (typeof o === "string" ? o : `${o.group}: ${o.items.join(", ")}`)).join("; ") : "from earlier answers"}\n\nAnswer: ${answerLine(answers, b.key)}${stamp(answers, b.key)}`
    case "quiz": {
      const g = gradeAnswer(b, vals[b.key])
      return [
        `**Knowledge check${b.number != null ? ` ${b.number}` : ""}:** ${b.question}`,
        b.options.map((o) => `- ${o}${b.correct.includes(o) ? " (correct)" : ""}`).join("\n"),
        `Student's first answer: ${answerLine(answers, b.key)}${stamp(answers, b.key)}${g ? ` **${g === "correct" ? "Correct" : "Incorrect"}**` : ""}`,
        `Explanation shown after answering: ${b.explanation}`,
      ].join("\n\n")
    }
    case "numeric": {
      const g = gradeAnswer(b, vals[b.key])
      return [
        `**Math${b.number != null ? ` ${b.number}` : ""}:** ${b.question}`,
        `Student's first answer: ${answerLine(answers, b.key)}${stamp(answers, b.key)}${g ? ` **${g === "correct" ? "Correct" : "Incorrect"}**` : ""}`,
        `Correct answer: ${b.prefix ?? ""}${b.answer.toLocaleString("en-US")}${b.suffix ?? ""}`,
        `Worked solution shown after answering: ${b.explanation}`,
      ].join("\n\n")
    }
    case "drill": {
      const [k, kSecs] = drillKeys(b)
      const spoke = answers[kSecs]?.value
      return [
        `**Timed drill${b.number != null ? ` ${b.number}` : ""}${b.title ? `: ${b.title}` : ""}**`,
        `Question: ${b.question}`,
        `Timing given: ${b.prep_seconds} s to think, ${b.speak_seconds} s to speak aloud.`,
        `Seconds the student spoke (timer): ${typeof spoke === "string" && spoke ? `${spoke} s` : MISSING("timer not used")}`,
        `${b.write_label} (first submission, locked):\n\n${quote(answerLine(answers, k))}${stamp(answers, k)}`,
        `Model answer shown after submitting:\n\n${quote(b.model)}`,
        ...(b.check ? [`Self-check, "${b.check.question}": ${answerLine(answers, `${b.key}.check`)}`] : []),
      ].join("\n\n")
    }
    case "sort":
      return [
        `**Sorting${b.title ? `: ${b.title}` : ""}**${b.prompt ? `\n\n${b.prompt}` : ""}`,
        b.items.map((it, i) => `- ${it.text}: student put **${answerLine(answers, `${b.key}.${i + 1}`)}**; sample: ${it.category}`).join("\n"),
      ].join("\n\n")
    case "reveal": return `_Example shown to the student after answering (${b.title}):_\n\n${quote(b.body)}`
    case "star": return `**${b.title}:** ${b.question}\n\n${STAR_PARTS.map((p) => `- ${p.label}: ${answerLine(answers, `${b.key}.${p.part}`)}`).join("\n")}`
    case "scenario": return `**Scenario:** ${b.prompt}\n\n${SCENARIO_PARTS.map((p) => `- ${p.label}: ${answerLine(answers, `${b.key}.${p.part}`)}`).join("\n")}`
    case "story": return `**${b.title ?? "Story"}**${b.question ? `: ${b.question}` : ""}\n\n${blockFieldKeys(b).map((k) => `- ${k.slice(b.key.length + 1)}: ${answerLine(answers, k)}`).join("\n")}`
    case "grid": return `**${b.title ?? "Grid"}**\n\n${blockFieldKeys(b).filter((k) => isFilled(answers[k]?.value)).map((k) => `- ${k}: ${answerLine(answers, k)}`).join("\n") || MISSING("no cells filled")}`
    case "coverage": return ""
  }
  return ""
}

export function workbookMarkdown(input: PackageInput, opts: { coachOnly: boolean } = { coachOnly: true }): string {
  const wb = input.workbook
  if (!wb) return `# Workbook\n\n${MISSING("no workbook is linked to this export")}\n`
  const c = wb.content
  const vals = Object.fromEntries(Object.entries(wb.answers).map(([k, v]) => [k, v.value]))
  const pr = progress(c, vals)
  const lines: string[] = [
    `# Workbook: ${c.title ?? wb.slug}`,
    "",
    `- Student: ${input.student.name} (profile ${input.student.profile_id})`,
    `- Coach: ${input.coach.name}`,
    `- Workbook id: ${wb.id} (slug ${wb.slug})`,
    `- Created: ${fmtTime(wb.created_at)}`,
    `- Status: ${wb.status}${wb.sends.find((s) => s.direction === "to_coach") ? `; sent back by the student ${fmtTime(wb.sends.find((s) => s.direction === "to_coach")!.sent_at)}` : "; not yet sent back by the student"}`,
    `- Completion: ${pr.filled} of ${pr.total} required answers; ${pr.sectionsDone.size} of ${c.sections.length} ${c.section_word === "Module" ? "modules" : "sections"} complete`,
    `- Exported: ${fmtTime(input.generated_at)}`,
    "",
    "Answers are the student's own words, unedited. Knowledge checks, math and drills keep the student's first submission.",
    "",
  ]
  for (const s of c.sections) {
    const done = pr.sectionsDone.has(s.id)
    lines.push(`## ${c.section_word ?? "Section"} ${s.number}: ${s.title}`, "", `_${[s.day, s.minutes, done ? "Complete" : "Not complete"].filter(Boolean).join(" · ")}_`, "")
    for (const b of s.blocks) {
      const md = blockMarkdown(b, wb.answers, opts)
      if (md) lines.push(md, "")
    }
  }
  if (input.round?.def) lines.push(selfAssessmentMarkdown(input), "")
  return lines.join("\n")
}

function selfAssessmentMarkdown(input: PackageInput): string {
  const r = input.round
  if (!r?.def) return ""
  const sa = r.round.self_assessment ?? {}
  return [
    "## Self-assessment (after the practice case)",
    "",
    r.round.self_assessed_at ? `_Last saved ${fmtTime(r.round.self_assessed_at)}_` : MISSING("the student has not started the self-assessment"),
    "",
    ...r.def.self_assessment.map((q, i) => `**${i + 1}. ${q.question}**\n\n${quote((sa[q.key] ?? "").trim() || MISSING("no answer"))}\n`),
  ].join("\n")
}

// ── Practice round ───────────────────────────────────────────────────────

type QRow = {
  n: number; id: string; title: string; text: string; exhibit: string | null; seconds: number; prep: number
  take: PracticeTake | null; takes: number; file: string | null
}

function questionRows(input: PackageInput): QRow[] {
  const r = input.round
  if (!r) return []
  const newest = latestTakes(r.takes)
  return r.round.questions.map((q, i) => {
    const t = newest.get(q.id) ?? null
    const title = q.title ?? `Question ${i + 1}`
    return {
      n: i + 1, id: q.id, title, text: q.text, exhibit: q.exhibit ?? null,
      seconds: answerSecondsFor(q), prep: q.prep_seconds ?? 0,
      take: t, takes: r.takes.filter((x) => x.question_id === q.id).length,
      file: t ? `Recordings/Q${i + 1}_${slug(title)}.${extOf(t.storage_path, t.mime)}` : null,
    }
  })
}

/** Every take's files, newest per question first named plainly, earlier takes suffixed. */
export function recordingRefs(input: PackageInput): RecordingRef[] {
  const r = input.round
  if (!r) return []
  const out: RecordingRef[] = []
  r.round.questions.forEach((q, i) => {
    const title = slug(q.title ?? `question-${i + 1}`)
    const takes = r.takes.filter((t) => t.question_id === q.id).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    takes.forEach((t, j) => {
      const suffix = j === 0 ? "" : `_earlier-take-${takes.length - j}`
      out.push({ path: `Recordings/Q${i + 1}_${title}${suffix}.${extOf(t.storage_path, t.mime)}`, take_id: t.id, kind: t.mime.startsWith("audio") ? "audio" : "video", question: i + 1, storage_path: t.storage_path })
      if (t.audio_path) out.push({ path: `Recordings/Q${i + 1}_${title}${suffix}_audio.${extOf(t.audio_path, "audio/webm")}`, take_id: t.id, kind: "audio", question: i + 1, storage_path: t.audio_path })
    })
  })
  return out
}

function timingLines(q: QRow): string[] {
  const t = q.take
  if (!t) return [`- Recording: ${MISSING("no answer recorded")}`]
  const think = between(t.question_shown_at, t.response_started_at)
  const firstWords = t.first_speech_ms
  return [
    `- Time allowed: ${q.prep ? `${q.prep} s think time, then ` : ""}${q.seconds} s to answer`,
    `- Question shown: ${fmtTime(t.question_shown_at)}`,
    `- Recording started: ${fmtTime(t.response_started_at)}${think != null ? ` (${secs(think)} after the question appeared)` : ""}`,
    `- Recording ended: ${fmtTime(t.response_ended_at ?? null)}`,
    `- Response duration: ${secs(t.duration_ms)}${t.duration_ms != null ? ` of ${q.seconds} s allowed (${Math.round((t.duration_ms / 1000 / q.seconds) * 100)}%)` : ""}`,
    `- First words: ${firstWords != null ? `${secs(firstWords)} into the recording${think != null ? `; ${secs(think + firstWords)} after the question appeared` : ""} (from the transcript's first segment, approximate)` : MISSING("not measurable without a transcript")}`,
    `- Takes recorded: ${q.takes}`,
    `- Recording file: ${q.file ?? MISSING("no file")}`,
  ]
}

function transcriptBlock(t: PracticeTake | null): string {
  if (!t) return MISSING("no answer recorded, so no transcript")
  if (t.transcript_status === "done" && (t.transcript ?? "").trim()) return quote(t.transcript!.trim())
  if (t.transcript_status === "done") return MISSING(`transcript is empty: ${t.transcript_error ?? "no speech detected"}`)
  if (t.transcript_status === "pending") return MISSING("transcript still being produced; regenerate the package in a minute")
  if (t.transcript_status === "failed") return MISSING(`transcription failed: ${t.transcript_error ?? "unknown error"}. Watch the recording.`)
  if (t.transcript_status === "unavailable") return MISSING(`transcript unavailable: ${t.transcript_error ?? "no reason given"}. Watch the recording.`)
  return MISSING("this round type is not transcribed; watch the recording")
}

export function transcriptMarkdown(input: PackageInput): string {
  const r = input.round
  if (!r) return `# Practice transcript\n\n${MISSING("no practice round is linked to this export")}\n`
  const rows = questionRows(input)
  const def = r.def
  const lines = [
    `# Practice transcript: ${r.round.title}`,
    "",
    `- Student: ${input.student.name} (profile ${input.student.profile_id})`,
    `- Round id: ${r.round.id}${r.round.case_id ? `; case ${r.round.case_id}` : ""}`,
    `- Type: ${r.round.kind === "case" ? `case simulation${def ? ` (${CASE_TYPE_LABELS[def.type]}, ${def.difficulty})` : ""}` : "interview practice round"}`,
    `- Status: ${r.round.status}; sent ${fmtTime(r.round.sent_at)}; submitted ${r.round.submitted_at ? fmtTime(r.round.submitted_at) : MISSING("not submitted yet")}`,
    `- Exported: ${fmtTime(input.generated_at)}`,
    "",
    "Transcripts are machine-made (OpenAI Whisper) from the student's audio and are not edited: false starts, repetitions and self-corrections are left in where the model caught them. The recording is the record; the transcript is a reading aid.",
    "",
  ]
  if (r.round.scenario) lines.push("## Case scenario", "", r.round.scenario, "")
  for (const q of rows) {
    lines.push(`## Q${q.n}. ${q.title}`, "", `**Interviewer:** ${q.text}`, "")
    if (q.exhibit) lines.push("**Information shown with this question:**", "", quote(q.exhibit), "")
    lines.push("**Timing**", "", ...timingLines(q), "", "**Student's answer (verbatim transcript)**", "", transcriptBlock(q.take), "")
  }
  return lines.join("\n")
}

// ── Coach feedback ───────────────────────────────────────────────────────

export function hasCoachFeedback(input: PackageInput): boolean {
  const r = input.round
  if (!r) return false
  const rev = r.review ?? {}
  return !!(
    rubricAverage(r.rubric) != null ||
    Object.values(r.rubric ?? {}).some((e) => (e?.note ?? "").trim()) ||
    Object.values(rev).some((v) => String(v ?? "").trim()) ||
    (r.round.fb_overall ?? "").trim() ||
    r.round.questions.some((q) => (q.fb_works ?? "").trim() || (q.fb_fix ?? "").trim())
  )
}

export function coachFeedbackMarkdown(input: PackageInput): string {
  const r = input.round
  const head = [`# Coach feedback`, "", `- Coach: ${input.coach.name}`, `- Exported: ${fmtTime(input.generated_at)}`, "", ...workbookEvaluationMarkdown(input)]
  if (!r) return [...head, MISSING("no practice round is linked, so there is no round feedback"), ""].join("\n")
  if (!hasCoachFeedback(input)) {
    return [...head, "**Status: PENDING.** The coach has not written any feedback on this round yet.", ""].join("\n")
  }
  const rev = r.review ?? {}
  const avg = rubricAverage(r.rubric)
  const lines = [
    ...head,
    `- Rubric last edited: ${fmtTime(r.review_updated_at)}`,
    `- Feedback released to the student: ${r.round.feedback_sent_at ? fmtTime(r.round.feedback_sent_at) : "no (private to the coach)"}`,
    "",
    `## Rubric scores (1 to 5)${avg != null ? `: average ${avg}` : ""}`,
    "",
    "| Dimension | Score | Note |",
    "| --- | --- | --- |",
    ...DIMENSIONS.map((d) => {
      const e = r.rubric?.[d.key]
      return `| ${d.label} | ${e?.score ?? "not scored"} | ${(e?.note ?? "").replace(/\n/g, " ").replace(/\|/g, "/") || ""} |`
    }),
    "",
    "## Overall",
    "",
    `**Strengths:** ${rev.strengths?.trim() || MISSING("not written")}`,
    "",
    `**Development priorities (weaknesses):** ${rev.priorities?.trim() || MISSING("not written")}`,
    "",
    `**Recommended drills and interventions:** ${rev.drills?.trim() || MISSING("not written")}`,
    "",
    `**Final coaching summary:** ${rev.summary?.trim() || MISSING("not written")}`,
    "",
    `**Note to the student (released with feedback):** ${r.round.fb_overall?.trim() || MISSING("not written")}`,
    "",
    "## Question notes",
    "",
  ]
  r.round.questions.forEach((q, i) => {
    lines.push(`**Q${i + 1}. ${q.title ?? q.text.slice(0, 80)}**`, "", `- What works: ${q.fb_works?.trim() || MISSING("not written")}`, `- What to fix: ${q.fb_fix?.trim() || MISSING("not written")}`, "")
  })
  return lines.join("\n")
}

// ── Structured data ──────────────────────────────────────────────────────

export function performanceData(input: PackageInput): Record<string, unknown> {
  const r = input.round
  const wb = input.workbook
  const vals = wb ? Object.fromEntries(Object.entries(wb.answers).map(([k, v]) => [k, v.value])) : {}
  const pr = wb ? progress(wb.content, vals) : null
  return {
    format: "signal-performance-package",
    format_version: 1,
    generated_at: input.generated_at,
    partial: input.partial,
    student: { profile_id: input.student.profile_id, name: input.student.name },
    coach: { profile_id: input.coach.profile_id, name: input.coach.name },
    workbook: wb ? {
      id: wb.id, slug: wb.slug, title: wb.content.title ?? null, status: wb.status,
      completion: { required_answered: pr!.filled, required_total: pr!.total, sections_done: [...pr!.sectionsDone], sections_total: wb.content.sections.length },
      answers: Object.fromEntries(Object.entries(wb.answers).map(([k, v]) => [k, { value: v.value, updated_at: v.updated_at }])),
      graded: wb.content.sections.flatMap((s) => s.blocks).filter((b) => b.type === "quiz" || b.type === "numeric").map((b) => ({
        key: (b as any).key, type: b.type, skill: (b as any).skill ?? null, grade: gradeAnswer(b, vals[(b as any).key]),
      })),
      evaluations: workbookEvaluations(input),
      drills: wb.content.sections.flatMap((s) => s.blocks).filter((b): b is Extract<Block, { type: "drill" }> => b.type === "drill").map((b) => ({
        key: b.key, prep_seconds: b.prep_seconds, speak_seconds: b.speak_seconds,
        spoken_seconds: Number(vals[`${b.key}.secs`]) || null, self_check: vals[`${b.key}.check`] ?? null,
      })),
    } : null,
    round: r ? {
      id: r.round.id, kind: r.round.kind ?? "interview", title: r.round.title, status: r.round.status,
      case: r.def ? { id: r.def.id, title: r.def.title, type: r.def.type, difficulty: r.def.difficulty, industry: r.def.industry, employer_alignment: r.def.employer_alignment ?? null } : null,
      sent_at: r.round.sent_at, submitted_at: r.round.submitted_at,
      questions: questionRows(input).map((q) => ({
        question_id: q.id, qkey: r.round.questions[q.n - 1].qkey ?? null, position: q.n, title: q.title, text: q.text, exhibit: q.exhibit,
        answer_seconds: q.seconds, prep_seconds: q.prep,
        take: q.take ? {
          take_id: q.take.id, recording: q.file, duration_ms: q.take.duration_ms,
          question_shown_at: q.take.question_shown_at ?? null, response_started_at: q.take.response_started_at ?? null,
          response_ended_at: q.take.response_ended_at ?? null,
          think_ms: between(q.take.question_shown_at, q.take.response_started_at),
          first_speech_ms: q.take.first_speech_ms ?? null,
          transcript_status: q.take.transcript_status ?? null, transcript: q.take.transcript ?? null,
        } : null,
        takes: q.takes,
        coach_notes: { works: r.round.questions[q.n - 1].fb_works ?? null, fix: r.round.questions[q.n - 1].fb_fix ?? null },
      })),
      self_assessment: r.def ? r.def.self_assessment.map((q) => ({ key: q.key, question: q.question, answer: r.round.self_assessment?.[q.key] ?? null })) : null,
      rubric: DIMENSIONS.map((d) => ({ dimension: d.key, label: d.label, score: r.rubric?.[d.key]?.score ?? null, note: r.rubric?.[d.key]?.note ?? null })),
      rubric_average: rubricAverage(r.rubric),
      review: r.review ?? null,
      review_updated_at: r.review_updated_at,
      feedback_sent_at: r.round.feedback_sent_at ?? null,
    } : null,
    attempts: input.attempts,
  }
}

// ── ChatGPT review ───────────────────────────────────────────────────────

export function chatgptMarkdown(input: PackageInput): string {
  const r = input.round
  const def = r?.def ?? null
  const lines: string[] = [
    `# Case interview performance review: ${input.student.name}`,
    "",
    "## Instructions for the reviewer",
    "",
    "You are reviewing a student's practice case interview and the preparation workbook that came before it. Please:",
    "",
    "1. Read Part A only. Do NOT read Part B until you have finished your own assessment.",
    "2. Score each of the ten rubric dimensions from 1 to 5 using the anchors given, citing the student's own words as evidence.",
    "3. For each question, say whether any weakness is analytical (the thinking is wrong or missing) or communicative (the thinking is there but slow, buried or long).",
    "4. Name the student's three biggest strengths and three highest-impact improvements, and suggest one drill for each improvement.",
    "5. Use the timing data in context: a long think before a clear, concise answer is not the same problem as a long answer. Transcripts are machine-made from audio; small word errors are the transcriber's, not the student's.",
    "6. Then read Part B and compare your assessment with the coach's. Say where you agree, where you differ, and why.",
    "",
    "---",
    "",
    "# PART A: The case, the student's work, and the assessment criteria",
    "",
  ]
  if (input.workbook) {
    lines.push(`## Student context`, "", `- Student: ${input.student.name}`, `- Preparation workbook: ${input.workbook.content.title ?? input.workbook.slug}`, "")
  }
  if (r) {
    if (def) {
      lines.push(
        "## About the case",
        "",
        `- Case: ${def.title} (${CASE_TYPE_LABELS[def.type]}, ${def.difficulty}, ${def.industry})`,
        ...(def.employer_alignment ? [`- Preparing for: ${def.employer_alignment}`] : []),
        `- Format: interviewer-led, ${def.questions.length} questions in a fixed order, each with its own time limit. The student recorded each answer alone, with no interviewer present, and could not re-take an answer.`,
        "",
      )
    }
    lines.push(transcriptMarkdown(input).replace(/^# .*\n/, "## The practice case, question by question\n"), "")
    if (def) {
      lines.push(
        "## Answer key and what strong answers look like",
        "",
        "Calculations:",
        "",
        ...def.coach.answer_key.map((x) => `- ${x}`),
        "",
        "Qualifications a strong candidate raises:",
        "",
        ...def.coach.qualifications.map((x) => `- ${x}`),
        "",
        ...def.questions.flatMap((q, i) => [
          `**Q${i + 1}. ${q.title}.** Purpose: ${q.coach.purpose}`,
          "",
          ...q.coach.strong.map((x) => `- ${x}`),
          "",
          `Acceptable alternatives: ${q.coach.alternatives.join(" ")}`,
          "",
          `Common errors: ${q.coach.common_errors.join(" ")}`,
          "",
        ]),
      )
      lines.push(selfAssessmentMarkdown(input).replace("## Self-assessment", "## The student's self-assessment"), "")
    }
  }
  lines.push(
    "## Evaluation rubric (1 to 5)",
    "",
    ...DIMENSIONS.flatMap((d) => [`**${d.label}**`, `- 1: ${d.anchors[1]}`, `- 3: ${d.anchors[3]}`, `- 5: ${d.anchors[5]}`, ""]),
  )
  if (input.workbook) {
    lines.push("## The preparation workbook, with the student's answers", "", workbookMarkdown(input, { coachOnly: false }).replace(/^# .*\n/, "").replace(/^## /gm, "### "), "")
  }
  if (input.attempts.length > 1) {
    lines.push(
      "## Other attempts by this student",
      "",
      "Cases of different difficulty are not directly comparable; read any trend with that in mind.",
      "",
      ...input.attempts.map((a) => `- ${a.title} (${a.case_id ?? "interview"}): ${a.status}${a.submitted_at ? `, submitted ${fmtTime(a.submitted_at)}` : ""}${a.rubric_average != null ? `, coach rubric average ${a.rubric_average}` : ""}`),
      "",
    )
  }
  lines.push(
    "---",
    "",
    "# PART B: The coach's assessment",
    "",
    "Read this only after you have written your own assessment above.",
    "",
    coachFeedbackMarkdown(input).replace(/^# .*\n/, ""),
  )
  return lines.join("\n")
}

/** All the text files of a package, in the order a coach would read them. */
export function packageFiles(input: PackageInput): PackageFile[] {
  const files: PackageFile[] = []
  files.push({ path: "Workbook.md", content: workbookMarkdown(input) })
  files.push({ path: "Practice_Transcript.md", content: transcriptMarkdown(input) })
  files.push({ path: "Coach_Feedback.md", content: coachFeedbackMarkdown(input) })
  files.push({ path: "Performance_Data.json", content: JSON.stringify(performanceData(input), null, 2) })
  files.push({ path: "ChatGPT_Review.md", content: chatgptMarkdown(input) })
  return files
}
