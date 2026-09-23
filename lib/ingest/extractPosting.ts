/**
 * Full Phase 2 extractor: one Claude call per posting, every field at once.
 *
 * EVERY FIELD DISTINGUISHES not-stated FROM A VALUE, for the reason years does:
 * a posting that says nothing has decided nothing, and the scorer must not read
 * silence as permission. No ATS surveyed exposes these fields, so the only
 * alternative to extracting them is inventing them.
 *
 * TWO MARKERS, NOT ONE, AND THAT IS DELIBERATE.
 *
 *   numbers, arrays, and CLOSED ENUMS -> the literal string "not_stated"
 *   open string fields                -> null
 *
 * The literal cannot be used on an OPEN string field: z.union([z.string(),
 * z.literal("not_stated")]) collapses to z.string(), so a genuine
 * requirements_summary reading "not_stated" would be indistinguishable from the
 * marker. null is the only value such a field cannot legitimately hold.
 * A closed enum has no such problem - no member can collide with the marker -
 * which is why function and industry use the literal and level, which is still
 * free text, uses null.
 * years_required keeps the literal it was scored with; nothing about its rule
 * or its wire format changes here.
 *
 * NEVER INFER. A Senior title does not state years. A bank hiring an engineer
 * does not state an industry unless it says so. Every field carries its own
 * evidence quote, and an empty quote beside a non-null value is the signal that
 * something was inferred.
 */

import Anthropic from "@anthropic-ai/sdk"
import { APIError, AnthropicError } from "@anthropic-ai/sdk/core/error"
import { z } from "zod"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { YEARS_RULES } from "./extractYears"
import { canonicalTools } from "./canonicalTools"

const NOT_STATED = z.literal("not_stated")

/**
 * THE VOCABULARIES ARE DERIVED FROM THE DATA, not invented.
 *
 * industry collapses the 591 distinct company_industries values in
 * lane_results (188 of which appear exactly once) into a closed set. function
 * collapses the 45 distinct `category` values. Both columns came from
 * hiring.cafe and are the vocabulary the review queue and the coaches already
 * read, so a new taxonomy would have meant retraining the humans as well as the
 * extractor.
 *
 * COLLAPSING IS SAFE IN ONE DIRECTION ONLY, which is why the evidence quote is
 * mandatory beside every enum value: a split can be reintroduced later by
 * re-reading the quotes, but detail never stored cannot be recovered.
 *
 * There is deliberately no "Other". It becomes the bucket everything awkward
 * falls into, and then nobody can tell an unclassifiable posting from a
 * misclassified one. A posting that fits nothing here is "not_stated", which is
 * the honest answer and is visible in the not-stated rate.
 */
const INDUSTRIES = [
  "Financial Services",
  "Banking",
  "Investment Banking & Capital Markets",
  "Investment & Asset Management",
  "Insurance",
  "Real Estate",
  "Construction",
  "Healthcare",
  "Pharmaceuticals & Biotech",
  "Software & Technology",
  "IT Services",
  "Management Consulting",
  "Professional Services",
  "Legal Services",
  "Marketing & Advertising",
  "Media & Publishing",
  "Entertainment",
  "Sports",
  "Social Media",
  "Retail & E-commerce",
  "Consumer Goods",
  "Beauty & Fashion",
  "Manufacturing",
  // Added after Flexport failed all three retries on every run: the model kept
  // emitting a logistics value the enum did not contain, and a value outside a
  // closed set is a hard parse failure, not a wrong answer. The gap was a
  // derivation error - lane_results carries 85 mentions across 19 distinct
  // values here (Logistics 17, Logistics & Supply Chain Services 12,
  // Transportation Infrastructure 9, Public Transportation 8, Trucking &
  // Freight 5, Airports & Aviation Services 5, Airlines, Maritime
  // Transportation, Railroads & Rail Transport, ...), which is 1.5% of all
  // industry mentions and more than several values that were kept.
  "Transportation & Logistics",
  "Energy & Utilities",
  "Higher Education",
  "Government & Public Sector",
] as const

