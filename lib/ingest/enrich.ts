/**
 * Phase 2 enrichment: one Claude call per posting, every field the review queue
 * and the matcher need, with the model as a parameter so a cheaper one can be
 * measured against a stronger one on the same postings.
 *
 * Differences from extractPosting.ts (the Greenhouse-era extractor, still what
 * enrichPostings.ts writes to the postings columns):
 *   - years as a RANGE: years_min and years_max, each an integer or
 *     "not_stated". "3+ years" is min 3, max not_stated; "0-2 years" is 0 and 2.
 *     Zero and not_stated stay distinct, as BRIEF.md requires.
 *   - graduation window, application deadline and a cleaned title, which the
 *     Google Jobs postings carry and the ATS boards mostly did not.
 *   - salary as stated (low, high, period), not annualised: an hourly rate is
 *     kept hourly rather than converted on an assumed schedule.
 *   - level, function, industry, tools and the summary use extractPosting.ts's
 *     rules word for word (exported from there), so the two cannot drift.
 *
 * NOTHING HERE WRITES. It returns fields and usage; storage is a later step.
 *
 * NEVER INFER. Every field has an evidence quote; an empty quote beside a value
 * means the value was not read from the posting.
 */

import { createHash } from "crypto"
import Anthropic from "@anthropic-ai/sdk"
import { APIError, AnthropicError } from "@anthropic-ai/sdk/core/error"
import { z } from "zod"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import {
  FUNCTION_RULES, FUNCTION_VALUES, INDUSTRY_RULES, INDUSTRY_VALUES, LEVEL_RULES, SUMMARY_RULES, TOOLS_RULES,
} from "./extractPosting"
import { canonicalTools } from "./canonicalTools"

const NOT_STATED = z.literal("not_stated")
const YEARS = z.union([z.number().int().min(0), NOT_STATED])
const MONEY = z.union([z.number().min(0), NOT_STATED])

export const EnrichSchema = z.object({
  cleaned_title: z.string(),

  years_min: YEARS,
  years_max: YEARS,
  // Whether the figure is a requirement or only a preference.
  years_basis: z.enum(["required", "preferred", "not_stated"]),
  years_evidence: z.string(),

  graduation_from: z.string().nullable(),
  graduation_to: z.string().nullable(),
  graduation_evidence: z.string(),

  salary_low: MONEY,
  salary_high: MONEY,
  salary_period: z.enum(["year", "month", "week", "day", "hour", "not_stated"]),
  salary_currency: z.string().nullable(),
  salary_evidence: z.string(),

  requirements_summary: z.string().nullable(),

  tools: z.union([z.array(z.string()).min(1), NOT_STATED]),
  tools_evidence: z.string(),

  level: z.string().nullable(),
  level_evidence: z.string(),

  function: z.enum([...FUNCTION_VALUES, "not_stated"]),
  function_evidence: z.string(),

  industry: z.enum([...INDUSTRY_VALUES, "not_stated"]),
  industry_evidence: z.string(),

  application_deadline: z.string().nullable(),
  deadline_evidence: z.string(),

  // Added 2026-10-25 after the coach review of Alex's queue: start timing was
  // the deciding gap.
  employment_types: z.union([z.array(z.enum(["full_time", "part_time", "internship", "contract", "temporary", "seasonal"])).min(1), NOT_STATED]),
  employment_evidence: z.string(),

  start_type: z.enum(["date", "season", "immediate", "not_stated"]),
  start_date: z.string().nullable(),
  start_season: z.enum(["spring", "summer", "fall", "winter"]).nullable(),
  start_year: z.number().int().nullable(),
  start_evidence: z.string(),
})

export type EnrichFields = z.infer<typeof EnrichSchema>

export const ENRICH_MODELS = {
  haiku: "claude-haiku-5-5",
  sonnet: "claude-sonnet-5-5",
} as const
export type EnrichModel = (typeof ENRICH_MODELS)[keyof typeof ENRICH_MODELS]

/**
 * USD per million tokens, list price (claude-api skill model table, 2026-10).
 * Cache reads at 0.1x and 5-minute cache writes at 1.25x of the input price.
 * Haiku's figures hold for prompts up to 100K tokens; one posting is far below.
 */
const PRICES: Record<EnrichModel, { in: number; out: number }> = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
  "claude-sonnet-5-5": { in: 2.0, out: 10.0 },
}

