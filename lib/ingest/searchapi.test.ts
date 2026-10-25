// Run: npx tsx lib/ingest/searchapi.test.ts
//
// SearchApi Google Jobs mapping (lib/ingest/searchapi.ts), offline. Job shapes
// are taken from real responses captured 2026-10-25 (compare-searchapi.ts),
// trimmed.

import { htmlToText, isNoResultsError, mapSearchApiJob } from "./searchapi"
import { googleJobsAdapter, googleJobsProvider } from "./googleJobs"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}
const now = new Date("2026-10-25T15:00:00Z")

const molson = {
  position: 1,
  title: "Financial Analyst",
  company_name: "Molson Coors",
  location: "Chicago, IL",
  via: "via Careers At MolsonCoors",
  description: "<p><b>Requisition ID: </b>40280 </p><br><p>Cheers to creating an incredible&nbsp;team &amp; more.</p><ul><li>2+ years of analysis</li><li>Excel</li></ul>",
  extensions: ["3 days ago", "Full-time", "Health insurance"],
  detected_extensions: { posted_at: "3 days ago", schedule: "Full-time" },
  apply_link: "https://careers.molsoncoors.com/cz/cs/job/40280/Financial-Analyst",
  apply_links: [
    { source: "roberthalf.com", link: "https://www.roberthalf.com/us/en/job/chicago-il/financial-analyst/01340" },
    { source: "LinkedIn", link: "https://www.linkedin.com/jobs/view/123" },
  ],
  sharing_link: "https://www.google.com/search?ibp=htl;jobs&q=x",
}
const p = mapSearchApiJob(molson, now)
ok("no job id: source_job_id null", p.source_job_id === null)
ok("title, company, location", p.title === "Financial Analyst" && p.company === "Molson Coors" && p.location === "Chicago, IL")
ok("employer link chosen (host names the company)", p.apply_url === "https://careers.molsoncoors.com/cz/cs/job/40280/Financial-Analyst")
ok("posted 3 days ago", p.posted_at === "2026-10-22T15:00:00.000Z")
const raw = p.raw as any
ok("description stripped of HTML", !/<[a-z]/i.test(raw.description) && raw.description.includes("Requisition ID: 40280") && raw.description.includes("incredible team & more."))
ok("list items kept as lines", raw.description.includes("\n- 2+ years of analysis\n- Excel"))
ok("original HTML kept", raw.description_html === molson.description)
ok("via prefix dropped", raw.via === "Careers At MolsonCoors")
ok("sharing_link renamed to share_link", raw.share_link === molson.sharing_link)
ok("provider stamped", raw.provider === "searchapi")
ok("original title kept in raw", raw.title === "Financial Analyst")

// Employer link inside apply_links, by source label, beats Google's main link.
const listed = mapSearchApiJob({ ...molson, company_name: "Robert Half", apply_link: "https://www.indeed.com/viewjob?jk=1" }, now)
ok("own link found in apply_links by source/host", listed.apply_url === "https://www.roberthalf.com/us/en/job/chicago-il/financial-analyst/01340")

// Only apply_link (36 of 141 jobs had no list).
const only = mapSearchApiJob({ ...molson, company_name: "Acme", apply_links: undefined, apply_link: "https://www.ziprecruiter.com/x" }, now)
ok("apply_link alone is used", only.apply_url === "https://www.ziprecruiter.com/x")
const none = mapSearchApiJob({ ...molson, company_name: "Acme", apply_links: undefined, apply_link: undefined }, now)
ok("falls back to the Google share link", none.apply_url === molson.sharing_link)

// Plain-text description is left alone.
const plain = mapSearchApiJob({ ...molson, description: "Plain text, no tags." }, now)
ok("plain description untouched, no html copy", (plain.raw as any).description === "Plain text, no tags." && !("description_html" in (plain.raw as any)))

// Title suffix cleanup is shared with SerpApi.
ok("Google title suffix cut", mapSearchApiJob({ ...molson, title: "Financial Analyst at Molson Coors Chicago, IL" }, now).title === "Financial Analyst")

// No posted age.
ok("no age: posted_at null", mapSearchApiJob({ ...molson, extensions: ["Full-time"], detected_extensions: {} }, now).posted_at === null)

ok("SearchApi's empty-result message is not an error", isNoResultsError("Google Jobs didn't return any results."))
ok("SerpApi's wording also matches", isNoResultsError("Google hasn't returned any results for this query."))
ok("a real error is still an error", !isNoResultsError("Invalid API key.") && !isNoResultsError("Your account has run out of searches."))

ok("entities decoded", htmlToText("&#8217;s &lt;b&gt; &rsquo;") === "’s <b> ’")

// Provider setting.
const prev = process.env.GOOGLE_JOBS_PROVIDER
delete process.env.GOOGLE_JOBS_PROVIDER
ok("provider defaults to searchapi", googleJobsProvider() === "searchapi" && googleJobsAdapter({ apiKey: "x" }).source === "searchapi")
process.env.GOOGLE_JOBS_PROVIDER = "serpapi"
ok("provider can be serpapi", googleJobsAdapter({ apiKey: "x" }).source === "serpapi")
process.env.GOOGLE_JOBS_PROVIDER = "something-else"
ok("unknown provider value means searchapi", googleJobsProvider() === "searchapi")
if (prev === undefined) delete process.env.GOOGLE_JOBS_PROVIDER; else process.env.GOOGLE_JOBS_PROVIDER = prev

console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
if (failures) process.exit(1)
