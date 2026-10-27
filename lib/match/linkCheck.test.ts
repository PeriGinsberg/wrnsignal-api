// Run: npx tsx lib/match/linkCheck.test.ts
//
// The apply-link verdict (lib/match/linkCheck.ts), offline. Closed only when
// the page says so; a bot wall or an error is unknown, never closed.

import { classifyPage, fetchUrlFor, postingVerdict, type LinkVerdict } from "./linkCheck"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}
const page = (body: string) => `<html><head><title>Job</title><script>var s = "no longer accepting applications"</script></head><body>${body}</body></html>`
const v = (status: number | null, body: string) => classifyPage(status, page(body))

ok("LinkedIn: no longer accepting applications", v(200, "<span>No longer accepting applications</span>").status === "closed")
ok("Indeed: this job has expired", v(200, "<p>This job has expired on Indeed</p>").status === "closed")
ok("position has been filled", v(200, "<div>We're sorry, the position has been filled.</div>").status === "closed")
ok("this posting is closed", v(200, "<h2>This posting is closed</h2>").status === "closed")
ok("job is no longer available", v(200, "<p>Sorry, this job is no longer available.</p>").status === "closed")
ok("applications are closed", v(200, "<p>Applications for this role are now closed</p>").status === "closed")
ok("closed keeps the words as evidence", v(200, "<p>Sorry, this job is no longer available.</p>").evidence.includes("this job is no longer available"))

ok("an open job page is open", v(200, "<h1>Analyst</h1><p>Apply now. 2+ years of experience.</p>").status === "open")
ok("a phrase only inside a script does not close", v(200, "<h1>Analyst</h1>").status === "open")
ok("'no longer available' about something else does not close", v(200, "<p>This feature is no longer available in your browser.</p>").status === "open")

ok("captcha page is unknown, never closed", v(200, "<p>Please complete the captcha. This job has expired</p>").status === "unknown")
ok("Cloudflare 'Just a moment...' is unknown", v(503, "<p>Just a moment...</p>").status === "unknown")
ok("403 is unknown", v(403, "<p>Forbidden</p>").status === "unknown")
ok("429 is unknown", v(429, "").status === "unknown")
ok("LinkedIn 999 is unknown", v(999, "").status === "unknown")
ok("404 is unknown, not closed", v(404, "<p>Page not found</p>").status === "unknown")
ok("410 is unknown, not closed", v(410, "").status === "unknown")
ok("a captcha widget on a job page is not a wall", classifyPage(200, "<html><body><h1>Analyst</h1><div data-x=\"recaptcha_enabled\"></div><script src=\"https://www.google.com/recaptcha/api.js\"></script></body></html>").status === "open")
ok("LinkedIn job page -> its public job endpoint", fetchUrlFor("https://www.linkedin.com/jobs/view/fall-2027-advisory-associate-at-brg-4447192463?utm_campaign=x") === "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4447192463")
ok("other links are fetched as they are", fetchUrlFor("https://www.wayfair.com/careers/job/commercial-analyst/2-10074") === "https://www.wayfair.com/careers/job/commercial-analyst/2-10074")
ok("no response is unknown", classifyPage(null, "").status === "unknown")

// Daniel's review (2026-10-27). #3 Wayfair Commercial Analyst: the employer page
// is the generic "no longer active" page an unknown job id also gets (an open
// Wayfair job page does not carry the phrase).
ok("Daniel #3 Wayfair: 'This job is no longer active' is closed", v(200, "<p>Loading</p><p>This job is no longer active. Please search for another job below.</p>").status === "closed")
// #1 and #5 Deloitte (closed per the coach): the client's link is ZipRecruiter
// behind Cloudflare, so that link alone stays unknown.
ok("Daniel #1/#5 Deloitte: ZipRecruiter's Cloudflare 403 is unknown, never closed", v(403, "<p>Just a moment...</p>").status === "unknown")
ok("a 404 or 410 is gone; a wall or a 500 is not", v(410, "").gone === true && v(404, "<p>Not found</p>").gone === true && !v(403, "<p>Just a moment...</p>").gone && !v(500, "").gone)

// The posting verdict across its links (the client's link, then its other apply links).
const L = (url: string, status: number | null, body = ""): { url: string; v: LinkVerdict } => ({ url, v: v(status, body) })
const wall = (url: string) => L(url, 403, "<p>Just a moment...</p>")
// Daniel #1 Deloitte Chicago: ZipRecruiter and Monster walled, the one answering link 410.
const d1 = postingVerdict([wall("https://www.ziprecruiter.com/c/deloitte/Job/x"), wall("https://www.monster.com/job-openings/x"), L("https://talents.vaia.com/companies/deloitte/x", 410)])
ok("Daniel #1: walls plus a 410, none live -> likely_closed", d1.status === "likely_closed")
ok("Daniel #1: the evidence names each link's answer", d1.evidence.includes("HTTP 410 talents.vaia.com") && d1.evidence.includes("ziprecruiter.com"))
// Daniel #5 Deloitte Miami: one republisher page loads, so the rule does not apply.
ok("Daniel #5: a 404 beside a live page -> open, not likely_closed", postingVerdict([wall("https://www.ziprecruiter.com/x"), L("https://www.talent.com/x", 404), L("https://digitalhire.com/x", 200, "<h1>Analyst</h1>"), L("https://ai-search.io/x", 429)]).status === "open")
ok("bot walls alone stay unknown", postingVerdict([wall("https://a.com/x"), L("https://b.com/x", 429), L("https://c.com/x", null)]).status === "unknown")
ok("a 500 is not an answer: unknown", postingVerdict([L("https://a.com/x", 500)]).status === "unknown")
// Daniel #3 Wayfair: the employer page says so, the republishers 410.
ok("Daniel #3: an employer 'no longer active' page beside 410s -> closed", postingVerdict([L("https://www.wayfair.com/careers/job/x", 200, "<p>This job is no longer active.</p>"), L("https://bebee.com/x", 410)]).status === "closed")
ok("no links -> unknown", postingVerdict([]).status === "unknown")

console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
if (failures) process.exit(1)
