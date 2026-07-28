#!/usr/bin/env tsx
// Phase 8a — the merge is the whole of 8a's logic, so this is where "GET returns
// 24 for a client with no overrides, and an edited one comes back as an
// override" is actually proved.

import {
  mergeTemplates, TEMPLATE_IDS, DEFAULTS_BY_ID, isKnownTemplateId,
  extractVariables, classifyVariable, FILL_AT_SEND_VARIABLES,
} from "./templates"
import { TEMPLATE_DEFAULTS } from "./template-defaults"

let pass = 0, fail = 0
const ok = (l: string, c: boolean) => { c ? (pass++, console.log(`✓ ${l}`)) : (fail++, console.error(`✗ ${l}`)) }

console.log("network templates — 8a")

// ── the defaults themselves ─────────────────────────────────────────────────
ok("24 defaults, no more no less", TEMPLATE_DEFAULTS.length === 24)
ok("ids are unique", new Set(TEMPLATE_IDS).size === 24)
ok("every default has a label and a body",
  TEMPLATE_DEFAULTS.every((t) => t.label.trim().length > 0 && t.body.trim().length > 0))
ok("the spec's families are all present",
  ["IN","P1","P2","P3","A1","A2","A3","R1","R2","R3","C1","C2","C3","X1","X2","X3","S1","S2","S3","S4","S5","L1","L2","L3"]
    .every((id) => isKnownTemplateId(id)))
ok("an unknown id is rejected", !isKnownTemplateId("Z9"))

// ── the 8a acceptance criterion ─────────────────────────────────────────────
{
  const none = mergeTemplates([])
  ok("no overrides -> still 24 templates", none.length === 24)
  ok("…all marked source:'default'", none.every((t) => t.source === "default"))
  ok("…with the code bodies verbatim", none[0].body === DEFAULTS_BY_ID[none[0].template_id].body)
}
{
  const merged = mergeTemplates([
    { template_id: "C2", body: "my own words", edited_by: "client", updated_at: "2026-07-28T00:00:00Z" },
  ])
  const c2 = merged.find((t) => t.template_id === "C2")!
  ok("an edited template comes back as source:'override'", c2.source === "override")
  ok("…with the edited body", c2.body === "my own words")
  ok("…and who edited it", c2.edited_by === "client")
  ok("the other 23 stay defaults", merged.filter((t) => t.source === "default").length === 23)
  ok("the list is still 24 long", merged.length === 24)
}

// Order is the defaults' order, NOT overrides-first: a client who edited three
// templates must still find every template where it was before.
{
  const merged = mergeTemplates([
    { template_id: "S5", body: "x", edited_by: "coach" },
    { template_id: "IN", body: "y", edited_by: "client" },
  ])
  ok("order follows the defaults, not the overrides",
    merged.map((t) => t.template_id).join(",") === TEMPLATE_IDS.join(","))
}

// The label describes what the template is FOR; editing the wording does not
// change that, so it always comes from the default.
{
  const merged = mergeTemplates([{ template_id: "P2", body: "rewritten", edited_by: "client" }])
  const p2 = merged.find((t) => t.template_id === "P2")!
  ok("label still comes from the default even when overridden", p2.label === DEFAULTS_BY_ID.P2.label)
}

// An override for a template that no longer exists is ignored, not surfaced.
{
  const merged = mergeTemplates([{ template_id: "GONE", body: "orphan", edited_by: "client" }])
  ok("an orphan override is ignored", merged.length === 24 && !merged.some((t) => t.body === "orphan"))
}

// ── variable vocabulary (defined in 8a, acted on in 8b) ─────────────────────
// The point of pinning this now: nothing in 8a may treat a fill-at-send prompt
// as malformed, and these tokens are the ones that would break a naive rule.
{
  const s1 = DEFAULTS_BY_ID.S1.body
  const vars = extractVariables(s1)
  ok("S1 (scheduling) really does carry OPTION blanks",
    vars.some((v) => v.startsWith("OPTION")))
  ok("…and they classify as fill-at-send, not as errors",
    vars.filter((v) => v.startsWith("OPTION")).every((v) => classifyVariable(v) === "fill"))

  ok("[MUTUAL] is fill-at-send despite being a single token", classifyVariable("MUTUAL") === "fill")
  ok("a slashed prompt is fill-at-send", classifyVariable("ARTICLE / NEWS ABOUT THEIR FIRM") === "fill")
  ok("[NAME] is a contact variable", classifyVariable("NAME") === "contact")
  ok("[FIRM] is a contact variable", classifyVariable("FIRM") === "contact")
  ok("[TARGET_ROLE] is a profile variable", classifyVariable("TARGET_ROLE") === "profile")
  ok("[CURRENT_ROLE] keeps its token name despite the column rename",
    classifyVariable("CURRENT_ROLE") === "profile")

  // Every fill-at-send token the doc lists must survive extraction from a real
  // body — this is what stops 8b flagging them as unresolved.
  const allVars = new Set(TEMPLATE_DEFAULTS.flatMap((t) => extractVariables(t.body)))
  const fillsInUse = [...allVars].filter((v) => FILL_AT_SEND_VARIABLES.has(v))
  ok(`fill-at-send prompts appear in the real bodies (${fillsInUse.length} of them)`, fillsInUse.length >= 5)
  ok("no body contains an empty bracket", ![...allVars].some((v) => !v.trim()))
}

console.log(`\n${pass}/${pass + fail} assertions passed`)
if (fail > 0) process.exit(1)
