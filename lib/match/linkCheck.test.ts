// Run: npx tsx lib/match/linkCheck.test.ts
//
// The apply-link verdict (lib/match/linkCheck.ts), offline. Closed only when
// the page says so; a bot wall or an error is unknown, never closed.

import { classifyPage, fetchUrlFor } from "./linkCheck"

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

console.log(failures ? `\n${failures} failure(s)` : "\nall passed")
if (failures) process.exit(1)
