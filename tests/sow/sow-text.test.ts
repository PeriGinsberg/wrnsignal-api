#!/usr/bin/env tsx
// SOW text in Settings: deliverable bullets, phase SOW text, standard lines.
// Run: npx tsx tests/sow/sow-text.test.ts

import { makeFakeDb } from "../_lib/fakeSupabase"
import { bulletList, lineShows, normalizeBullets, normalizeText } from "../../lib/sow/model"
import { getSowLines, saveSowLines } from "../../lib/sow/service"
import { ensurePhases, savePhases } from "../../lib/phases/service"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const COACH = "coach-1"
const OTHER = "coach-2"

function seed() {
  return makeFakeDb({
    coach_phases: [
      ...["Know", "Build", "Prove", "Search", "Land"].map((label, i) => ({
        id: `ph-${label.toLowerCase()}`, coach_profile_id: COACH, phase_key: label.toLowerCase(), label,
        sort_order: i + 1, active: true, is_custom: false, sow_subtitle: null, sow_note: null,
      })),
      { id: "ph-theirs", coach_profile_id: OTHER, phase_key: "know", label: "Know", sort_order: 1, active: true, is_custom: false },
    ],
    coach_sow_lines: [],
  })
}
const line = (section: string, body: string, show_for = "every_plan", phase_id: string | null = null) => ({ section, body, show_for, phase_id })

async function main() {
  console.log("bullets")
  {
    const r = normalizeBullets("- Live 1-on-1 workshop\n\n  • ATS-friendly structure  \r\n* Multiple versions\n")
    ok("one per line; markers and blank lines dropped", "value" in r && r.value === "Live 1-on-1 workshop\nATS-friendly structure\nMultiple versions")
    ok("nothing left means no bullets", "value" in normalizeBullets("  \n - \n") && (normalizeBullets("  \n - \n") as any).value === null)
    ok("too long is refused", "error" in normalizeBullets("x".repeat(2001)))
    ok("not text is refused", "error" in normalizeBullets(42))
    ok("listed back as bullets", bulletList("a\nb\n\nc").join("|") === "a|b|c" && bulletList(null).length === 0)
    ok("prose: trimmed, empty is null", (normalizeText("  hi  ", 10, "x") as any).value === "hi" && (normalizeText("   ", 10, "x") as any).value === null)
  }

  console.log("\nwhich standard lines show")
  {
    const plan = new Set(["ph-know", "ph-build"])
    ok("every plan always shows", lineShows({ show_for: "every_plan", phase_id: null }, plan))
    ok("in-plan line shows when its phase is in the plan", lineShows({ show_for: "phase_in_plan", phase_id: "ph-know" }, plan))
    ok("and not when it isn't", !lineShows({ show_for: "phase_in_plan", phase_id: "ph-land" }, plan))
    ok("the Playbook line shows when Land is NOT in the plan", lineShows({ show_for: "phase_not_in_plan", phase_id: "ph-land" }, plan))
    ok("and hides when Land is in the plan", !lineShows({ show_for: "phase_not_in_plan", phase_id: "ph-land" }, new Set(["ph-land"])))
    ok("a tied line whose phase is gone reads as every plan", lineShows({ show_for: "phase_not_in_plan", phase_id: null }, plan))
  }

  console.log("\nsaving standard lines")
  {
    const db = seed()
    const r = await saveSowLines(db.client as any, COACH, [
      line("not_included", "No guarantee of job placement"),
      line("included", "SIGNAL, including application tracking"),
      line("included", "Ultimate Interview Playbook", "phase_not_in_plan", "ph-land"),
      line("how_we_work", "Mock interviews are recorded", "phase_in_plan", "ph-land"),
    ])
    ok("saves", r.ok, r.ok ? "" : r.error)
    const lines = await getSowLines(db.client as any, COACH)
    ok("read back by section, then order", lines.map((l) => l.section).join() === "included,included,how_we_work,not_included")
    ok("order within a section is kept", lines[0].body.startsWith("SIGNAL") && lines[1].sort_order === 2)
    ok("the not-in-plan tie is kept", lines[1].show_for === "phase_not_in_plan" && lines[1].phase_id === "ph-land")

    const again = await saveSowLines(db.client as any, COACH, [line("included", "Only this one")])
    ok("a save replaces the whole set", again.ok && (await getSowLines(db.client as any, COACH)).map((l) => l.body).join() === "Only this one")
    ok("an every-plan line drops any phase it was sent", (await saveSowLines(db.client as any, COACH, [line("included", "x", "every_plan", "ph-land")])).ok
      && (await getSowLines(db.client as any, COACH))[0].phase_id === null)
  }

  console.log("\nrefused")
  {
    const db = seed()
    await saveSowLines(db.client as any, COACH, [line("included", "Keep me")])
    const bad = async (rows: unknown, why: string) => {
      const r = await saveSowLines(db.client as any, COACH, rows)
      ok(why, !r.ok)
    }
    await bad([line("bonus", "x")], "an unknown section")
    await bad([line("included", "   ")], "an empty line")
    await bad([line("included", "x".repeat(1001))], "a line over 1,000 characters")
    await bad([line("included", "x", "sometimes", "ph-land")], "an unknown Show for")
    await bad([line("included", "x", "phase_in_plan", null)], "a phase-tied line with no phase")
    await bad([line("included", "x", "phase_in_plan", "ph-theirs")], "another coach's phase")
    await bad(Array.from({ length: 51 }, () => line("included", "x")), "more than 50 lines in a section")
    await bad("nope", "not a list")
    ok("a refused save leaves the lines as they were", (await getSowLines(db.client as any, COACH)).map((l) => l.body).join() === "Keep me")
    ok("another coach sees none of them", (await getSowLines(db.client as any, OTHER)).length === 0)
  }

  console.log("\nphase SOW text")
  {
    const db = seed()
    const phases = await ensurePhases(db.client as any, COACH)
    const list = phases.map((p) => ({ id: p.id, label: p.label, active: p.active }))
    list[0] = { ...list[0], sow_subtitle: "  Your SIGNAL DNA and Career Paths ", sow_note: "Not a personality test." } as any
    const r = await savePhases(db.client as any, COACH, list)
    ok("saves a subtitle and a closing note", r.ok && r.data[0].sow_subtitle === "Your SIGNAL DNA and Career Paths" && r.data[0].sow_note === "Not a personality test.")
    const keep = await savePhases(db.client as any, COACH, list.map(({ id, label, active }) => ({ id, label, active })))
    ok("an entry without SOW fields keeps what is stored", keep.ok && keep.data[0].sow_subtitle === "Your SIGNAL DNA and Career Paths")
    const clear = await savePhases(db.client as any, COACH, list.map((p, i) => (i === 0 ? { ...p, sow_subtitle: "", sow_note: null } : p)))
    ok("blank clears it", clear.ok && clear.data[0].sow_subtitle === null && clear.data[0].sow_note === null)
    ok("a subtitle over 80 characters is refused", !(await savePhases(db.client as any, COACH, list.map((p, i) => (i === 0 ? { ...p, sow_subtitle: "x".repeat(81) } : p)))).ok)
    ok("a note over 1,000 characters is refused", !(await savePhases(db.client as any, COACH, list.map((p, i) => (i === 0 ? { ...p, sow_note: "x".repeat(1001) } : p)))).ok)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
