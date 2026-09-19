/**
 * How much does title-only matching miss?
 *
 * The Greenhouse adapter filters locally on TITLE TOKENS, because the board
 * endpoint omits job content unless ?content=true is passed and pulling every
 * description on every board is expensive. SmartRecruiters' `q` searches the
 * whole posting. So the two sources are not looking at the same text, and
 * their counts are not comparable.
 *
 * This measures that gap: same boards, same pair, filtered two ways.
 *
 * READ-ONLY. Touches no database. One request per board, with content.
 *
 *   npx tsx tests/ingest/measure-recall-gap.ts
 *   npx tsx tests/ingest/measure-recall-gap.ts --title analyst --city "New York"
 */

import { board, matches, norm, cityOf, type GhJob } from "../../lib/ingest/greenhouse"

const ORGS = ["capco", "point72", "janestreet", "mediabrands", "scaleai"]

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf("--" + name)
  const next = process.argv[i + 1]
  return i >= 0 && next && !next.startsWith("--") ? next : fallback
}

/** Greenhouse returns `content` as HTML-escaped markup. */
function plainText(content: unknown): string {
  let s = String(content ?? "")
  s = s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
  return s.replace(/<[^>]*>/g, " ")
}

/**
 * The title-plus-text variant: the same token rule, applied to title AND
 * description rather than title alone. Location handling is unchanged so the
 * only variable is the text being searched.
 */
function matchesWithText(job: GhJob, title: string, city: string | null): boolean {
  const hay = norm(job.title + " " + plainText((job as any).content))
  for (const tok of norm(title).split(" ").filter(Boolean)) {
    if (!hay.includes(tok)) return false
  }
  if (!city) return true
  return norm(job.location?.name).includes(norm(city))
}

;(async () => {
  const title = arg("title", "analyst")
  const city = arg("city", "New York")
  const cityKey = cityOf(city)

  console.log("recall gap: title-only vs title+description")
  console.log("  pair   : " + JSON.stringify(title) + " @ " + JSON.stringify(city))
  console.log("  boards : " + ORGS.join(", ") + "\n")

  console.log("  " + "board".padEnd(14) + "unfiltered".padStart(11) + "title-only".padStart(12) + "title+text".padStart(12) + "extra".padStart(8))

  const extras: { org: string; job: GhJob }[] = []
  let tUn = 0, tTitle = 0, tText = 0

  for (const org of ORGS) {
    const jobs = await board(org, true)
    // Location filter first, so "extra" means "the text found it", not
    // "it is in a different city".
    const titleHits = jobs.filter((j) => matches(j, title, cityKey))
    const textHits = jobs.filter((j) => matchesWithText(j, title, cityKey))
    const titleIds = new Set(titleHits.map((j) => j.id))
    const only = textHits.filter((j) => !titleIds.has(j.id))
    for (const j of only) extras.push({ org, job: j })

    tUn += jobs.length
    tTitle += titleHits.length
    tText += textHits.length
    console.log(
      "  " + org.padEnd(14) + String(jobs.length).padStart(11) + String(titleHits.length).padStart(12) +
      String(textHits.length).padStart(12) + String(only.length).padStart(8)
    )
    await new Promise((r) => setTimeout(r, 600))
  }

  console.log(
    "  " + "TOTAL".padEnd(14) + String(tUn).padStart(11) + String(tTitle).padStart(12) +
    String(tText).padStart(12) + String(extras.length).padStart(8)
  )
  const mult = tTitle > 0 ? (tText / tTitle).toFixed(1) : "n/a"
  console.log("\n  title+text finds " + mult + "x what title-only finds" +
    (tText > 0 ? "   (title-only recall: " + Math.round((tTitle / tText) * 100) + "% of the text match)" : ""))

  console.log("\n\n=== POSTINGS THE TEXT MATCH CAUGHT AND THE TITLE MATCH MISSED (" + extras.length + ") ===\n")
  if (!extras.length) console.log("  (none)")
  for (const { org, job } of extras) {
    console.log("  " + org.padEnd(13) + String(job.title).slice(0, 56).padEnd(58) + String(job.location?.name ?? "").slice(0, 34))
  }
})().catch((e) => {
  console.error("\nFAILED: " + e.message)
  process.exit(1)
})
