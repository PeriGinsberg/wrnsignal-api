// lib/briefs/prefill.ts
//
// What a new brief starts with, and what the AI thinks about the rest.
//
// TWO SOURCES, KEPT APART ON PURPOSE.
//
//   prefill      comes from client_profiles. These are values a human entered
//                about this client. They go straight into the form.
//   suggestions  come from an AI read of profile_text, and ONLY for fields the
//                profile left empty. They do NOT go into the form: the UI
//                offers them and the coach accepts or ignores each one.
//
// The distinction is the whole point. A guess that arrives pre-filled is
// indistinguishable from a fact, and the plan gets built against it. A guess
// that arrives as a suggestion has to be looked at before it can do damage.
//
// WHY SO LITTLE COMES FROM THE PROFILE. client_profiles stores target_roles and
// target_locations as prose, and app/api/profile/route.ts parses "Primary
// Roles:" up to "Secondary Roles:" and throws the secondary half away. There is
// no education field, no industries field, and no goals field. So the profile
// can seed the primary roles and the locations, and everything else has to be
// read out of profile_text or typed. That gap is in the backlog, not fixed
// here: fixing the parser changes what every existing profile means.

import type { SupabaseClient } from "@supabase/supabase-js"
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { toList, type ListField, type TextField } from "./model"

export type SuggestableField = ListField | Exclude<TextField, "notes_for_builder">

/** One AI read: what it thinks, and the words it got that from. */
export type Suggestion = {
  field: SuggestableField
  value: string[] | string
  evidence: string
}

export type PrefillResult = {
  /** Straight from client_profiles. Safe to put in the form. */
  values: Partial<Record<SuggestableField, string[] | string>>
  /** Which of those the profile supplied, for the "from the profile" marks. */
  prefilled_fields: SuggestableField[]
  /** For the empty ones. NOT values: the coach confirms each. */
  suggestions: Suggestion[]
  /** Why there are no suggestions, when there are none. Shown, not swallowed. */
  suggestions_error: string | null
}

const BriefReadSchema = z.object({
  primary_roles: z.array(z.string()),
  secondary_roles: z.array(z.string()),
  primary_industries: z.array(z.string()),
  secondary_industries: z.array(z.string()),
  locations: z.array(z.string()),
  education_status: z.string(),
  immediate_goals: z.string(),
  /**
   * Per field, the phrase from the profile that the answer came from. This is
   * not decoration: a suggestion a coach cannot trace is a suggestion they have
   * to re-derive by reading the profile themselves, which is the work the
   * suggestion was meant to save.
   *
   * SPELLED OUT RATHER THAN z.record. A record becomes an open-ended
   * `additionalProperties` schema, and the structured-output format returned
   * it empty every time: the answers were right and every piece of evidence
   * was missing, which is the one failure that makes the suggestions
   * untrustworthy without looking wrong. Seven named keys are representable.
   */
  evidence: z.object({
    primary_roles: z.string(),
    secondary_roles: z.string(),
    primary_industries: z.string(),
    secondary_industries: z.string(),
    locations: z.string(),
    education_status: z.string(),
    immediate_goals: z.string(),
  }),
})

const SYSTEM = `You read a career-coaching client's profile and extract what a networking campaign would target.

Return ONLY what the profile actually says. This is extraction, not advice.

- primary_roles: job titles the client is actively targeting. Titles, not descriptions: "Investment Banking Analyst", not "finance work".
- secondary_roles: titles named as a fallback, a stretch, or a second choice. Empty if the profile makes no such distinction. Never repeat a primary role here.
- primary_industries: industries or sectors the client is targeting, such as "Sports", "Healthcare", "Private Equity".
- secondary_industries: industries named as an alternative or a would-also-consider. Never repeat a primary industry here.
- locations: cities, states, regions, or "Remote". Use what the profile says, not what you infer from an employer's address.
- education_status: the client's current education in one short phrase, such as "Senior at Indiana University, graduating May 2026" or "MBA completed 2021". Empty string if the profile does not say.
- immediate_goals: what the client says they are trying to do next, in one or two sentences, in their terms. Empty string if the profile does not say.

An empty array or an empty string is the correct answer when the profile does not say. Do NOT infer, do not fill a gap with what is typical, and do not restate a job title as an industry.

evidence: an object with one key per field above. Each value quotes, verbatim, the phrase from the profile that the answer came from. Use an empty string only when that field's answer is itself empty. Every non-empty answer must have evidence: if you cannot quote the profile for it, the answer does not belong in the profile's terms and should be empty instead.`

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic()
  return client
}

