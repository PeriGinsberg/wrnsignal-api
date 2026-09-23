/**
 * Years-of-experience extractor.
 *
 * One Claude call per posting. Returns the minimum years of experience the
 * posting requires, or the literal marker "not_stated".
 *
 * ZERO AND not_stated ARE DIFFERENT ANSWERS AND ARE NEVER MERGED. A posting
 * saying "0-2 years of relevant experience" states a requirement of 0: it has
 * decided that no prior experience is needed, and a candidate with none
 * qualifies. A posting that never mentions years has decided nothing, and the
 * scorer must not treat the silence as an open door. lane_results already had
 * this distinction (min_yoe NULL vs 0, carried from hiring.cafe's
 * is_min_..._not_mentioned flag) and losing it here would throw away the one
 * thing no ATS gives us for free.
 *
 * The schema makes the merge impossible rather than merely discouraged: the
 * field is either an integer or the string "not_stated", so there is no value
 * that could be read as both.
 */

import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"

export const YearsSchema = z.object({
  /**
   * The MINIMUM years required, as an integer, or "not_stated".
   * A range ("3-5 years") yields its lower bound.
   */
  years_required: z.union([z.number().int().min(0), z.literal("not_stated")]),
  /**
   * The sentence the answer came from, quoted from the posting. Empty when
   * not_stated. This is not used for scoring; it is what makes a wrong answer
   * diagnosable instead of merely wrong.
   */
  evidence: z.string(),
})

export type YearsResult = z.infer<typeof YearsSchema>

/**
 * The years rules, exported so extractPosting.ts uses the same text rather than
 * a copy that drifts. These are the rules the 49-case set was scored against.
 */
export const YEARS_RULES = `Rules:
- A range means its LOWER bound. "3-5 years" is 3. "5-7+ years" is 5. "0-2 years" is 0.
- "3+ years", "minimum of 3 years", "at least 3 years", "3 or more years", "Three (3) years" are all 3.
- Written-out numbers count. "Four to six years of experience" is 4.
- If the posting requires zero prior experience, that is 0, not "not_stated". An
  explicit "0-2 years", "no experience required", or "entry level, no prior
  experience needed" states a requirement of 0.
- A requirement stated in MONTHS rather than years floors to 0. "Minimum of 6
  months experience" is 0, not "not_stated". Why: years_required is a whole
  number of years, and any requirement under twelve months floors to zero of
  them. The employer did state a requirement, so "not_stated" would be wrong -
  it would say nothing was asked for when something was. And 0 is the truthful
  floor for matching: a candidate with no full year of experience is not
  excluded by a six-month bar. Round down, never up: 18 months is 1, not 2.
- If the posting never states a years figure for the candidate's experience,
  return "not_stated". Do NOT guess a number from the seniority of the title.
- Ignore years that are not about the candidate's required experience: company
  age ("founded 40 years ago"), contract length, visa duration, how long a
  product has existed, or how long the team has been together.
- If several requirements are stated, return the one for the role's core
  experience, not a secondary "X years of Python" sub-requirement, unless that
  is the only figure given.

evidence: quote the sentence you took the answer from, verbatim. Empty string when not_stated.`

const SYSTEM = `You extract the minimum years of professional experience a job posting requires.

Return years_required as an integer, or the string "not_stated".

${YEARS_RULES}`

/** Reused across calls so the client is constructed once. */
let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic()
  return client
}

export async function extractYears(posting: {
  title: string
  company: string
  description: string
}): Promise<YearsResult> {
  const res = await getClient().messages.parse({
    model: "claude-opus-5",
    max_tokens: 2000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content:
          `Title: ${posting.title}\n` +
          `Company: ${posting.company}\n\n` +
          `Description:\n${posting.description}`,
      },
    ],
    output_config: { format: zodOutputFormat(YearsSchema) },
  })

  const parsed = res.parsed_output
  if (!parsed) throw new Error("model returned no parseable output")
  return parsed
}
