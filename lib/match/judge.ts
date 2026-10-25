/**
 * Phase 3, second pass: Haiku judges whether a posting that survived the rules
 * fits the client. One call per (client, posting).
 *
 * Returns a 0-100 score, a one-line reason a coach can read in the queue, and a
 * quote from the posting the reason rests on. The quote is what makes a
 * plausible-but-wrong judgment checkable, which is the failure mode BUILD-PLAN
 * warns about for this phase.
 *
 * THE SCORE RANKS, IT DOES NOT HIDE (launch design, decided 2026-10-25): every
 * posting that passes the hard rules is in the client's queue, sorted by score.
 *
 * WHAT THE JUDGE SEES, after the first replay (2026-10-25) showed why it ranked
 * poorly: the client's background (an excerpt of their resume), the coach's
 * stretch rule, and the coach's own recent decisions for this client. Without
 * the background it assumed every client qualified; without the stretch rule it
 * scored roles the coach pushed as "too senior".
 */

import { createHash } from "crypto"
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import type { MatchCriteria } from "./criteria"
import type { MatchPosting } from "./rules"
import { CALL_TIMEOUT_MS } from "../ingest/enrich"

export const JudgeSchema = z.object({
  score: z.number().int().min(0).max(100),
  reason: z.string(),
  evidence: z.string(),
})
export type Judgment = z.infer<typeof JudgeSchema>

const MODEL = "claude-haiku-5-5"
const PRICE = { in: 0.1, out: 0.5 }

const SYSTEM = `You help a career coach decide which job postings to show a client. You get the
client's search criteria and one posting. Score how well the posting fits this
client, 0 to 100, and give a one-line reason.

How the coach uses the score: postings at or above a threshold go into the
client's review queue; the rest are never seen. A good job the client never sees
is the worse mistake. An extra posting costs the coach one click to dismiss.
So when you are unsure whether the coach would want to see it, score it 50 or
above.

What makes a posting a poor fit, from the coach's own dismissal reasons:
  - wrong function: the work is not the kind of role the client targets, even if
    the title shares a word with it ("Marketing Analyst" at a data firm doing
    pure SQL engineering for a brand-marketing client)
  - too senior: it needs clearly more experience or seniority than the client
    has (people management, "Senior", years well above theirs)
  - too junior: clearly below the client's level
  - doesn't meet requirements: a hard requirement the client cannot meet (a
    license, a degree type, a clearance, a specific credential)
  - wrong location: outside where the client will work, when the posting is not
    remote
  - wrong industry: the employer's sector is one the client has ruled out
  - right employer, wrong level
What makes a posting a good fit: the work matches a target role (read the work,
not just the title), the level and timing suit the client's stage, and nothing
in it rules the client out.

STRETCH ROLES. Coaches push stretch roles on purpose. Each of these is a
plausible stretch and must NOT score low on that alone:
  - a role asking up to about 3 years more experience than the client has
  - a senior or manager title when the duties fit the client
  - a credential the client is on track to get (a bar admission for a law
    student, a license normally earned on the job, a degree they are finishing)
Only a hard requirement the client clearly cannot meet counts against a
posting: a credential they are not on track for, a degree in a field they do
not have, experience far beyond theirs, a clearance or citizenship they lack.
Judge the client's experience from their background, not from their title.

THE COACH'S RECENT DECISIONS for this client, when given, show what this coach
pushes and dismisses for this client and why. Weigh them: a posting like ones
the coach dismissed as wrong function should score low; one like a push should
score high. They outrank your own reading of the target roles.

Scoring guide:
  80-100  clearly fits; the coach would push it
  50-79   plausible; worth the coach's look
  20-49   probably not; one clear mismatch
  0-19    clearly not; wrong kind of job or plainly out of reach

reason: one line, at most 140 characters, plain words, naming the deciding
factor ("Entry-level FP&A analyst in Chicago, matches target role and level").
evidence: a short quote from the posting that the reason rests on, verbatim.
Empty only if the reason rests on the posting's absence of something.

Never invent facts about the posting or the client. Judge only what is given.`

export const JUDGE_PROMPT_SHA256 = createHash("sha256").update(SYSTEM).digest("hex")

/** "graduated 2023-05" for a past date or a graduated client; "expected to graduate 2027-05" otherwise. */
export function graduationPhrase(c: Pick<MatchCriteria, "gradDate" | "educationStatus">, today = new Date()): string | null {
  if (!c.gradDate) return c.educationStatus === "graduated" ? "graduated" : null
  const past = c.educationStatus === "graduated" || c.gradDate < today.toISOString().slice(0, 10)
  return `${past ? "graduated" : "expected to graduate"} ${c.gradDate.slice(0, 7)}`
}