const FUNCTIONS = [
  "Marketing",
  "Finance and Accounting",
  // Added after four near-identical Jane Street commodities roles scattered
  // across Finance and Accounting, Data and Analytics and Research and
  // Development. The set had no member for taking positions in markets, so each
  // posting landed on a different nearest neighbour. Same gap as Account
  // Management, and it fails the quieter way: a wrong answer, not a parse
  // error, so nothing surfaces it except reading the values.
  "Trading",
  "Business Operations",
  "Project and Program Management",
  "Engineering",
  "Sales",
  // Added after the first 20-posting run put Viant's "Sr. Technical Account
  // Manager" under Customer Service: the set had no member for owning a book
  // of existing accounts, so the model took the nearest one. A closed set with
  // no "Other" turns a missing member into a wrong answer rather than a blank,
  // which is why the gap had to be filled rather than tolerated.
  "Account Management",
  "Data and Analytics",
  "Legal and Compliance",
  "Administrative and Clerical",
  "Research and Development",
  "Information Technology",
  "Customer Service",
  "Product Management",
  "Human Resources",
  "Design",
  "Consulting",
  "Supply Chain and Logistics",
  // Kept split rather than collapsed: the distinction between nursing, allied
  // health and advanced practice is the whole question for a healthcare client
  // and cannot be reconstructed from a single "Healthcare Services".
  "Healthcare Services - Allied Health",
  "Healthcare Services - Nursing",
  "Healthcare Services - Advanced Practice",
  "Healthcare Services - Pharmacy",
  "Healthcare Services - Veterinary",
  "Skilled Trades",
  "Education",
] as const

export const INDUSTRY_VALUES = INDUSTRIES
export const FUNCTION_VALUES = FUNCTIONS

export const PostingSchema = z.object({
  // --- years: unchanged rule, unchanged wire format
  years_required: z.union([z.number().int().min(0), NOT_STATED]),
  years_evidence: z.string(),

  // --- compensation. Annualised; a range gives both ends, a single figure
  // gives the same value in both, so "min only" is never silently a range.
  salary_min: z.union([z.number().int().min(0), NOT_STATED]),
  salary_max: z.union([z.number().int().min(0), NOT_STATED]),
  salary_currency: z.string().nullable(),
  salary_evidence: z.string(),

  // --- string fields: null is the marker, see the header
  requirements_summary: z.string().nullable(),
  requirements_evidence: z.string(),

  // At least one tool, or the marker. An empty array would be a third state
  // meaning neither "none mentioned" nor "not stated".
  tools: z.union([z.array(z.string()).min(1), NOT_STATED]),
  tools_evidence: z.string(),

  level: z.string().nullable(),
  level_evidence: z.string(),

  // Closed enums, so the "not_stated" literal is safe here even though these
  // are string fields: no member of the set can collide with it. That puts
  // function and industry on the same marker as years, salary and tools.
  function: z.enum([...FUNCTIONS, "not_stated"]),
  function_evidence: z.string(),

  industry: z.enum([...INDUSTRIES, "not_stated"]),
  industry_evidence: z.string(),
})

export type PostingFields = z.infer<typeof PostingSchema>

export type ExtractUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
  /**
   * How many calls this result cost, including the ones that failed to parse.
   * 1 means the first call parsed.
   *
   * Reported so the retry path is MEASURED rather than assumed. Without it a
   * posting that needed three attempts is indistinguishable from one that
   * needed one, the parse-failure rate is invisible, and there is no way to
   * tell whether retry is carrying the pipeline or has never once fired.
   */
  attempts: number
}

/** claude-opus-5 list price, USD per million tokens. */
const PRICE_IN = 5.0
const PRICE_OUT = 25.0

