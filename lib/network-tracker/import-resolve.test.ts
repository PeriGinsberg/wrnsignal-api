#!/usr/bin/env tsx
// Rules for the coach-run contacts import. Pure, so no database.
// Run: npx tsx lib/network-tracker/import-resolve.test.ts

import {
  resolveImport,
  normalizeDomain,
  type ExistingCompany,
  type ExistingContact,
  type SourceRow,
} from "./import-resolve"

let pass = 0
let fail = 0
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else fail++
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`}`)
}

function row(rowNum: number, p: Partial<SourceRow>): SourceRow {
  return {
    rowNum, company: "", first: "", last: "", title: "", email: "", linkedin: "", domain: "",
    segment: "", priority: "", relationship: "", additionalInfo: "",
    ...p,
  }
}
const run = (rows: SourceRow[], companies: ExistingCompany[] = [], contacts: ExistingContact[] = []) =>
  resolveImport({ rows, companies, contacts })
const dispositions = (r: ReturnType<typeof run>) => r.rows.map((x) => x.disposition)

// ── normalizeDomain ─────────────────────────────────────────────────────────
check("domain: bare host", normalizeDomain("arcww.com"), "arcww.com")
check("domain: strips www", normalizeDomain("www.arcww.com"), "arcww.com")
check("domain: strips scheme and path", normalizeDomain("https://www.okrp.com/careers?x=1"), "okrp.com")
check("domain: uppercase", normalizeDomain("ENERGYBBDO.COM"), "energybbdo.com")
check("domain: from an email address", normalizeDomain("jon@arcww.com"), "arcww.com")
check("domain: trailing dot and port", normalizeDomain("arcww.com.:443"), "arcww.com")
check("domain: free mail is not an identity", normalizeDomain("gmail.com"), null)
check("domain: free mail via address", normalizeDomain("someone@yahoo.com"), null)
check("domain: not a domain", normalizeDomain("n/a"), null)
check("domain: empty", normalizeDomain(""), null)

// ── company matching ────────────────────────────────────────────────────────
{
  const companies: ExistingCompany[] = [{ id: "c1", name: "Arc Worldwide", domain: "arcww.com" }]
  const r = run([row(2, { company: "Arc", first: "Jon", last: "Britt", domain: "www.arcww.com" })], companies)
  check("company: domain beats a different name", [r.rows[0].companyAction, r.rows[0].companyRef], ["match_domain", "c1"])
  check("company: no create when domain matched", r.companiesToCreate.length, 0)
}
{
  const companies: ExistingCompany[] = [{ id: "c1", name: "Barkley OKRP", domain: null }]
  const r = run([row(2, { company: "barkley okrp", first: "Pat", last: "Durkin", domain: "okrp.com" })], companies)
  check("company: name match is case-insensitive", r.rows[0].companyAction, "match_name")
  check("company: domain backfilled onto the match", r.domainBackfills, [{ id: "c1", name: "Barkley OKRP", domain: "okrp.com" }])
}
{
  const companies: ExistingCompany[] = [
    { id: "c1", name: "Arc Worldwide", domain: "arcww.com" },
    { id: "c2", name: "Arc", domain: null },
  ]
  const r = run([row(2, { company: "Arc", first: "Jon", last: "Britt", domain: "arcww.com" })], companies)
  check("company: domain and name disagree -> conflict", dispositions(r), ["skip_conflict"])
}
{
  const r = run([row(2, { company: "New Shop", first: "Ann", last: "Lee", domain: "newshop.com" })])
  check("company: created with its domain", r.companiesToCreate, [{ key: "new:0", name: "New Shop", domain: "newshop.com" }])
  check("company: row points at the planned company", r.rows[0].companyRef, "new:0")
}
{
  // Two rows, same new company, one of them carrying the domain.
  const r = run([
    row(2, { company: "New Shop", first: "Ann", last: "Lee" }),
    row(3, { company: "new shop", first: "Bob", last: "Ray", domain: "newshop.com" }),
  ])
  check("company: planned once for the whole file", r.companiesToCreate.length, 1)
  check("company: a later row supplies the domain", r.companiesToCreate[0].domain, "newshop.com")
  check("company: both rows create", dispositions(r), ["create", "create"])
}

// ── the decisions that are skips ────────────────────────────────────────────
check("skip: domain with no company name", dispositions(run([row(2, { first: "Ann", last: "Lee", domain: "acme.com" })])), ["skip_invalid"])
check("skip: no name at all", dispositions(run([row(2, { company: "Acme" })])), ["skip_invalid"])
check(
  "create: no company and no domain is a standalone contact",
  dispositions(run([row(2, { first: "Ann", last: "Lee" })])),
  ["create"],
)

