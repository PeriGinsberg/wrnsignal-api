// tests/network-tracker/parse-name.test.ts
// Run: npx tsx --test tests/network-tracker/parse-name.test.ts
// The import name-splitter (docs/network-tracker/network-tracker-import.md §4).

import { test } from "node:test"
import assert from "node:assert/strict"
import { splitName, displayName, resolveImportedName } from "../../lib/network-tracker/parse-name"

const eq = (raw: string, first: string, last: string) => {
  const r = splitName(raw)
  assert.deepEqual(r, { first_name: first, last_name: last }, `splitName(${JSON.stringify(raw)})`)
}

// ── the §4 examples: preserved verbatim, split on the last space ──
test("simple two-token", () => eq("Jane Smith", "Jane", "Smith"))
test("middle initial stays in first_name", () => eq("Amanda E. Schreyer", "Amanda E.", "Schreyer"))
test("accents preserved (last space)", () => eq("John L. DuPré", "John L.", "DuPré"))
test("apostrophe preserved", () => eq("Ann M. O'Rourke", "Ann M.", "O'Rourke"))
test("hyphenated surname preserved", () => eq("Giovanna H. Fessenden-Fairbank", "Giovanna H.", "Fessenden-Fairbank"))

// ── leading titles stripped ──
test("strips Dr.", () => eq("Dr. Alan Kay", "Alan", "Kay"))
test("strips Ms. with two names", () => eq("Ms. Grace Hopper", "Grace", "Hopper"))
test("title is case/period tolerant", () => eq("prof grace hopper", "grace", "hopper"))

// ── trailing suffix stripped AND retained on last_name ──
test("Jr. retained on last_name", () => eq("Sammy Davis Jr.", "Sammy", "Davis Jr."))
test("III retained", () => eq("William H. Gates III", "William H.", "Gates III"))
test("Esq. retained", () => eq("Ann O'Rourke Esq.", "Ann", "O'Rourke Esq."))
test("title + suffix together", () => eq("Dr. Martin Luther King Jr.", "Martin Luther", "King Jr."))

// ── single-token -> all in last_name, first_name empty ──
test("single token name", () => eq("Cher", "", "Cher"))
test("single token + suffix", () => eq("Prince Jr.", "", "Prince Jr."))

// ── non-person / blank ──
test("non-person name -> last_name", () => eq("Trademark Team", "Trademark", "Team")) // two tokens still split; §5 blank-first is handled by the importer, not the splitter
test("empty string", () => eq("", "", ""))
test("whitespace only", () => eq("   ", "", ""))
test("collapses inner whitespace", () => eq("John   Q.   Public", "John Q.", "Public"))

// ── display join is trimmed ──
test("displayName trims empty first", () => assert.equal(displayName("", "Trademark Team"), "Trademark Team"))
test("displayName joins", () => assert.equal(displayName("Jane", "Smith"), "Jane Smith"))

// ── resolveImportedName: person vs non-person (§5) ──
test("person name resolves via split", () => assert.deepEqual(resolveImportedName("Jane Smith"), { first_name: "Jane", last_name: "Smith", nonPerson: false }))
test("org name -> raw in last_name, flagged", () => assert.deepEqual(resolveImportedName("Trademark Team"), { first_name: "", last_name: "Trademark Team", nonPerson: true }))
test("inbox-ish single token -> non-person", () => assert.deepEqual(resolveImportedName("Reception"), { first_name: "", last_name: "Reception", nonPerson: true }))
test("firm name flagged", () => assert.equal(resolveImportedName("Gesmer Legal Group").nonPerson, true))
test("real person with hyphen not flagged", () => assert.equal(resolveImportedName("Giovanna H. Fessenden-Fairbank").nonPerson, false))