// Joined out here so the prompt template holds no nested escapes.
const FUNCTION_LIST = FUNCTIONS.join("\n")
const INDUSTRY_LIST = INDUSTRIES.join("\n")

const SYSTEM = `You extract structured fields from a job posting. One posting in, one JSON object out.

THE GOVERNING RULE: never infer a value the posting does not state. For every
field, if the posting does not say it, return the not-stated marker. A plausible
guess is worse than a blank, because a blank can be filled later and a wrong
value cannot be detected later.

Two markers, because an open string field cannot safely use a string marker:
  - years_required, salary_min, salary_max, tools, function, industry -> "not_stated"
  - requirements_summary, salary_currency, level -> null

EVERY ENUM VALUE MUST CARRY ITS EVIDENCE QUOTE. function and industry are
closed sets, which makes a wrong answer look exactly like a right one; the
quote is the only thing that shows which it is. An enum value with an empty
evidence string is a guess and is never acceptable - return "not_stated"
instead.

EVIDENCE. Every field has a matching _evidence field: quote the text you took
the value from, verbatim from the posting. When the value is not stated, the
evidence must be an empty string. Never write evidence you did not read in the
posting.

--- years_required
${YEARS_RULES}

--- salary_min / salary_max / salary_currency
- Annual figures. "$120,000-$150,000" gives min 120000, max 150000.
- A single figure gives the SAME value in both, so a reader can never mistake a
  point salary for the bottom of a range.
- Convert a stated hourly or monthly rate to an annual figure only when the
  posting states the basis (hours per week, or "per month"); otherwise
  "not_stated".
- Do NOT use a figure that is not this role's base pay: equity value, bonus
  targets stated separately, the company's revenue, or a benefits allowance.
- salary_currency is the stated currency code ("USD", "GBP"), or null.

--- requirements_summary
- ONE line, at most 200 characters, in the posting's own terms: what a candidate
  must have. Compress, do not editorialise and do not add anything not stated.
- null when the posting states no requirements at all.

--- tools
- Named software, platforms, languages and systems the posting asks for:
  "Python", "Salesforce", "Figma", "SQL", "AWS".
- Only what is named. Do not expand "modern data stack" into products, and do
  not add tools that a role like this usually uses.
- "not_stated" when none are named.

--- level
- The seniority the posting states, as ONE of: "Intern", "Entry Level",
  "Junior", "Associate", "Mid", "Senior", "Staff", "Lead", "Principal",
  "Manager", "Director", "VP", "Head", "C-level".

- A LEVEL REQUIRES AN EXPLICIT SENIORITY MARKER. These are the markers:
  Intern, Entry Level / Entry-Level, Junior / Jr., Associate, Mid / Mid-Level,
  Senior / Sr., Staff, Lead, Principal, Head of, Chief, VP / Vice President,
  SVP, EVP, C-level titles (CEO, CFO, CTO).

- A FUNCTIONAL TITLE IS NOT A SENIORITY MARKER. Manager, Director, Analyst,
  Engineer, Architect, Coordinator, Specialist, Consultant, Representative,
  Associate when it names the work rather than a rank - these say what the job
  DOES, not how senior it is. On their own they state no level, so:
    "Project Manager"              -> null, no marker
    "Community Manager"            -> null, no marker
    "Compliance Analyst"           -> null, no marker
    "Business Systems Architect"   -> null, no marker
    "Senior Project Manager"       -> "Senior"    (marker present)
    "Staff Program Manager"        -> "Staff"     (marker present)
    "Economic Consulting Senior Associate" -> "Senior"  (marker present)
    "VP of Engineering"            -> "VP"        (marker present)
  Why: "Manager" spans a first-line supervisor and a division head, and
  "Analyst" spans a new graduate and a fifteen-year veteran. Reading either as
  a level assigns a seniority the employer never stated, which is the one thing
  this extractor must never do. A functional title is a FUNCTION signal, and
  function already has its own field.

- When a marker is present, return the MARKER, not the functional word.
  "Senior Project Manager" is "Senior", never "Manager".

- Explicit body wording counts as much as the title: "this is a director-level
  position" states Director. But reporting lines do NOT: "reports to the VP of
  Sales" states the manager's level, not this role's.

- null when no marker appears in the title or the body. Do NOT derive a level
  from years required, from salary, from headcount managed, or from how
  demanding the responsibilities sound.

--- function  (CLOSED SET - return one of these exactly, or "not_stated")
${FUNCTION_LIST}

- The job family the work belongs to. Take it from the title, a stated
  department, or explicit body wording.
- Return the closest member of the set. If the posting's work genuinely fits
  none of them, return "not_stated" - do not force a near-miss. There is no
  "Other" on purpose.
- The Healthcare Services entries are deliberately separate. Use the specific
  one the posting states (a nursing role is Nursing, not Allied Health) and
  "not_stated" if it names healthcare work without saying which.
- Trading vs Finance and Accounting vs Data and Analytics. Trading is taking or
  managing market positions: trading, market making, portfolio management,
  execution, commodities desks. Finance and Accounting is the firm's own money:
  accounting, FP&A, controllership, corporate finance, investment diligence.
  Data and Analytics is building the analysis: pipelines, models, reporting,
  business intelligence. A quantitative researcher who builds models FOR a
  trading desk without taking positions is Data and Analytics; a trader who uses
  models is Trading. When the posting says the role trades, prices or takes
  positions, it is Trading regardless of how analytical the work sounds.
- Sales vs Account Management vs Customer Service. Sales is winning NEW
  business: prospecting, new logos, a quota on new revenue. Account Management
  is owning EXISTING accounts: renewals, retention, growth within a book of
  clients. Customer Service is SUPPORTING users: answering inbound questions,
  troubleshooting, a support queue. A role that both carries a new-business
  quota and owns existing accounts is Sales, because the quota is the harder
  requirement. Use the posting's own words; do not infer from the title alone
  when the body describes the work.

--- industry  (CLOSED SET - return one of these exactly, or "not_stated")
${INDUSTRY_LIST}

- The EMPLOYER's industry, only when the posting states it.
- This is the field most often guessed. A bank hiring a software engineer has
  not stated an industry unless the text says so. Company-description text
  ("we are a leading healthcare technology company") counts as stated; the
  company's NAME does not, and your own knowledge of the employer does not.
- Banking is retail, commercial and corporate banking. Investment Banking &
  Capital Markets is advisory, underwriting, trading and markets work.
- Consumer Goods is food, beverage, household and general CPG. Beauty & Fashion
  is cosmetics, personal care, apparel and luxury.
- Transportation & Logistics covers freight and trucking, shipping and maritime,
  rail, airlines and aviation services, public transit, transportation
  infrastructure, and third-party logistics and supply-chain services. An
  employer that moves goods or people is this, even when it describes itself as
  a technology company that does so.
- Return the closest member. If the employer's stated industry fits none of
  them, return "not_stated" rather than the nearest approximation.`

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic()
  return client
}

