// Run: npx tsx lib/ingest/googleJobsPaging.test.ts
//
// Google Jobs paging (lib/ingest/searchapi.ts, lib/ingest/serpapi.ts), offline:
// a later page failing keeps the pages already fetched (2026-10-26: Google
// rejected next_page_token on 10 of 127 pairs and each pair kept nothing).
// global fetch is replaced with canned responses.

import { searchApiAdapter } from "./searchapi"
import { serpApiAdapter } from "./serpapi"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

const job = (n: number) => ({ title: `Analyst ${n}`, company_name: "Acme", location: "Chicago, IL", description: "Two years of analysis.", job_id: `j${n}` })
const PAGE_ERROR = "Google has returned 400 status code meaning malformed request."

function mockFetch(pages: object[]) {
  let i = 0
  globalThis.fetch = (async () => new Response(JSON.stringify(pages[Math.min(i++, pages.length - 1)]), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch
}

const pair = { id: "p", title: "financial analyst", location: "Chicago, IL", campus: false }
const realFetch = globalThis.fetch

;(async () => {
  // SearchApi: next token in pagination.next_page_token
  mockFetch([{ jobs: [job(1), job(2)], pagination: { next_page_token: "t2" } }, { error: PAGE_ERROR }])
  const a = await searchApiAdapter({ apiKey: "x", maxPages: 3 }).fetch(pair, "google_jobs")
  ok("searchapi: page 2 fails, page 1 kept", a.postings.length === 2 && a.requests === 2)
ok("searchapi: attempts never below requests (ingest_runs_attempts_at_least_requests)", a.attempts >= a.requests)
  ok("searchapi: the page error is recorded", (a.detail as any).next_page_error?.includes("400"))

  mockFetch([{ error: PAGE_ERROR }])
  let threw = false
  try { await searchApiAdapter({ apiKey: "x", maxPages: 3 }).fetch(pair, "google_jobs") } catch { threw = true }
  ok("searchapi: page 1 failing still fails the pair", threw)

  mockFetch([{ jobs: [job(1)], pagination: {} }])
  const c = await searchApiAdapter({ apiKey: "x", maxPages: 3 }).fetch(pair, "google_jobs")
  ok("searchapi: no error, no next_page_error", c.postings.length === 1 && !("next_page_error" in (c.detail as any)))

  // SerpApi: jobs_results, next token in serpapi_pagination.next_page_token
  mockFetch([{ jobs_results: [job(1), job(2), job(3)], serpapi_pagination: { next_page_token: "t2" } }, { error: PAGE_ERROR }])
  const s = await serpApiAdapter({ apiKey: "x", maxPages: 3 }).fetch(pair, "google_jobs")
  ok("serpapi: page 2 fails, page 1 kept", s.postings.length === 3 && (s.detail as any).next_page_error?.includes("400"))
ok("serpapi: attempts never below requests", s.attempts >= s.requests)

  globalThis.fetch = realFetch
  console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
  if (failures) process.exit(1)
})()
