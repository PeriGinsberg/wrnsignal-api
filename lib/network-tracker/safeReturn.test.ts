// Run: npx tsx lib/network-tracker/safeReturn.test.ts
//
// A destination read from a query string is an open redirect until it is
// checked. The attack is not exotic: hand someone a link to our own contacts
// page carrying a return of https://evil.example, they see our domain, add a
// real contact, and a button we rendered sends them off-site. So the rejections
// below are the point of the file, and the acceptances only exist to prove it
// has not been made so strict that the feature stops working.

import { isSafeReturn, safeReturn, safeReturnLabel, MAX_RETURN_LABEL } from "./safeReturn"

let failures = 0
function ok(label: string, cond: boolean) {
  if (!cond) { failures++; console.error(`  FAIL  ${label}`) }
  else console.log(`  ok    ${label}`)
}

console.log("\nsafeReturn accepts real destinations")
ok("an application detail path", isSafeReturn("/dashboard/tracker/abc-123"))
ok("a path with a hyphenated uuid", isSafeReturn("/dashboard/tracker/9f2c1a44-7b31-4e0e-9a1e-0b8d4f6e2c11"))
ok("a networking path", isSafeReturn("/dashboard/network/contacts"))
ok("a path with a query string", isSafeReturn("/dashboard/tracker?view=interviews"))
ok("a path with a fragment", isSafeReturn("/dashboard/tracker/abc#interviews"))
// The hyphen case is here because an earlier draft of the control-character
// check collapsed into "space or hyphen" and would have rejected every one of
// the real paths above.
ok("hyphens are not treated as control characters", isSafeReturn("/dashboard/some-page-here"))

console.log("\nsafeReturn rejects anything that leaves the site")
ok("a protocol-relative URL", !isSafeReturn("//evil.example"))
ok("...even dressed as one of ours", !isSafeReturn("//evil.example/dashboard/tracker/1"))
ok("an absolute https URL", !isSafeReturn("https://evil.example/dashboard/tracker/1"))
ok("an absolute http URL", !isSafeReturn("http://evil.example"))
ok("a javascript: URL", !isSafeReturn("javascript:alert(1)"))
ok("a data: URL", !isSafeReturn("data:text/html,<script>"))
ok("a mailto: URL", !isSafeReturn("mailto:someone@example.com"))
ok("an uppercase scheme", !isSafeReturn("HTTPS://evil.example"))

console.log("\nsafeReturn rejects anything outside /dashboard/")
ok("a bare slash", !isSafeReturn("/"))
ok("another app route", !isSafeReturn("/feedback/jobfit"))
ok("a prefix near-miss", !isSafeReturn("/dashboardevil"))
ok("a relative path", !isSafeReturn("dashboard/tracker/1"))

console.log("\nsafeReturn rejects traversal and separators")
ok("traversal out of the prefix", !isSafeReturn("/dashboard/../../etc/passwd"))
ok("traversal mid-path", !isSafeReturn("/dashboard/tracker/../../x"))
// A query string may legitimately contain "..", and a fragment never reaches
// the server, so only the PATH is checked for traversal.
ok("dots inside a query string are fine", isSafeReturn("/dashboard/tracker?q=..%2F"))
ok("backslashes", !isSafeReturn("/dashboard\\evil"))

console.log("\nsafeReturn rejects control characters")
ok("a newline", !isSafeReturn("/dashboard/tracker/1\nX-Injected: 1"))
ok("an interior carriage return", !isSafeReturn("/dashboard/tracker/1\rX-Injected: 1"))
ok("a tab", !isSafeReturn("/dashboard/tracker/1\tx"))
// TRAILING whitespace is trimmed BEFORE the control-character check, so a
// trailing CRLF is not a rejection, it is a trim. That is the correct
// behaviour and not a hole: what the caller gets back from safeReturn() is the
// trimmed string, so nothing downstream ever sees the CRLF. The first draft of
// this file asserted a rejection here and was wrong about its own contract.
const CRLF = "/dashboard/tracker/1" + String.fromCharCode(13) + String.fromCharCode(10)
ok("a TRAILING crlf is trimmed rather than rejected", isSafeReturn(CRLF))
ok("...and what comes back carries no control characters",
  !(safeReturn(CRLF) ?? "x").split("").some((c) => c.charCodeAt(0) < 32))
ok("a null byte", !isSafeReturn("/dashboard/tracker/1" + String.fromCharCode(0)))
ok("a delete character", !isSafeReturn("/dashboard/tracker/1" + String.fromCharCode(127)))

console.log("\nsafeReturn rejects non-strings and empties")
ok("null", !isSafeReturn(null))
ok("undefined", !isSafeReturn(undefined))
ok("a number", !isSafeReturn(42))
ok("an object", !isSafeReturn({ toString: () => "/dashboard/tracker/1" }))
ok("an empty string", !isSafeReturn(""))
ok("whitespace only", !isSafeReturn("   "))

console.log("\nsafeReturn returns the value or null")
ok("a safe url comes back", safeReturn("/dashboard/tracker/1") === "/dashboard/tracker/1")
ok("it is trimmed", safeReturn("  /dashboard/tracker/1  ") === "/dashboard/tracker/1")
ok("an unsafe url is null, not a fallback", safeReturn("https://evil.example") === null)

console.log("\nsafeReturnLabel")
ok("ordinary text survives", safeReturnLabel("Operations Analyst at Globex") === "Operations Analyst at Globex")
ok("whitespace is collapsed", safeReturnLabel("  Ops   Analyst \n at Globex ") === "Ops Analyst at Globex")
// Escaped by React, so the risk is not injection: it is a label long enough to
// push the real actions off the panel.
ok("a very long label is capped", safeReturnLabel("x".repeat(500))!.length === MAX_RETURN_LABEL)
ok("empty is null", safeReturnLabel("") === null)
ok("whitespace only is null", safeReturnLabel("   ") === null)
ok("a non-string is null", safeReturnLabel(undefined) === null)

console.log(failures === 0 ? "\nall safeReturn assertions passed\n" : `\n${failures} FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
