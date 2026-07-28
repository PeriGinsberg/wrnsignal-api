#!/usr/bin/env tsx
// Phase 8b — the renderer. Pure, and mutation-tested like the reminder engine,
// because this is where silent wrongness lives: a message that LOOKS finished
// and is not.
//
// The two load-bearing claims:
//   1. an unfilled profile variable never leaks as raw [BRACKET] into text
//   2. a fill-at-send prompt is never counted as unresolved

import { renderTemplate, UNRESOLVED_PLACEHOLDER } from "./templates"
import { TEMPLATE_DEFAULTS, } from "./template-defaults"
import { DEFAULTS_BY_ID } from "./templates"

let pass = 0, fail = 0
const ok = (l: string, c: boolean) => { c ? (pass++, console.log(`✓ ${l}`)) : (fail++, console.error(`✗ ${l}`)) }

const PROFILE = {
  client_first: "Jordan",
  current_role_title: "Senior Marketing Analyst",
  current_employer: "Northbrook Consumer Group",
  school: "University of Illinois",
  target_role: "Marketing Analytics",
  target_field: "Marketing",
  city: "Chicago",
  affinity_1: "Illinois alumni",
  key_strength: "turning messy data into decisions",
  grad_year: "2020",
}
const CONTACT = { first_name: "Priya", company_name: "Nodal Exchange" }

console.log("renderTemplate — 8b")

// ── substitution ────────────────────────────────────────────────────────────
{
  const r = renderTemplate("Hi [NAME] at [FIRM], I'm [CURRENT_ROLE] at [CURRENT_EMPLOYER].", PROFILE, CONTACT)
  ok("contact variables resolve", r.text.includes("Hi Priya at Nodal Exchange"))
  ok("profile variables resolve", r.text.includes("Senior Marketing Analyst at Northbrook Consumer Group"))
  ok("nothing unresolved when everything is present", r.unresolved.length === 0)
  ok("no brackets survive a fully-resolved body", !/\[[^\]]+\]/.test(r.text))
}

// [CURRENT_ROLE] -> current_role_title is the one token whose column was renamed.
// A lower-casing transform would break exactly this and nothing else.
ok("[CURRENT_ROLE] reads current_role_title, not current_role",
  renderTemplate("[CURRENT_ROLE]", PROFILE, CONTACT).text === "Senior Marketing Analyst")

// ── CLAIM 1: an unfilled profile variable never leaks as raw brackets ───────
{
  const r = renderTemplate("I studied at [SCHOOL] and I'm based in [CITY].", { city: "Chicago" }, CONTACT)
  ok("a missing profile variable is NOT left as raw [BRACKET]", !r.text.includes("[SCHOOL]"))
  ok("…it becomes a visible blank", r.text.includes(UNRESOLVED_PLACEHOLDER))
  ok("…and is reported in unresolved", r.unresolved.includes("SCHOOL"))
  ok("the resolvable one beside it still resolves", r.text.includes("Chicago"))
}
{
  // The strongest form: an entirely empty profile against a real template body.
  const r = renderTemplate(DEFAULTS_BY_ID.A1.body, {}, {})
  ok("empty profile + real template leaks NO profile/contact brackets",
    !/\[(NAME|FIRM|CURRENT_ROLE|CURRENT_EMPLOYER|TARGET_ROLE|TARGET_FIELD|AFFINITY_1)\]/.test(r.text))
  ok("…and every one of them is reported", r.unresolved.length > 0)
}
{
  // Every default body, empty inputs: no profile/contact bracket may survive.
  const leaks: string[] = []
  for (const t of TEMPLATE_DEFAULTS) {
    const r = renderTemplate(t.body, {}, {})
    for (const m of r.text.match(/\[([^\]]+)\]/g) ?? []) {
      const token = m.slice(1, -1)
      if (!r.toFill.includes(token)) leaks.push(`${t.id}:${m}`)
    }
  }
  ok(`no default body leaks a non-fill bracket with an empty profile (${leaks.join(", ") || "none"})`,
    leaks.length === 0)
}

// ── CLAIM 2: a fill-at-send prompt is never unresolved ──────────────────────
{
  const r = renderTemplate("Hi [NAME], [MUTUAL] suggested I reach out. [ONE SPECIFIC QUESTION]", PROFILE, CONTACT)
  ok("[MUTUAL] goes to toFill", r.toFill.includes("MUTUAL"))
  ok("[ONE SPECIFIC QUESTION] goes to toFill", r.toFill.includes("ONE SPECIFIC QUESTION"))
  ok("neither is counted as unresolved", r.unresolved.length === 0)
  ok("the prompt text SURVIVES so the writer knows what to write", r.text.includes("[ONE SPECIFIC QUESTION]"))
}
{
  // S1 is the scheduling template — three OPTION blanks. If these counted as
  // errors, one of the two most-used templates would always look broken.
  const r = renderTemplate(DEFAULTS_BY_ID.S1.body, PROFILE, CONTACT)
  ok("S1's OPTION blanks are toFill, not unresolved",
    r.toFill.some((t) => t.startsWith("OPTION")) && !r.unresolved.some((t) => t.startsWith("OPTION")))
  ok("a fully-populated profile leaves S1 with zero unresolved", r.unresolved.length === 0)
}
{
  // C2, the other one the doc calls out.
  const r = renderTemplate(DEFAULTS_BY_ID.C2.body, PROFILE, CONTACT)
  ok("C2 has no unresolved against a full profile", r.unresolved.length === 0)
}

// ── unknown tokens are caught, not shipped ─────────────────────────────────
{
  const r = renderTemplate("My target is [TARGETROLE].", PROFILE, CONTACT)
  ok("a typo'd token is reported as unresolved", r.unresolved.includes("TARGETROLE"))
  ok("…and does not survive as raw text", !r.text.includes("[TARGETROLE]"))
}

// ── edges ──────────────────────────────────────────────────────────────────
ok("a whitespace-only value counts as missing",
  renderTemplate("[CITY]", { city: "   " }, {}).unresolved.includes("CITY"))
ok("a repeated variable is reported once but substituted everywhere", (() => {
  const r = renderTemplate("[NAME] … [NAME]", {}, { first_name: "Priya" })
  return r.text === "Priya … Priya"
})())
ok("a repeated MISSING variable is listed once", (() => {
  const r = renderTemplate("[SCHOOL] [SCHOOL]", {}, {})
  return r.unresolved.length === 1
})())
ok("null profile and contact do not throw",
  renderTemplate("[NAME] [SCHOOL]", null, null).unresolved.length === 2)
ok("a body with no variables passes through untouched",
  renderTemplate("Just a plain sentence.", PROFILE, CONTACT).text === "Just a plain sentence.")
ok("substitution is whole-bracket, never partial",
  renderTemplate("[TARGET_ROLE]", { target_role: "Marketing Analytics" }, {}).text === "Marketing Analytics")

console.log(`\n${pass}/${pass + fail} assertions passed`)
if (fail > 0) process.exit(1)
