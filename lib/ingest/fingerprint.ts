/**
 * A TypeScript mirror of the SQL fingerprint, so duplicates can be folded
 * BEFORE a batch is sent.
 *
 * WHY THIS FILE IS A COMPROMISE, stated plainly because the old runner comment
 * said the opposite and was right to:
 *
 *   "The fingerprint comes back from the database rather than being recomputed
 *    here, because a TypeScript mirror of the SQL normalization is a thing that
 *    drifts."
 *
 * That is still true. This file exists anyway because batching forces the
 * question earlier: Postgres rejects an INSERT ... ON CONFLICT that touches the
 * same row twice ("ON CONFLICT DO UPDATE command cannot affect row a second
 * time", SQLSTATE 21000), and it rejects the WHOLE statement, not the duplicate
 * row. Two postings sharing a fingerprint in one batch therefore lose the other
 * 199 rows with them. To batch at all, the fold has to happen before the send,
 * and folding requires knowing the fingerprint before the database computes it.
 *
 * THE DRIFT IS MADE DETECTABLE RATHER THAN ASSUMED AWAY:
 * tests/ingest/fingerprint-parity.ts recomputes every stored posting's
 * fingerprint from its own title, company and location columns and asserts the
 * value matches what Postgres generated. Any edit to either side that changes
 * behaviour fails that test against real data.
 *
 * THE DATABASE REMAINS THE AUTHORITY. This is used only to decide which rows
 * may travel in the same statement. Classification after the write still reads
 * the fingerprint Postgres returned, so a mirror that was somehow wrong would
 * cost a rejected batch, never a wrong count or a merged posting.
 *
 * Mirrors, exactly:
 *   public.ingest_norm_text      (20260918_ingest_schema.sql)
 *   public.ingest_state_code
 *   public.ingest_norm_location
 */

import { createHash } from "crypto"

/**
 * lower -> non-alphanumerics to spaces -> collapse -> trim.
 * "Macy's, Inc." -> "macy s inc"
 */
export function normText(v: string | null | undefined): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** The CASE in ingest_state_code, as a map. Both spellings, same as the SQL. */
const STATES: Record<string, string> = {
  alabama: "al", al: "al", alaska: "ak", ak: "ak", arizona: "az", az: "az",
  arkansas: "ar", ar: "ar", california: "ca", ca: "ca", colorado: "co", co: "co",
  connecticut: "ct", ct: "ct", delaware: "de", de: "de", florida: "fl", fl: "fl",
  georgia: "ga", ga: "ga", hawaii: "hi", hi: "hi", idaho: "id", id: "id",
  illinois: "il", il: "il", indiana: "in", in: "in", iowa: "ia", ia: "ia",
  kansas: "ks", ks: "ks", kentucky: "ky", ky: "ky", louisiana: "la", la: "la",
  maine: "me", me: "me", maryland: "md", md: "md", massachusetts: "ma", ma: "ma",
  michigan: "mi", mi: "mi", minnesota: "mn", mn: "mn", mississippi: "ms", ms: "ms",
  missouri: "mo", mo: "mo", montana: "mt", mt: "mt", nebraska: "ne", ne: "ne",
  nevada: "nv", nv: "nv", "new hampshire": "nh", nh: "nh", "new jersey": "nj", nj: "nj",
  "new mexico": "nm", nm: "nm", "new york": "ny", ny: "ny",
  "north carolina": "nc", nc: "nc", "north dakota": "nd", nd: "nd",
  ohio: "oh", oh: "oh", oklahoma: "ok", ok: "ok", oregon: "or", or: "or",
  pennsylvania: "pa", pa: "pa", "rhode island": "ri", ri: "ri",
  "south carolina": "sc", sc: "sc", "south dakota": "sd", sd: "sd",
  tennessee: "tn", tn: "tn", texas: "tx", tx: "tx", utah: "ut", ut: "ut",
  vermont: "vt", vt: "vt", virginia: "va", va: "va", washington: "wa", wa: "wa",
  "west virginia": "wv", wv: "wv", wisconsin: "wi", wi: "wi", wyoming: "wy", wy: "wy",
  "district of columbia": "dc", dc: "dc", "puerto rico": "pr", pr: "pr",
}

/** NULL in the SQL becomes null here. */
export function stateCode(v: string | null | undefined): string | null {
  return STATES[String(v ?? "").trim().toLowerCase()] ?? null
}

/** The trailing country tokens ingest_norm_location strips, in SQL order. */
const COUNTRIES = new Set([
  "united states", "united states of america", "usa", "u s a", "u.s.a.",
  "us", "u s", "u.s.", "america",
])

/** "New York, NY" and "New York, New York, United States" both -> "new york|ny" */
export function normLocation(v: string | null | undefined): string {
  if (v == null || String(v).trim() === "") return ""

  // "(+3 others)" is a multi-site marker, not a place.
  const cleaned = String(v).trim().toLowerCase()
    .replace(/\(\s*\+?\s*\d+\s+others?\s*\)/g, " ")

  let kept = cleaned.split(",").map((p) => p.trim()).filter((p) => p !== "")
  if (kept.length === 0) return normText(v)

  while (kept.length >= 1 && COUNTRIES.has(kept[kept.length - 1].trim())) kept = kept.slice(0, -1)
  // Stripping the country left nothing, so the country WAS the location.
  if (kept.length === 0) return normText(v)

  const state = stateCode(kept[kept.length - 1])
  if (state !== null) kept = kept.slice(0, -1)

  const city = normText(kept.join(" "))
  if (state === null) return city
  if (city === "") return state
  return city + "|" + state
}

/**
 * The generated column, recomputed:
 *   md5(norm_text(title) || '|' || norm_text(company) || '|' || norm_location(location))
 */
export function fingerprintOf(p: {
  title: string
  company: string
  location: string | null
}): string {
  const s = normText(p.title) + "|" + normText(p.company) + "|" + normLocation(p.location)
  return createHash("md5").update(s, "utf8").digest("hex")
}

/**
 * Keep one posting per fingerprint, in first-seen order.
 *
 * LAST WINS, not first. A later posting in the same board response is the more
 * recently listed copy, and the database's ON CONFLICT DO UPDATE would also
 * have let the last write win. Folding to the first would change what gets
 * stored, not just how many statements it takes.
 *
 * Returns the survivors and how many rows were folded away, which is exactly
 * the intra_run_duplicate count for this batch.
 */
export function foldByFingerprint<T extends { title: string; company: string; location: string | null }>(
  rows: T[],
): { kept: { row: T; fingerprint: string }[]; folded: number } {
  const byFp = new Map<string, { row: T; fingerprint: string }>()
  let folded = 0
  for (const row of rows) {
    const fingerprint = fingerprintOf(row)
    if (byFp.has(fingerprint)) folded++
    byFp.set(fingerprint, { row, fingerprint })
  }
  return { kept: [...byFp.values()], folded }
}
