#!/usr/bin/env tsx
// Resume Workshop, Phase 1: the server rules and the export.
// Run: npx tsx tests/resume-workshop/workshop.test.ts

import { makeFakeDb } from "../_lib/fakeSupabase"
import { headingTab, prefillFromResume } from "../../lib/resumeWorkshop/prefill"
import { TABS, TAB_LABEL } from "../../lib/resumeWorkshop/model"
import {
  addCapture, addEntry, buildExport, captureToEntry, deleteCapture, deleteEntry, getBundle, prefillFromPasted,
  saveCapture, saveEntryField, saveGeneral, setPastedResume, startWorkshop,
} from "../../lib/resumeWorkshop/service"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const COACH = "coach-1"
const CC = "cc-1"
const OTHER_CC = "cc-2"
const RESUME = [
  "Lily Chen",
  "lily@example.com | 555-0100",
  "",
  "EDUCATION",
  "Boston University, B.S. Marketing, May 2026",
  "GPA 3.7",
  "",
  "Relevant Coursework",
  "Consumer Behavior; Marketing Analytics",
  "",
  "WORK EXPERIENCE",
  "Acme Corp, Marketing Intern, Summer 2025",
  "- Ran social posts for 3 product lines",
  "",
  "Leadership Experience",
  "President, Marketing Club (40 members)",
  "",
  "SKILLS",
  "Excel, Canva, HubSpot",
].join("\n")

function seed(over: { resume?: string | null } = {}) {
  return makeFakeDb({
    coach_clients: [
      { id: CC, coach_profile_id: COACH, name: "Lily Chen", client_profile_id: "prof-lily", status: "active", target_roles: ["Brand marketing"], target_industries: null, target_locations: null },
      { id: OTHER_CC, coach_profile_id: COACH, name: "Sam Lee", client_profile_id: null, status: "active", target_roles: null, target_industries: null, target_locations: null },
    ],
    client_profiles: [
      { id: COACH, name: "Peri Ginsberg", email: "peri@example.com", is_coach: true, resume_text: null },
      { id: "prof-lily", name: "Lily Chen", email: "lily@example.com", resume_text: "OLD PROFILE RESUME" },
    ],
    client_personas: over.resume === null ? [] : [
      { id: "p1", profile_id: "prof-lily", name: "Marketing", resume_text: over.resume ?? RESUME, is_default: true, display_order: 1, archived_at: null },
    ],
    prospect_consults: [{ coach_client_id: CC, why_now: "Graduating in May", search_goal: "first_job", services: ["resume_cover_letter"], recommendation: "Resume first" }],
    coach_client_engagements: [{ id: "eng-1", coach_client_id: CC, name: "Build the Resume", proposal_status: "approved" }],
    coach_client_engagement_deliverables: [{ id: "d-1", engagement_id: "eng-1", name: "Resume Workshop", not_needed: false, sort_order: 1 }],
    coach_client_events: [],
    resume_workshops: [],
    resume_workshop_entries: [],
    resume_workshop_captures: [],
    resume_workshop_history: [],
  })
}
type Db = ReturnType<typeof seed>

