#!/usr/bin/env tsx
// The refresh guarantee lives HERE, not in the component: computeRefresh decides
// what a refresh overwrites, so this is where "an edited field survives" is
// actually proved.

import {
  computeSeed, computeRefresh, completeness, mergeTouched,
  computeAutoFill, hasFillableBlanks, CHEAP_SEEDED_FIELDS,
  firstNameFrom, firstTargetRole, gradYearFrom, targetFieldFrom,
  ALL_FIELDS, type SeedSources,
} from "./client-profile-seed"

let pass = 0, fail = 0
const ok = (l: string, c: boolean) => { c ? (pass++, console.log(`✓ ${l}`)) : (fail++, console.error(`✗ ${l}`)) }

const SRC: SeedSources = {
  name: "Jordan Alvarez",
  university: "University of Illinois",
  target_roles: "Marketing Analytics, Growth",
  grad_date: "2020-05-15",
  timeline: "Immediate",
  coach_notes_strengths: "quick learner, very observant",
  targetFamilies: ["Marketing", "Analytics"],
  currentRole: { title: "Senior Marketing Analyst", company: "Northbrook Consumer Group" },
}

console.log("client-profile-seed")

// ── field mappers ───────────────────────────────────────────────────────────
ok("first name is the first token", firstNameFrom("Jordan Alvarez") === "Jordan")
ok("mononym seeds whole", firstNameFrom("Prince") === "Prince")
ok("blank name seeds nothing", firstNameFrom("   ") === null)
ok("target role trims a list to the first", firstTargetRole("Marketing Analytics, Growth") === "Marketing Analytics")
ok("target role handles 'or'", firstTargetRole("In House Counsel or Private Practice") === "In House Counsel")
ok("grad year from YYYY-MM-DD", gradYearFrom("2020-05-15") === "2020")
ok("grad year from a bare year", gradYearFrom("2020") === "2020")
ok("grad year from junk is null", gradYearFrom("sometime") === null)
ok("target field takes the primary family", targetFieldFrom(["Marketing", "Analytics"]) === "Marketing")
ok("no families -> null", targetFieldFrom([]) === null)

// ── the seed ────────────────────────────────────────────────────────────────
{
  const s = computeSeed(SRC)
  ok("seeds exactly the 9 sourced fields", Object.keys(s).length === 9)
  ok("key_strength comes from the coach's note", s.key_strength === "quick learner, very observant")
  ok("current role + employer come from the résumé",
    s.current_role_title === "Senior Marketing Analyst" && s.current_employer === "Northbrook Consumer Group")
  // The 7a decision that matters most: target_locations means where they want to
  // WORK, so seeding it into `city` would be wrong-but-plausible and never corrected.
  ok("city is NEVER seeded", !("city" in s))
  ok("degree is never seeded (no honest source)", !("degree" in s))
  for (const f of ["affinity_1", "affinity_2", "affinity_3", "calendar_link", "resume_link", "elevator_pitch"]) {
    ok(`${f} is never seeded`, !(f in s))
  }
}

// A null source writes nothing rather than an empty string, so the meter stays honest.
ok("null sources seed nothing at all",
  Object.keys(computeSeed({ ...SRC, name: null, university: null, target_roles: null, grad_date: null,
    timeline: null, coach_notes_strengths: null, targetFamilies: null, currentRole: null })).length === 0)

// ── refresh: the whole point ─────────────────────────────────────────────────
{
  const r = computeRefresh(SRC, ["key_strength", "target_role"])
  ok("an EDITED field is not overwritten by refresh", !("key_strength" in r))
  ok("a second edited field is also left alone", !("target_role" in r))
  ok("untouched fields ARE refreshed", r.client_first === "Jordan" && r.school === "University of Illinois")

  // Cleared-on-purpose is still touched. Using "is it empty" as the test would
  // put the coach's note straight back, which is the single most annoying thing
  // this feature could do.
  ok("a field the user CLEARED stays cleared", !("key_strength" in computeRefresh(SRC, ["key_strength"])))

  ok("nothing touched -> everything re-seeds", Object.keys(computeRefresh(SRC, [])).length === 9)
  ok("everything touched -> refresh is a no-op",
    Object.keys(computeRefresh(SRC, [...Object.keys(computeSeed(SRC))])).length === 0)
}

