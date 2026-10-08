// A required second language (DEF-019): flagged only when the posting says
// REQUIRED, never when preferred; the resume naming the language clears it.
// Run: npx tsx app/api/jobfit/languageRequirement.test.ts

import { languagesShownInProfile, requiredLanguagesFromJob } from "./languageRequirement"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}
const req = (t: string) => requiredLanguagesFromJob(t).languages.join(",")

// Required
ok("Santander: Spanish required, Portuguese preferred -> spanish only",
  req("English level: Fluency in English and Spanish is required; Portuguese proficiency is preferred.") === "spanish")
ok("bilingual required", req("Bilingual English/Spanish required.") === "spanish")
ok("must be fluent", req("Candidates must be fluent in Mandarin.") === "mandarin")
ok("mandatory, own line", req("Requirements:\n- Fluency in French (written and verbal) is mandatory") === "french")
ok("the clause is returned", requiredLanguagesFromJob("Fluency in English and Spanish is required; Portuguese proficiency is preferred.").line === "Fluency in English and Spanish is required")

// Not required
ok("preferred only", req("Spanish fluency preferred.") === "")
ok("a plus", req("Bilingual in Spanish is a plus.") === "")
ok("nice to have", req("Speaking Portuguese is nice to have, but required skills include Excel.") === "")
ok("not required", req("Spanish language skills not required.") === "")
ok("English alone is never flagged", req("Fluency in English is required.") === "")
ok("a language name without a language context", req("Experience with French Quarter clients is required.") === "")
ok("required elsewhere in the posting, language preferred in its own sentence",
  req("A bachelor's degree is required. Spanish proficiency is preferred.") === "")

// Profile side
ok("named on the resume", languagesShownInProfile("Languages: Spanish (native), English").includes("spanish"))
ok("not named", languagesShownInProfile("Finance major, Excel, PowerPoint").length === 0)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
