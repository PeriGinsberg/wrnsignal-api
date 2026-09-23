/**
 * The text predicate, shared by every adapter that has to decide whether a
 * posting matches a pair.
 *
 * LIFTED OUT OF greenhouse.ts, unchanged, when Workday needed the same rule.
 * Workday importing it from the Greenhouse adapter would have made one source
 * depend on another for no reason other than where the code happened to live,
 * and the next source would have had to pick one of them to inherit from.
 *
 * WHY WORKDAY NEEDS IT AT ALL. Workday's searchText does not filter, it RANKS:
 * it accepts the pair's words and returns what it judges related. Measured on
 * dev, a "financial analyst" sweep returned 9,550 postings of which only 3.0%
 * had that phrase in the title and 35.6% had even the word "analyst" -- the
 * rest were things like Phlebotomist, Dietitian Clinical and Versanddisponent
 * (m/w/d). The control cannot catch that: it proves the nonsense term returns
 * zero, which it does, so the filter IS applied. It says nothing about whether
 * the filter is tight.
 *
 * Greenhouse applies this to title-plus-description because it has the
 * description. Workday's list endpoint returns no description at all, so there
 * it is a title-only test. Same predicate either way.
 */

/** lower -> non-alphanumerics to spaces -> collapse -> trim. */
export const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()

/**
 * Whole-word containment on already-normalized text.
 *
 * `needle` may be several words; it then has to appear contiguously and in
 * order. Both sides are padded so the first and last words are bounded too,
 * which is what stops "ip" matching inside "ownership".
 *
 * EXACT. No plural tolerance. See containsPhraseInTitle for where that lives.
 */
export function containsPhrase(hay: string, needle: string): boolean {
  if (needle === "") return false
  return (" " + hay + " ").includes(" " + needle + " ")
}

/**
 * The same test, plus a trailing "s" on the LAST word, FOR TITLES ONLY.
 *
 * WHY IT IS RESTRICTED TO THE TITLE. A pluralised title is a real posting
 * shape: "Staff Attorneys" is an attorney role and should not be invisible to
 * the pair "attorney". A pluralised DESCRIPTION is not the same thing at all --
 * "work with our attorneys" is a sentence about colleagues, not a statement of
 * what the job is.
 *
 * Applying the tolerance to the whole haystack was measured on the 6,026 stored
 * prod postings and recovered 196 postings, of which ZERO had the plural in the
 * title. Every one was a description mention: exactly the scattered-mention
 * noise the phrase fix had just removed. So the tolerance now applies only
 * where it earns its keep.
 *
 * Last word only, because that is where English puts the plural in a job title:
 * "project managers", not "projects manager".
 *
 * One-directional: the TITLE may carry the extra s, never the needle. A pair
 * written as "attorneys" still has to find "attorneys".
 */
export function containsPhraseInTitle(titleHay: string, needle: string): boolean {
  if (needle === "") return false
  const padded = " " + titleHay + " "
  return padded.includes(" " + needle + " ") || padded.includes(" " + needle + "s ")
}
