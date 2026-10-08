// The dashboard's client search rule. Run: npx tsx lib/coach/clientSearch.test.ts

import { clientHref, nameMatches, searchClients } from "./clientSearch"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}`) }
}

ok("first name, any case", nameMatches("Lily Chen", "LI"))
ok("last name", nameMatches("Lily Chen", "chen"))
ok("first and last", nameMatches("Lily Chen", "lily ch"))
ok("one character is not enough", !nameMatches("Lily Chen", "l"))
ok("middle of a word does not match", !nameMatches("Lily Chen", "ily"))
ok("accents ignored", nameMatches("José Álvarez", "alv"))
ok("hyphenated last name, second part", nameMatches("Ana Smith-Jones", "jones"))
ok("a word that is not there", !nameMatches("Lily Chen", "lily x"))

const rows = [{ name: "Chloe Lim" }, { name: "Lily Chen" }, { name: "Zach Lee" }, { name: "Liam Brown" }]
ok("names starting with the query come first, then A to Z",
  searchClients(rows, "li").map((r) => r.name).join(",") === "Liam Brown,Lily Chen,Chloe Lim")
ok("capped", searchClients(Array.from({ length: 20 }, (_, i) => ({ name: `Lee ${i}` })), "lee").length === 8)
ok("no match", searchClients(rows, "qq").length === 0)

ok("client with a login goes to the client page", clientHref({ id: "cc1", client_profile_id: "p1" }) === "/dashboard/coach/clients/p1")
ok("client without a login goes to the record page", clientHref({ id: "cc1", client_profile_id: null }) === "/dashboard/coach/coach-clients/cc1")

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