// ── auto-fill: the case that motivated it ───────────────────────────────────
// A client opens the networking profile EARLY, before intake/résumé/coach notes
// have landed. The seed grabs an empty source and stamps done. The source fills
// in later. Without auto-fill the profile stays blank until someone presses a
// button they do not know exists.
{
  const emptySrc: SeedSources = {
    name: null, university: null, target_roles: null, grad_date: null, timeline: null,
    coach_notes_strengths: null, targetFamilies: null, currentRole: null,
  }
  const seededEarly = computeSeed(emptySrc)
  ok("seeding against an empty source fills nothing", Object.keys(seededEarly).length === 0)

  // …the source fills in afterwards.
  const fill = computeAutoFill(SRC, seededEarly, [])
  ok("a later GET fills the blanks from the now-populated source", fill.client_first === "Jordan")
  ok("…including every other cheap field", fill.school === "University of Illinois" && fill.timeframe === "Immediate")
  ok("the cost guard agrees there is work to do", hasFillableBlanks(seededEarly, []) === true)
}

// ── auto-fill must NOT rewrite what the user has seen ───────────────────────
{
  // Untouched but NON-EMPTY: the client read the coach's strengths note and was
  // happy with it. touched_fields cannot tell that from "never seen", which is
  // exactly why the rule is EMPTY-and-untouched, not just untouched.
  const accepted = { key_strength: "quick learner, very observant", client_first: "Jordan" }
  const changedSrc: SeedSources = { ...SRC, coach_notes_strengths: "needs work on executive presence" }

  const fill = computeAutoFill(changedSrc, accepted, [])
  ok("an ACCEPTED field is never auto-changed when its source changes", !("key_strength" in fill))
  ok("…and neither is any other field that already has a value", !("client_first" in fill))
  ok("but a still-blank field beside it is filled", fill.school === "University of Illinois")

  // The explicit path still overwrites it — that is the whole point of Refresh.
  ok("Refresh DOES overwrite an accepted field (explicit intent)",
    computeRefresh(changedSrc, []).key_strength === "needs work on executive presence")
}

// A touched field is out of reach of auto-fill even when empty (deliberately cleared).
ok("a deliberately CLEARED field is not auto-refilled",
  !("key_strength" in computeAutoFill(SRC, { key_strength: "" }, ["key_strength"])))

// Cost guard: a settled profile does no source read at all.
{
  const full = Object.fromEntries(CHEAP_SEEDED_FIELDS.map((f) => [f, "x"]))
  ok("no blanks -> cost guard skips the source read", hasFillableBlanks(full, []) === false)
  ok("all blanks but all touched -> also skipped", hasFillableBlanks({}, [...CHEAP_SEEDED_FIELDS]) === false)
  ok("résumé fields do not trigger the cheap guard (they are phase 2)",
    hasFillableBlanks({ ...full, current_role_title: "" }, []) === false)
}

// ── touched bookkeeping ─────────────────────────────────────────────────────
ok("a one-field save marks only that field", mergeTouched([], ["city"]).join() === "city")
ok("touched accumulates without duplicates", mergeTouched(["city"], ["city", "degree"]).join() === "city,degree")

// ── completeness ────────────────────────────────────────────────────────────
{
  ok("total is 17 — 16 merge vars + the pitch", ALL_FIELDS.length === 17)
  ok("empty row is 0 of 17", completeness({}).filled === 0)
  const seeded = completeness(computeSeed(SRC))
  ok("a freshly seeded profile is 9 of 17", seeded.filled === 9 && seeded.total === 17)
  ok("missing lists what a template would leave blank", seeded.missing.includes("elevator_pitch"))
  ok("whitespace does not count as filled", completeness({ city: "   " }).filled === 0)
  const full = Object.fromEntries(ALL_FIELDS.map((f) => [f, "x"]))
  ok("every field filled is 17 of 17", completeness(full).filled === 17)
}

console.log(`\n${pass}/${pass + fail} assertions passed`)
if (fail > 0) process.exit(1)