async function main() {
  console.log("reading the resume")
  ok("headings map to tabs", headingTab("WORK EXPERIENCE") === "experience" && headingTab("Leadership Experience") === "leadership"
    && headingTab("Relevant Coursework:") === "coursework" && headingTab("EDUCATION") === "education" && headingTab("Honors & Awards") === "honors")
  ok("a sentence is not a heading", headingTab("I have experience leading teams of five people.") === null)
  const pre = prefillFromResume(RESUME)
  ok("one entry per recognised section, in order", pre.map((p) => p.tab).join(",") === "education,coursework,experience,leadership,skills", pre.map((p) => p.tab).join(","))
  ok("each excerpt is the section word for word", pre.find((p) => p.tab === "experience")?.resume_excerpt === "Acme Corp, Marketing Intern, Summer 2025\n- Ran social posts for 3 product lines")
  ok("contact lines make no entry", !pre.some((p) => p.resume_excerpt.includes("555-0100")))
  ok("no resume, no entries", prefillFromResume("").length === 0 && prefillFromResume(null).length === 0)

  console.log("\nstarting the workshop")
  {
    const db = seed()
    const r = await startWorkshop(db.client as any, CC, COACH)
    ok("created", r.ok)
    const again = await startWorkshop(db.client as any, CC, COACH)
    ok("opening again returns the same workshop", again.ok && r.ok && again.data.id === r.data.id && db.tables.resume_workshops.length === 1)
    const b = await getBundle(db.client as any, CC)
    ok("entries from the resume, notes empty, marked as resume", b.entries.length === 5 && b.entries.every((e) => e.source === "resume" && e.notes === "" && !!e.resume_excerpt))
    ok("the resume panel shows the default persona", b.resume.source === "persona" && b.resume.text === RESUME)
    ok("consultation context is there", (b.consult.consult as any)?.why_now === "Graduating in May" && b.consult.engagements[0]?.deliverables[0] === "Resume Workshop")
    ok("client name", b.client_name === "Lily Chen")
  }
  {
    const db = seed({ resume: null })
    await startWorkshop(db.client as any, CC, COACH)
    let b = await getBundle(db.client as any, CC)
    ok("no persona: falls back to the profile resume", b.resume.source === "profile" && b.resume.text === "OLD PROFILE RESUME")
    const db2 = seed()
    await startWorkshop(db2.client as any, OTHER_CC, COACH)
    b = await getBundle(db2.client as any, OTHER_CC)
    ok("no resume at all: nothing shown, no entries", b.resume.source === null && b.entries.length === 0)
    await setPastedResume(db2.client as any, OTHER_CC, "EXPERIENCE\nBarista, Blue Cafe", COACH)
    const pf = await prefillFromPasted(db2.client as any, OTHER_CC)
    b = await getBundle(db2.client as any, OTHER_CC)
    ok("pasted resume is shown and makes entries", pf.ok && b.resume.source === "pasted" && b.entries.length === 1 && b.entries[0].tab === "experience")
    ok("entries from a pasted resume are made only once", !(await prefillFromPasted(db2.client as any, OTHER_CC)).ok)
  }

  console.log("\nsaving")
  {
    const db = seed()
    await startWorkshop(db.client as any, CC, COACH)
    const e = await addEntry(db.client as any, CC, "experience", "")
    ok("add an entry on any tab, in any order", e.ok && (await addEntry(db.client as any, CC, "honors", "Dean's list")).ok)
    if (!e.ok) return
    const s1 = await saveEntryField(db.client as any, CC, { entryId: e.data.id, field: "notes", value: "Led the launch.", baseVersion: 0, actor: COACH })
    ok("a save moves the version on", s1.ok && s1.data.notes_version === 1)
    const stale = await saveEntryField(db.client as any, CC, { entryId: e.data.id, field: "notes", value: "OLD TEXT", baseVersion: 0, actor: COACH })
    ok("a save typed on an old version is refused with the current text", !stale.ok && stale.status === 409 && (stale.current as any)?.notes === "Led the launch.")
    const t = await saveEntryField(db.client as any, CC, { entryId: e.data.id, field: "title", value: "Acme, Intern", baseVersion: 0, actor: COACH })
    ok("title and notes have separate versions", t.ok && t.data.title_version === 1 && t.data.notes_version === 1)
    const hist = db.tables.resume_workshop_history.filter((h) => h.entity_id === e.data.id)
    ok("every accepted save is in history, the refused one is not", hist.length === 2 && !hist.some((h) => h.value === "OLD TEXT"))
    const g = await saveGeneral(db.client as any, CC, { value: "Wants brand roles.", baseVersion: 0, actor: COACH })
    ok("general notes save", g.ok && g.data.general_version === 1)
    ok("too long is refused", !(await saveEntryField(db.client as any, CC, { entryId: e.data.id, field: "title", value: "x".repeat(400), baseVersion: 1, actor: COACH })).ok)
    ok("an unknown tab is refused", !(await addEntry(db.client as any, CC, "dna", "")).ok)
  }

  console.log("\none client's workshop is not reachable from another")
  {
    const db = seed()
    await startWorkshop(db.client as any, CC, COACH)
    await startWorkshop(db.client as any, OTHER_CC, COACH)
    const e = await addEntry(db.client as any, CC, "experience", "Private")
    if (!e.ok) return
    const cross = await saveEntryField(db.client as any, OTHER_CC, { entryId: e.data.id, field: "notes", value: "hijack", baseVersion: 0, actor: COACH })
    ok("saving another workshop's entry is not found", !cross.ok && cross.status === 404)
    ok("deleting another workshop's entry is not found", !(await deleteEntry(db.client as any, OTHER_CC, e.data.id, COACH)).ok)
    const c = await addCapture(db.client as any, CC, "secret", COACH)
    if (!c.ok) return
    ok("another workshop's note is not reachable", !(await saveCapture(db.client as any, OTHER_CC, { captureId: c.data.id, value: "x", baseVersion: 1, actor: COACH })).ok)
    ok("and cannot be moved into another workshop's entry", !(await captureToEntry(db.client as any, CC, { captureId: c.data.id, entryId: "nope", mode: "move", actor: COACH })).ok)
  }

  console.log("\nQuick Capture")
  {
    const db = seed()
    await startWorkshop(db.client as any, CC, COACH)
    const e = await addEntry(db.client as any, CC, "experience", "Acme")
    if (!e.ok) return
    await saveEntryField(db.client as any, CC, { entryId: e.data.id, field: "notes", value: "Ran socials.", baseVersion: 0, actor: COACH })
    const c1 = await addCapture(db.client as any, CC, "Grew followers 40% (her estimate)", COACH)
    const c2 = await addCapture(db.client as any, CC, "Mentioned a podcast", COACH)
    const c3 = await addCapture(db.client as any, CC, "Loves data work", COACH)
    if (!c1.ok || !c2.ok || !c3.ok) return
    const cp = await captureToEntry(db.client as any, CC, { captureId: c1.data.id, entryId: e.data.id, mode: "copy", actor: COACH })
    ok("copy adds the text to the end of the entry", cp.ok && cp.data.entry.notes === "Ran socials.\n\nGrew followers 40% (her estimate)" && cp.data.entry.notes_version === 2)
    ok("copy keeps the note in Quick Capture", cp.ok && cp.data.capture.copied_to_entry_id === e.data.id && !cp.data.capture.moved_to_entry_id)
    const mv = await captureToEntry(db.client as any, CC, { captureId: c2.data.id, entryId: e.data.id, mode: "move", actor: COACH })
    ok("move adds the text and marks the note moved", mv.ok && mv.data.entry.notes.endsWith("\n\nMentioned a podcast") && mv.data.capture.moved_to_entry_id === e.data.id)
    const stale = await saveEntryField(db.client as any, CC, { entryId: e.data.id, field: "notes", value: "Ran socials.", baseVersion: 1, actor: COACH })
    ok("an open editor with old text cannot wipe out the added notes", !stale.ok && stale.status === 409)
    ok("an edited note saves", (await saveCapture(db.client as any, CC, { captureId: c3.data.id, value: "Loves data work, esp. dashboards", baseVersion: 1, actor: COACH })).ok)
    ok("delete a note", (await deleteCapture(db.client as any, CC, c3.data.id, COACH)).ok && (await getBundle(db.client as any, CC)).captures.length === 2)
  }

  console.log("\nthe resume on file is never changed")
  {
    const db = seed()
    const before = JSON.stringify([db.tables.client_personas, db.tables.client_profiles])
    await startWorkshop(db.client as any, CC, COACH)
    const b = await getBundle(db.client as any, CC)
    for (const e of b.entries) await saveEntryField(db.client as any, CC, { entryId: e.id, field: "notes", value: "coach notes", baseVersion: 0, actor: COACH })
    await setPastedResume(db.client as any, CC, "something pasted", COACH)
    ok("personas and profiles are untouched", JSON.stringify([db.tables.client_personas, db.tables.client_profiles]) === before)
    ok("imported resume text stays separate from notes", (await getBundle(db.client as any, CC)).entries.every((e) => e.notes === "coach notes" && e.resume_excerpt && !e.resume_excerpt.includes("coach notes")))
  }

  console.log("\nexport")
  {
    const db = seed()
    await startWorkshop(db.client as any, CC, COACH)
    const exp = (await getBundle(db.client as any, CC)).entries.find((e) => e.tab === "experience")!
    const tricky = "She said: \"I basically ran it\".\n\n# not a heading of ours\n- 40% (estimate)\n  indented line\n\nLast line, no summary."
    await saveEntryField(db.client as any, CC, { entryId: exp.id, field: "notes", value: tricky, baseVersion: 0, actor: COACH })
    const other = await addEntry(db.client as any, CC, "other", "Podcast idea")
    if (!other.ok) return
    await saveEntryField(db.client as any, CC, { entryId: other.data.id, field: "notes", value: "Wants to start one.", baseVersion: 0, actor: COACH })
    await saveGeneral(db.client as any, CC, { value: "Overall: strong on leadership.", baseVersion: 0, actor: COACH })
    const u = await addCapture(db.client as any, CC, "UNASSIGNED NOTE stays", COACH)
    const m = await addCapture(db.client as any, CC, "MOVED NOTE text", COACH)
    const c = await addCapture(db.client as any, CC, "COPIED NOTE text", COACH)
    if (!u.ok || !m.ok || !c.ok) return
    await captureToEntry(db.client as any, CC, { captureId: m.data.id, entryId: other.data.id, mode: "move", actor: COACH })
    await captureToEntry(db.client as any, CC, { captureId: c.data.id, entryId: other.data.id, mode: "copy", actor: COACH })
    const gone = await addEntry(db.client as any, CC, "skills", "DELETED ENTRY")
    if (gone.ok) await deleteEntry(db.client as any, CC, gone.data.id, COACH)

    const r = await buildExport(db.client as any, CC)
    ok("builds", r.ok)
    if (!r.ok) return
    const md = r.data.markdown
    ok("file name has the client and date", /^Resume-Workshop-Lily-Chen-\d{4}-\d{2}-\d{2}\.md$/.test(r.data.filename), r.data.filename)
    ok("client name, date and coach", md.includes("# Resume Workshop Notes: Lily Chen") && /- Workshop date: \d{4}-\d{2}-\d{2}/.test(md) && md.includes("- Coach: Peri Ginsberg"))
    ok("every tab appears, in order", TABS.every((t, i) => md.includes(`## ${i + 1}. ${TAB_LABEL[t]}`)))
    ok("empty tabs say so", md.includes("## 3. Honors / Awards\n\n_No entries._"))
    ok("notes are word for word", md.includes(tricky))
    ok("imported resume text is labelled and separate", md.includes("**From the original resume (imported, not coach notes):**") && md.includes("> Acme Corp, Marketing Intern, Summer 2025"))
    ok("general notes", md.includes("## General Workshop Notes\n\nOverall: strong on leadership."))
    ok("unassigned Quick Capture notes are included", md.includes("### Unassigned") && md.includes("UNASSIGNED NOTE stays"))
    ok("moved and copied notes are included, with where they went", md.includes("### Moved into an entry") && md.includes("MOVED NOTE text") && md.includes("COPIED NOTE text") && md.includes("(into Other Discoveries: Podcast idea)"))
    ok("moved text also appears in the entry", md.includes("Wants to start one.\n\nMOVED NOTE text\n\nCOPIED NOTE text"))
    ok("deleted entries are not exported", !md.includes("DELETED ENTRY"))
    ok("every entry title is present", (await getBundle(db.client as any, CC)).entries.every((e) => md.includes(`### ${e.title}`)))
  }
  {
    const db = seed({ resume: null })
    db.tables.client_profiles[1].resume_text = null
    await startWorkshop(db.client as any, CC, COACH)
    const r = await buildExport(db.client as any, CC)
    ok("an empty workshop still exports every section", r.ok && TABS.every((t) => r.data.markdown.includes(TAB_LABEL[t])) && r.data.markdown.includes("_No Quick Capture notes._"))
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
