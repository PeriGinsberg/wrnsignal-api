#!/usr/bin/env tsx
// Identity-field rules for a networking contact. Pure, so no database.
// Run: npx tsx lib/network-tracker/contactFields.test.ts

import {
  cleanOptional,
  normalizeEmail,
  normalizeLinkedInUrl,
  normalizePhone,
  validateLength,
  validateName,
  NAME_MAX,
} from "./contactFields"

let pass = 0
let fail = 0
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else { fail++; console.error(`  FAIL  ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`) }
  if (ok) console.log(`  ok    ${label}`)
}
const errors = (r: unknown) => (r as any).error !== undefined

console.log("clearing vs leaving alone")
check("empty string clears", cleanOptional(""), null)
check("whitespace clears", cleanOptional("   "), null)
check("a value is trimmed", cleanOptional("  Creative Director "), "Creative Director")

console.log("\nemail")
check("a good address", normalizeEmail("jon.britt@arcww.com"), { value: "jon.britt@arcww.com" })
check("trimmed", normalizeEmail("  jon@arc.com  "), { value: "jon@arc.com" })
check("empty clears it", normalizeEmail(""), { value: null })
check("no @ is refused", errors(normalizeEmail("jon.britt")), true)
check("no domain dot is refused", errors(normalizeEmail("jon@arc")), true)
check("a phone number in the email field is refused", errors(normalizeEmail("312-555-0148")), true)

console.log("\nlinkedin url")
check("a full https url", normalizeLinkedInUrl("https://www.linkedin.com/in/jane"), { value: "https://www.linkedin.com/in/jane" })
check("a bare host gets https", normalizeLinkedInUrl("linkedin.com/in/jane"), { value: "https://linkedin.com/in/jane" })
check("empty clears it", normalizeLinkedInUrl(""), { value: null })
// The record renders this as an href, so a script URL must never reach it.
check("javascript: is refused", errors(normalizeLinkedInUrl("javascript:alert(1)")), true)
check("data: is refused", errors(normalizeLinkedInUrl("data:text/html,<script>")), true)
check("ftp: is refused", errors(normalizeLinkedInUrl("ftp://files.example.com")), true)

console.log("\nphone")
check("a formatted number survives as typed", normalizePhone("+1 (312) 555-0148"), { value: "+1 (312) 555-0148" })
check("an extension survives", normalizePhone("312.555.0148 x22"), { value: "312.555.0148 x22" })
check("empty clears it", normalizePhone(""), { value: null })
check("a word is refused", errors(normalizePhone("call her assistant")), true)
check("too few digits is refused", errors(normalizePhone("12345")), true)

console.log("\nname")
check("first only is fine", validateName("Jon", null), null)
check("last only is fine", validateName(null, "Britt"), null)
check("neither is refused", typeof validateName("", "  "), "string")
check("a too-long name is refused", typeof validateLength("x".repeat(NAME_MAX + 1), NAME_MAX, "That first name"), "string")
check("a normal name passes", validateLength("Britt", NAME_MAX, "That last name"), null)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