export const YEARS_RANGE_RULES = `- years_min / years_max are the years of professional experience the posting asks
  of the candidate, as whole numbers, or "not_stated".
- A range gives both ends: "3-5 years" is min 3, max 5. "0-2 years" is min 0, max 2.
- An open floor gives the minimum only: "3+ years", "at least 3 years", "minimum of
  3 years", "3 or more years", "3 years of experience" are min 3, max "not_stated".
- A ceiling gives max with min 0: "up to 2 years", "less than 2 years", "no more
  than 2 years" are min 0, max 2.
- Written-out numbers count: "Four to six years" is 4 and 6. "Three (3) years" is 3.
- ZERO IS NOT not_stated. "No experience required", "0 years", "no prior
  experience needed" state a requirement of 0: min 0, max 0. A posting that never
  states a figure is "not_stated" for both.
- Months round DOWN to whole years: "6 months" is 0, "18 months" is 1.
- Do NOT derive years from the title, the level, "entry level", "recent graduate",
  internship status or salary. Only a stated figure counts.
- Ignore years that are not the candidate's experience: company age, contract or
  program length, graduation years, visa duration, how long a product or team
  has existed.
- When alternatives depend on education ("Bachelor's and 4 years, or Master's and
  2 years"), use the Bachelor's path.
- When several figures are stated, use the one for the role's core experience,
  not a sub-skill ("2 years of SQL"), unless that is the only figure.
- years_basis: "required" when the figure is a requirement, "preferred" when the
  ONLY figure is preferred / a plus / desired, "not_stated" when there is none.
  When both appear ("3 years required, 5 preferred") use the required one.
- A figure offered as one alternative to something that needs no work
  experience is NOT required: "internship experience and/or 1+ years of work
  experience" or "1+ years ... considered" can be met with no years at all, so
  keep the figure and set years_basis "preferred".
- years_evidence: the sentence the figure came from, verbatim. Empty when not stated.`

const SYSTEM = `You extract structured fields from a job posting. One posting in, one JSON object out.

THE GOVERNING RULE: never infer a value the posting does not state. If the posting
does not say it, return the not-stated marker. A plausible guess is worse than a
blank, because a blank can be filled later and a wrong value cannot be detected.

Markers: numbers, arrays and closed enums use the string "not_stated"; open string
fields use null.

EVIDENCE: every _evidence field quotes the text the value came from, verbatim from
the posting. Empty string when the value is not stated. Never write evidence you
did not read in the posting.

--- cleaned_title
- The job title with noise removed: employer name, location, requisition or job
  IDs, work arrangement ("Remote", "Hybrid"), schedule ("Full-Time"), pay, and
  marketing ("Join our team!").
- Keep everything that describes the job: seniority, function, specialty, level
  numerals ("II"), and program words ("2027 Summer Analyst").
- Never add or reword. If nothing needs removing, return the title unchanged.

--- years_min / years_max / years_basis
${YEARS_RANGE_RULES}

--- graduation_from / graduation_to
- Only when the posting states a window of graduation dates the candidate must
  fall in: "Class of 2027" is 2027 and 2027; "graduating between December 2026
  and June 2027" is 2026-12 and 2027-06; "graduating in Spring 2027" is 2027-03
  and 2027-06.
- Format "YYYY" or "YYYY-MM". An open end is null: "graduated after May 2024" is
  from 2024-05, to null.
- A relative window ("within the last 12 months", "recent graduate") gives null
  for both, with the phrase quoted in graduation_evidence.
- null for both, empty evidence, when no graduation timing is stated.

--- salary_low / salary_high / salary_period / salary_currency
- The base pay the posting states for this role, AS STATED: do not convert an
  hourly rate to a yearly one. "$70,000-$85,000 per year" is 70000, 85000, "year".
  "$24/hr" is 24, 24, "hour".
- A single EXACT figure ("$90,000 per year") gives the same value in both.
- A ONE-SIDED figure gives only the end it states. Never fill in the other end:
  "from $90,000", "starting at $90,000", "minimum $90,000", "$90,000+" are
  low 90000, high "not_stated". "Up to $120,000", "maximum $120,000", "no more
  than $120,000" are low "not_stated", high 120000.
- A range with no stated period: use "year" only for figures of 1,000 or more
  that are plainly annual; otherwise "not_stated" for the period.
- Not base pay, and ignored: bonus or commission targets stated separately,
  equity, benefits allowances, the company's revenue.
- salary_currency is the code ("USD"), or null.
- "not_stated" for low, high and period when no pay is stated.

--- requirements_summary
${SUMMARY_RULES}

--- tools
${TOOLS_RULES}

--- level
${LEVEL_RULES}

--- function  (CLOSED SET - return one of these exactly, or "not_stated")
${FUNCTION_RULES}

--- industry  (CLOSED SET - return one of these exactly, or "not_stated")
${INDUSTRY_RULES}

--- application_deadline
- The last date to apply, when the posting states one, as "YYYY-MM-DD".
- When the posting states a deadline without a full date ("apply by March 1"
  with no year), return null and quote it in deadline_evidence.
- Not a deadline: start dates, "posted" dates, interview dates, and "applications
  reviewed on a rolling basis".
- Not a deadline either: a date the posting stays open AT LEAST until ("accepting
  applications until 7/7/2026 at a minimum", "open until at least March 1").
  That is the earliest it might close, not the last day to apply: null, and
  empty evidence.
- null and empty evidence when none is stated.

--- employment_types
- Every employment type the posting states, from: full_time, part_time,
  internship, contract, temporary, seasonal.
- Stated means the words are there: "Full-time", "Part-time", "Intern",
  "Internship", "Summer Analyst program" described as an internship, "Contract",
  "Temp", "Seasonal". A posting can state more than one ("summer internship,
  40 hours a week, full-time" is internship and full_time).
- Do not infer an internship from a student audience, or full-time from a
  salary. The company's name never states a type ("Walleye Capital Full Time"
  is a name). "not_stated" when no type is named.
- A "Listed job type:" line is the job board's label for the posting and counts
  as stated. When the description says otherwise (a summer internship listed as
  "Full-time"), the description wins.
- employment_evidence: the words you took it from, verbatim.

--- start_type / start_date / start_season / start_year
- When the job starts, as the posting states it. One of:
    "date"      a specific date or month: start_date "YYYY-MM-DD". A month alone
                is its 1st ("starting July 2027" -> 2027-07-01). A date range
                ("June 8 - August 14, 2027") starts on its first day.
    "season"    a season or term and a year, no date: start_season (spring,
                summer, fall, winter) and start_year ("Summer 2027 internship",
                "Fall 2026 start", "spring semester 2027"). Treat autumn as fall.
    "immediate" "immediately", "ASAP", "immediate start", "start right away",
                "urgently hiring to start now".
    "not_stated" anything else, including no start mentioned at all.
- Only the job's start. NOT a start: the application deadline, the posting
  date, the graduation date asked of candidates, an interview date, or when
  applications open.
- "Summer 2027 Analyst" in a title states season summer 2027. "2027 Analyst
  Program" alone does not state a season or date: a year is not a start.
- Unused parts are null: a season has no start_date, a date has no season.
- start_evidence: the words you took it from, verbatim. Empty when not_stated.`

