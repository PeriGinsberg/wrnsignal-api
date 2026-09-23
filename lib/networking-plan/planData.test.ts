#!/usr/bin/env tsx
// The Outreach Messages tab, as plan content. Pure, so no spreadsheet.
// Run: npx tsx lib/networking-plan/planData.test.ts

import { buildPlanContent, buildCadence, dayOf, type Touch } from "./planData"
import { renderPlanHtml, escapeHtml } from "./render"

let pass = 0
let fail = 0
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`) }
}

// The shape the real workbook has: touches first, then prose rows whose only
// filled cell is the first one.
const ROWS = [
  ["Email", "1", "Day 0", "Quick question", "Hi [First Name],\n\nBody.", "Replace every bracket."],
  ["Email", "2", "Day 7 (reply to your own first email)", "Re: Quick question", "Following up.", "Short on purpose."],
  ["LinkedIn", "1", "Day 0 (connection request)", "", "Hi [First Name], connecting.", "Same day as email 1."],
  ["Either", "Thank you", "Within 24 hours", "Thank you", "Thanks for the time.", "After every call."],
  ["How the sequence works", "", "", "", "", ""],
  ["Cadence: Day 0, Day 7, Day 12.", "", "", "", "", ""],
  ["Send emails one at a time from your own account.", "", "", "", "", ""],
]

console.log("splitting touches from prose")
const c = buildPlanContent(ROWS)
check("email touches", c.emailTouches.map((t) => t.touch), ["1", "2"])
check("linkedin touches", c.linkedinTouches.map((t) => t.touch), ["1"])
check("everything else", c.otherTouches.map((t) => t.channel), ["Either"])
// The first prose row is the heading the template already prints, not a bullet.
check("notes drop the heading row", c.notes.length, 2)
check("...and keep the real bullets", c.notes[0].startsWith("Cadence:"), true)

console.log("\nthe cadence strip is derived, not hardcoded")
check("day parsing", [dayOf("Day 0"), dayOf("Day 7 (reply)"), dayOf("Within 24 hours")], ["Day 0", "Day 7", null])
check("stops in first-seen order", c.cadence.map((s) => s.day), ["Day 0", "Day 7"])
check("a day lists what happens then", c.cadence[0].what, "Email 1 + LinkedIn 1")
check("a thank-you with no day is not a stop", c.cadence.length, 2)

{
  // A four-touch plan should get a four-stop strip with no template edit.
  const four: Touch[] = ["Day 0", "Day 3", "Day 7", "Day 14"].map((when, i) => ({
    channel: "Email", touch: String(i + 1), when, subject: null, message: "x", howToUse: null,
  }))
  check("four touches, four stops", buildCadence(four).length, 4)
}

console.log("\na row with no message is not a touch")
check("prose never becomes a touch", buildPlanContent([["Just a note", "", "", "", "", ""]]).emailTouches.length, 0)

console.log("\nescaping, because this is somebody else's typing")
check("angle brackets", escapeHtml("<script>"), "&lt;script&gt;")
check("ampersand", escapeHtml("Bell & Co"), "Bell &amp; Co")
{
  const html = renderPlanHtml({
    clientName: 'Ann <b>"Danger"</b> & Co',
    content: buildPlanContent([["Email", "1", "Day 0", "S", "<img onerror=alert(1)>", "note"]]),
    template: "<html><head><title>x</title></head><body><h1>x</h1></body></html>",
  })
  check("the client name is escaped in the heading", html.includes("Ann &lt;b&gt;"), true)
  check("...and in the title", html.includes("<title>Ann &lt;b&gt;"), true)
  check("a message cannot inject a tag", html.includes("<img onerror"), false)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