export function clientBrief(c: MatchCriteria, today = new Date()): string {
  const lines = [
    `Target roles: ${c.targetRoles.join("; ") || "not given"}`,
    `Stage: ${[c.educationStatus && `education ${c.educationStatus.replace(/_/g, " ")}`, graduationPhrase(c, today), c.timeline && `timeline "${c.timeline}"`].filter(Boolean).join(", ") || "not given"}`,
    c.availableFrom && `Available to start: from ${c.availableFrom}`,
    `Coach's usual ceiling on years a posting asks: ${c.maxYearsRequired ?? "none given"} (a guide, not a limit: see STRETCH ROLES)`,
    `Job type wanted: ${c.jobTypes.join(", ") || "not given"}`,
    `Where: ${c.markets.length ? c.markets.map((m) => m.name).join(", ") + (c.radiusMiles ? ` (within ${c.radiusMiles} miles)` : "") : "anywhere"}${c.remoteOk ? "; remote is fine" : ""}`,
    c.salaryFloor && `Salary floor: ${c.salaryFloor.amount} per ${c.salaryFloor.period}`,
    c.targetIndustries.length && `Target industries: ${c.targetIndustries.join(", ")}`,
    c.excludedIndustries.length && `Industries ruled out: ${c.excludedIndustries.join(", ")}`,
    c.notes && `Coach notes:\n${c.notes}`,
    c.background && `Background (from the client's resume):\n${c.background.slice(0, 4000)}`,
  ]
  return lines.filter(Boolean).join("\n")
}

/** One of the coach's earlier decisions for this client, shown to the judge. */
export type PastDecision = { title: string; company: string; action: "push" | "dismiss"; reason: string | null; note: string | null }

const decisionLine = (d: PastDecision) =>
  `- ${d.action === "push" ? "PUSHED" : `DISMISSED (${[d.reason?.replace(/_/g, " "), d.note].filter(Boolean).join("; ")})`}: ${d.title} | ${d.company}`

export function postingBrief(p: MatchPosting): string {
  const loc = p.remote ? "Remote" : p.locations?.length ? p.locations.map((l) => [l.city, l.state?.toUpperCase(), l.country && l.country !== "US" ? l.country : null].filter(Boolean).join(", ")).join(" | ") : "not stated"
  const years = p.yearsMin === null && p.yearsMax === null ? "not stated"
    : `${p.yearsMin ?? "?"}${p.yearsMax === null ? "+" : p.yearsMax === p.yearsMin ? "" : "-" + p.yearsMax}${p.yearsBasis === "preferred" ? " (preferred)" : ""}`
  const pay = p.salaryLow === null && p.salaryHigh === null ? "not stated" : `${p.salaryLow ?? "?"}-${p.salaryHigh ?? "?"} per ${p.salaryPeriod ?? "unstated period"}`
  return [
    `Title: ${p.title}`,
    `Company: ${p.company}`,
    `Location: ${loc}`,
    `Level: ${p.level ?? "not stated"}`,
    `Years of experience asked: ${years}`,
    `Employment type: ${p.employmentTypes?.join(", ") ?? "not stated"}`,
    `Start: ${p.startType === "date" ? p.startDate : p.startType === "season" ? `${p.startSeason} ${p.startYear}` : p.startType === "immediate" ? "immediately" : "not stated"}`,
    `Pay: ${pay}`,
    (p.graduationFrom || p.graduationTo) && `Graduation window: ${p.graduationFrom ?? "?"} to ${p.graduationTo ?? "?"}`,
    `\nPosting text:\n${p.text.slice(0, 3000)}`,
  ].filter(Boolean).join("\n")
}

let client: Anthropic | null = null

export type JudgeUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number }

export async function judge(
  c: MatchCriteria,
  p: MatchPosting,
  opts: { effort: "low" | "medium"; examples?: PastDecision[]; today?: Date },
): Promise<{ judgment: Judgment; usage: JudgeUsage }> {
  const examples = opts.examples?.length ? `COACH'S RECENT DECISIONS FOR THIS CLIENT\n${opts.examples.map(decisionLine).join("\n")}\n\n` : ""
  client ??= new Anthropic({ timeout: CALL_TIMEOUT_MS })
  let lastError: unknown
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        // Two cached blocks: the rules (shared by every client) and this client
        // (shared by all of their postings). Calls for one client run together.
        system: [
          { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
          { type: "text", text: `CLIENT\n${clientBrief(c, opts.today)}`, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: `${examples}POSTING\n${postingBrief(p)}` }],
        output_config: { format: zodOutputFormat(JudgeSchema), effort: opts.effort } as any,
      })
      const u: any = res.usage ?? {}
      const usage: JudgeUsage = {
        inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0, costUsd: 0,
      }
      usage.costUsd = (usage.inputTokens * PRICE.in + usage.cacheReadTokens * PRICE.in * 0.1 + usage.cacheWriteTokens * PRICE.in * 1.25 + usage.outputTokens * PRICE.out) / 1e6
      const parsed = res.parsed_output as Judgment | null
      if (res.stop_reason === "refusal" || !parsed) throw new Error(`no judgment (stop_reason ${res.stop_reason})`)
      return { judgment: parsed, usage }
    } catch (e) {
      lastError = e
    }
  }
  throw lastError
}