/** Recorded on every enrichment_runs row, so a prompt change shows in the data. */
export const ENRICH_PROMPT_SHA256 = createHash("sha256").update(SYSTEM).digest("hex")

/** The production model (decided 2026-10-25). */
export const DEFAULT_ENRICH_MODEL: EnrichModel = ENRICH_MODELS.haiku

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic()
  return client
}

export type EnrichUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  /** API calls this result took, including ones that failed to parse. */
  attempts: number
}

export class EnrichFailed extends Error {
  constructor(readonly attempts: number, readonly usage: EnrichUsage, readonly lastError: unknown) {
    super(`enrichment failed after ${attempts} attempt(s): ${(lastError as any)?.message ?? String(lastError)}`)
    this.name = "EnrichFailed"
  }
}

const MAX_ATTEMPTS = 2

/** Retry only a schema parse failure; the SDK already retries transport errors. */
const isParseFailure = (e: unknown) =>
  !(e instanceof APIError) && (e instanceof AnthropicError || (e instanceof Error && e.message.startsWith("no parseable output")))

export async function enrichPosting(
  posting: { title: string; company: string; location: string | null; description: string },
  opts: { model: EnrichModel; effort?: "low" | "medium" | "high" },
): Promise<{ fields: EnrichFields; usage: EnrichUsage }> {
  const price = PRICES[opts.model]
  const usage: EnrichUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, attempts: 0 }
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    usage.attempts = attempt
    try {
      const res = await getClient().messages.parse({
        model: opts.model,
        max_tokens: 16000,
        // The rules are identical on every call, so they are cached: after the
        // first posting only the posting itself is billed at the full input rate.
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{
          role: "user",
          content:
            `Title: ${posting.title}\n` +
            `Company: ${posting.company}\n` +
            `Location: ${posting.location ?? "not given"}\n\n` +
            `Description:\n${posting.description}`,
        }],
        output_config: { format: zodOutputFormat(EnrichSchema), effort: opts.effort ?? "medium" } as any,
      })

      const u: any = res.usage ?? {}
      usage.inputTokens += u.input_tokens ?? 0
      usage.outputTokens += u.output_tokens ?? 0
      usage.cacheReadTokens += u.cache_read_input_tokens ?? 0
      usage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0
      usage.costUsd =
        (usage.inputTokens * price.in + usage.cacheReadTokens * price.in * 0.1 +
          usage.cacheWriteTokens * price.in * 1.25 + usage.outputTokens * price.out) / 1e6

      // A refusal or a truncated answer is not something a retry fixes.
      if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") {
        throw new EnrichFailed(attempt, usage, new Error(`stop_reason ${res.stop_reason}`))
      }
      // Typed here because the effort cast above hides the schema from parse().
      const parsed = res.parsed_output as EnrichFields | null
      if (!parsed) throw new Error("no parseable output")

      const fields: EnrichFields = Array.isArray(parsed.tools)
        ? { ...parsed, tools: canonicalTools(parsed.tools) as typeof parsed.tools }
        : parsed
      return { fields, usage }
    } catch (e) {
      if (e instanceof EnrichFailed) throw e
      lastError = e
      if (!isParseFailure(e)) throw e
    }
  }
  throw new EnrichFailed(MAX_ATTEMPTS, usage, lastError)
}