/**
 * Thrown when every attempt failed to parse. A caller that sees this must
 * RECORD the posting as failed, not skip it: a silently skipped posting is
 * indistinguishable from one nothing has looked at yet, which is the same
 * three-state confusion the storage schema exists to prevent.
 */
export class ExtractionFailed extends Error {
  constructor(
    readonly attempts: number,
    readonly lastError: unknown,
  ) {
    super(
      "extraction failed after " + attempts + " attempt(s): " +
        ((lastError as any)?.message ?? String(lastError)),
    )
    this.name = "ExtractionFailed"
  }
}

/**
 * A structured-output parse failure, as opposed to a transport or API failure.
 *
 * The SDK throws the BASE AnthropicError for this, with no dedicated subclass:
 *   lib/parser.js -> `throw new AnthropicError("Failed to parse structured output: ...")`
 * Everything that reached the API and came back unhappy is an APIError
 * subclass, so "an AnthropicError that is not an APIError" is exactly the parse
 * case and nothing else.
 *
 * THIS IS THE ONLY CLASS WE RETRY HERE, on purpose. The SDK already retries
 * connection errors, 408, 409, 429 and 5xx on its own (maxRetries, default 2),
 * so retrying APIError here would multiply those out to nine attempts and turn
 * a rate limit into a worse rate limit. Parse failure is the one case the SDK
 * does not cover, because a schema mismatch is not a transport problem.
 */