/** Was this field left empty by the profile, and therefore worth asking about? */
function isEmpty(v: string[] | string | undefined): boolean {
  if (v == null) return true
  return Array.isArray(v) ? v.length === 0 : !String(v).trim()
}

/**
 * Read profile_text for the fields the profile itself did not answer.
 *
 * NEVER THROWS. A brief a coach can fill in by hand is worth more than an error
 * page, so a failure here comes back as `suggestions_error` and the form still
 * opens. The message is kept rather than logged away: "the AI read did not run"
 * is something the coach should see, because otherwise an empty suggestion list
 * reads as "the profile says nothing", which is a different fact.
 */
export async function readProfileForBrief(
  profileText: string,
  wanted: SuggestableField[],
): Promise<{ suggestions: Suggestion[]; error: string | null }> {
  if (!profileText.trim()) return { suggestions: [], error: null }
  if (!wanted.length) return { suggestions: [], error: null }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { suggestions: [], error: "No ANTHROPIC_API_KEY is set, so the profile was not read." }
  }

  try {
    const res = await getClient().messages.parse({
      model: "claude-opus-5",
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: `Profile:\n${profileText.slice(0, 40000)}` }],
      output_config: { format: zodOutputFormat(BriefReadSchema) },
    })

    const parsed = res.parsed_output
    if (!parsed) return { suggestions: [], error: "The profile read came back empty." }

    const out: Suggestion[] = []
    for (const field of wanted) {
      const raw = (parsed as any)[field]
      const value = field === "education_status" || field === "immediate_goals"
        ? String(raw ?? "").trim()
        : toList(raw)
      if (isEmpty(value)) continue
      out.push({ field, value, evidence: String((parsed.evidence as any)?.[field] ?? "") })
    }
    return { suggestions: out, error: null }
  } catch (e: any) {
    return { suggestions: [], error: `The profile read failed: ${e?.message ?? e}` }
  }
}

/**
 * Everything a new brief form needs.
 *
 * `skipAi` exists for the case where the coach is opening the form again on a
 * brief that already has suggestions stored: re-reading the same profile costs
 * a model call and produces the same answer.
 */
export async function buildPrefill(
  db: SupabaseClient,
  clientProfileId: string,
  opts: { skipAi?: boolean } = {},
): Promise<PrefillResult> {
  const { data: profile } = await db.from("client_profiles")
    .select("name, target_roles, target_locations, preferred_locations, profile_text")
    .eq("id", clientProfileId).maybeSingle()

  const values: PrefillResult["values"] = {}
  const prefilled: SuggestableField[] = []

  const roles = toList(profile?.target_roles)
  if (roles.length) { values.primary_roles = roles; prefilled.push("primary_roles") }

  // preferred_locations backs up target_locations: the intake form writes one
  // and the dashboard edit writes the other, and either alone is a real answer.
  const locations = toList(profile?.target_locations ?? profile?.preferred_locations)
  if (locations.length) { values.locations = locations; prefilled.push("locations") }

  const ALL: SuggestableField[] = [
    "primary_roles", "secondary_roles", "primary_industries",
    "secondary_industries", "locations", "education_status", "immediate_goals",
  ]
  const wanted = ALL.filter((f) => !prefilled.includes(f))

  if (opts.skipAi) return { values, prefilled_fields: prefilled, suggestions: [], suggestions_error: null }

  const { suggestions, error } = await readProfileForBrief(profile?.profile_text ?? "", wanted)
  return { values, prefilled_fields: prefilled, suggestions, suggestions_error: error }
}
