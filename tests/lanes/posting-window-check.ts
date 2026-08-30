// Does the board still honour every posting window we offer?
//
//   npx tsx tests/lanes/posting-window-check.ts [query]
//
// The failure this exists to catch does not look like a failure. hiring.cafe
// answers HTTP 200 for a dateFetchedPastNDays it does not recognise, drops the
// date filter, and returns every posting it has ever fetched — so a lane whose
// window has stopped working returns MORE, not fewer, and the queue reads as a
// good week. Nothing in the response says the filter was ignored.
//
// So the assertion is comparative, not absolute: each window must return
// strictly fewer results than "All time", and the windows must narrow in order.
// A token the board drops from its own list fails both.
//
// Hits the live endpoint. Not part of any automated suite — run it after
// touching POSTING_WINDOWS, and when a lane's queue gets suspiciously large.
import { buildSearchState, resolveBuildId } from "../../lib/hiringcafe"
import { POSTING_WINDOWS, postingWindowLabel } from "../../lib/lanePostingWindow"

const ORIGIN = "https://hiringcafe.com"
const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "*/*",
  "accept-language": "en-US,en;q=0.9",
}
const ALL_TIME = -1

async function probe(buildId: string, token: number, query: string) {
  const state = buildSearchState({
    query,
    locations: [],
    radiusMiles: 25,
    postedWithin: token,
    seniority: [],
  })
  const url = `${ORIGIN}/_next/data/${buildId}/index.json?searchState=${encodeURIComponent(
    JSON.stringify(state)
  )}&page=0`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`token ${token}: HTTP ${res.status}`)
  const pp = (await res.json())?.pageProps
  if (pp?.ssrError) throw new Error(`token ${token}: ssrError ${JSON.stringify(pp.ssrError)}`)
  const ages = (pp?.ssrHits || [])
    .map((h: any) => h.v5_processed_job_data?.estimated_publish_date_millis)
    .filter((m: any) => typeof m === "number")
    .map((m: number) => Math.round((Date.now() - m) / 86_400_000))
  return { total: pp?.ssrTotalCount ?? 0, oldest: ages.length ? Math.max(...ages) : null }
}

async function main() {
  const query = process.argv[2] || "operations coordinator"
  const buildId = await resolveBuildId()
  console.log(`buildId ${buildId}   query "${query}"\n`)

  const failures: string[] = []
  const unfiltered = await probe(buildId, ALL_TIME, query)
  console.log(`All time (-1)        ${String(unfiltered.total).padStart(6)} results, oldest ${unfiltered.oldest}d`)

  let previous = 0
  for (const w of POSTING_WINDOWS) {
    await new Promise((r) => setTimeout(r, 400))
    const { total, oldest } = await probe(buildId, w.value, query)
    const notes: string[] = []

    // The one that matters. Equal to the unfiltered count means the board did
    // not recognise the token and ran the search with no date filter at all.
    if (total >= unfiltered.total) notes.push("IGNORED — same as All time")
    if (total < previous) notes.push(`narrower than the window below it (${previous})`)
    // Publish date lags fetch date, so this is a sanity bound on approxDays,
    // not an exact equality.
    if (oldest != null && oldest > w.approxDays) notes.push(`reached back ${oldest}d, approxDays says ${w.approxDays}`)

    console.log(
      `${postingWindowLabel(w.value).padEnd(9)} (${String(w.value).padStart(3)})  ${String(total).padStart(6)} results, oldest ${oldest}d` +
        (notes.length ? `   <-- ${notes.join("; ")}` : "")
    )
    if (notes.length) failures.push(`${postingWindowLabel(w.value)} (${w.value}): ${notes.join("; ")}`)
    previous = total
  }

  if (failures.length) {
    console.log(`\n${failures.length} window(s) the board is not honouring:`)
    for (const f of failures) console.log(`  ${f}`)
    console.log(`\nRe-read the Date Posted list out of the board's bundle before changing a number:`)
    console.log(`  the \`ls\` array in the chunk that mentions "dateFetchedPastNDays" and "Date Posted".`)
    process.exit(1)
  }
  console.log("\nall windows honoured, narrowing in order")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