function isParseFailure(e: unknown): boolean {
  if (e instanceof APIError) return false
  if (e instanceof AnthropicError) return true
  // Our own guard below, for a 200 that carried no parseable block at all.
  return e instanceof Error && e.message === NO_OUTPUT
}

const NO_OUTPUT = "model returned no parseable output"

/** Total attempts: the first call plus two retries. */
const MAX_ATTEMPTS = 3

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function extractPosting(posting: {
  title: string
  company: string
  description: string
}): Promise<{ fields: PostingFields; usage: ExtractUsage }> {
  // Failed attempts still cost money: the model produced output, it just did
  // not satisfy the schema. Counting only the successful call would understate
  // the real cost per posting, so tokens accumulate across attempts.
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await getClient().messages.parse({
        model: "claude-opus-5",
        max_tokens: 4000,
        // NO temperature, and it cannot be added. It was never set here, so
        // every run has used whatever this model does by default. Setting it to
        // 0 was tried and the API rejects it outright:
        //
        //   400 invalid_request_error
        //   "`temperature` is deprecated for this model."
        //   request_id req_011CfDKNZYSG3FGVWNiQ3cQU
        //
        // claude-opus-5 does not accept the parameter in any form, so
        // determinism cannot be bought that way. Run-to-run variance is a
        // property of the model here, not a knob we declined to turn, and the
        // only honest response is to MEASURE it: tests/ingest/extract-stability.ts.
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
        output_config: { format: zodOutputFormat(PostingSchema) },
      })

      const u: any = res.usage ?? {}
      inputTokens += u.input_tokens ?? 0
      outputTokens += u.output_tokens ?? 0
      cacheReadTokens += u.cache_read_input_tokens ?? 0
      cacheWriteTokens += u.cache_creation_input_tokens ?? 0

      const parsed = res.parsed_output
      if (!parsed) throw new Error(NO_OUTPUT)

      // Canonicalized here rather than at the storage boundary so that every
      // caller - the writer, the test harness, the stability check - sees the
      // same names. Leaving it to the writer would mean the measured
      // disagreement rate and the stored data disagreed with each other.
      const fields: PostingFields = Array.isArray(parsed.tools)
        ? { ...parsed, tools: canonicalTools(parsed.tools) as typeof parsed.tools }
        : parsed

      return {
        fields,
        usage: {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          // Cache reads and writes are priced differently; they are reported
          // above so the figure can be refined, but on these calls both are 0.
          costUsd: (inputTokens / 1e6) * PRICE_IN + (outputTokens / 1e6) * PRICE_OUT,
          attempts: attempt,
        },
      }
    } catch (e) {
      lastError = e
      // Anything that is not a parse failure is the caller's problem
      // immediately: a 401 or a 400 will fail identically three times, and
      // burning two more calls on it only delays the real error.
      if (!isParseFailure(e)) throw e
      // A parse failure throws before usage is exposed, so the tokens that
      // attempt burned are not counted anywhere. Stated rather than hidden:
      // the cost per posting reported for a retried posting is a floor.
      if (attempt < MAX_ATTEMPTS) await sleep(400 * attempt)
    }
  }

  throw new ExtractionFailed(MAX_ATTEMPTS, lastError)
}