// ── contact dedupe ──────────────────────────────────────────────────────────
{
  const companies: ExistingCompany[] = [{ id: "c1", name: "Arc", domain: "arcww.com" }]
  const contacts: ExistingContact[] = [{ first_name: "Jon", last_name: "Britt", company_id: "c1", email: "Jon.Britt@arcww.com" }]
  const r = run([row(2, { company: "Arc", first: "Jonathan", last: "Britt", email: "jon.britt@ARCWW.com" })], companies, contacts)
  check("contact: email match is case-insensitive", dispositions(r), ["skip_duplicate_email"])
}
{
  const companies: ExistingCompany[] = [
    { id: "c1", name: "Arc", domain: "arcww.com" },
    { id: "c2", name: "Other Co", domain: "other.com" },
  ]
  const contacts: ExistingContact[] = [{ first_name: "Jon", last_name: "Britt", company_id: "c1", email: "jon@arcww.com" }]
  const r = run([row(2, { company: "Other Co", first: "Jon", last: "Britt", email: "jon@arcww.com" })], companies, contacts)
  check("contact: same email at another company is still a duplicate", dispositions(r), ["skip_duplicate_email"])
  check("contact: and it says so", r.rows[0].detail, "jon@arcww.com is already on the board under a different company.")
}
{
  const companies: ExistingCompany[] = [{ id: "c1", name: "Arc", domain: null }]
  const contacts: ExistingContact[] = [{ first_name: "Jon", last_name: "Britt", company_id: "c1", email: null }]
  const r = run([row(2, { company: "Arc", first: "jon", last: "BRITT", email: "new@arcww.com" })], companies, contacts)
  check("contact: name+company catches the emailless duplicate", dispositions(r), ["skip_duplicate_name"])
}
{
  const contacts: ExistingContact[] = [{ first_name: "Ann", last_name: "Lee", company_id: null, email: null }]
  const r = run([row(2, { first: "Ann", last: "Lee" })], [], contacts)
  check("contact: standalone duplicate", dispositions(r), ["skip_duplicate_name"])
}
{
  const r = run([
    row(2, { company: "Acme", first: "Ann", last: "Lee", email: "a@acme.com" }),
    row(3, { company: "Acme", first: "Ann", last: "Lee", email: "a@acme.com" }),
    row(4, { company: "Acme", first: "Ann", last: "Lee" }),
  ])
  check("contact: within-file duplicates", dispositions(r), ["create", "skip_duplicate_email", "skip_duplicate_name"])
}

// ── email that is not an email ──────────────────────────────────────────────
{
  const r = run([row(2, { company: "Acme", first: "Ann", last: "Lee", email: "call her" })])
  check("email: junk is dropped, contact still created", [r.rows[0].disposition, r.rows[0].emailDropped, r.rows[0].insert?.email], ["create", true, null])
  check("email: junk counted", r.summary.emailDropped, 1)
}

// ── the optional columns: mapped wins, unmapped gets the locked default ─────
// These shipped broken for one deploy: the columns were still offered in the
// mapping UI while the commit ignored them, so a client mapping "Priority"
// watched it vanish. Both halves are pinned here.
{
  const r = run([row(2, { company: "Acme", first: "Ann", last: "Lee" })])
  check("unmapped: relationship falls back to cold", r.rows[0].insert?.relationship, "cold")
  check("unmapped: priority blank", r.rows[0].insert?.priority, null)
  check("unmapped: segment blank", r.rows[0].insert?.segment, null)
  check("unmapped: additional info blank", r.rows[0].insert?.additional_info, null)
}
{
  const r = run([row(2, { company: "Acme", first: "Ann", last: "Lee", relationship: "Referred", priority: "b", segment: "Alumni", additionalInfo: "Met at the conference" })])
  check("mapped: relationship honoured, lowercased", r.rows[0].insert?.relationship, "referred")
  check("mapped: priority honoured, uppercased", r.rows[0].insert?.priority, "B")
  check("mapped: segment honoured", r.rows[0].insert?.segment, "Alumni")
  check("mapped: additional info honoured", r.rows[0].insert?.additional_info, "Met at the conference")
}
{
  const r = run([row(2, { company: "Acme", first: "Ann", last: "Lee", relationship: "warm-ish", priority: "P1" })])
  check("mapped but invalid: relationship falls back rather than writing junk", r.rows[0].insert?.relationship, "cold")
  check("mapped but invalid: priority left blank", r.rows[0].insert?.priority, null)
}

// ── a non-email contact method is kept for the commit to log ────────────────
{
  const r = run([row(2, { company: "Acme", first: "Ann", last: "Lee", email: "call her assistant" })])
  check("contact method preserved", r.rows[0].contactMethod, "call her assistant")
  check("...and not written to the email column", r.rows[0].insert?.email, null)
}
{
  const r = run([row(2, { company: "Acme", first: "Ann", last: "Lee", email: "ann@acme.com" })])
  check("a real address is not a contact method", r.rows[0].contactMethod, null)
}

// ── summary ─────────────────────────────────────────────────────────────────
{
  const companies: ExistingCompany[] = [{ id: "c1", name: "Arc", domain: "arcww.com" }]
  const contacts: ExistingContact[] = [{ first_name: "Jon", last_name: "Britt", company_id: "c1", email: "jon@arcww.com" }]
  const r = run(
    [
      row(2, { company: "Arc", first: "Jon", last: "Britt", email: "jon@arcww.com", domain: "arcww.com" }),
      row(3, { company: "New Shop", first: "Ann", last: "Lee", domain: "newshop.com" }),
      row(4, { first: "Bad", last: "Row", domain: "orphan.com" }),
    ],
    companies,
    contacts,
  )
  check("summary", r.summary, {
    total: 3,
    create: 1,
    skip_duplicate_email: 1,
    skip_duplicate_name: 0,
    skip_conflict: 0,
    skip_invalid: 1,
    emailDropped: 0,
    companiesMatched: 1,
    companiesCreated: 1,
    domainsBackfilled: 0,
  })
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
