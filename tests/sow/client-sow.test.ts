#!/usr/bin/env tsx
// A client's SOW: the builder, the payment rules, and saving the coach's settings.
// Run: npx tsx tests/sow/client-sow.test.ts

import { makeFakeDb } from "../_lib/fakeSupabase"
import { checkPayment, composeSow, defaultPaymentFor, type SowInputs } from "../../lib/sow/build"
import { getClientSow, packageTotalCents, saveClientSow } from "../../lib/sow/client"

let pass = 0
let fail = 0
function ok(label: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok    ${label}`) }
  else { fail++; console.error(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`) }
}

const PHASES = [
  { id: "ph-know", label: "Know", sow_subtitle: "Your SIGNAL DNA and Career Paths", sow_note: "Not a personality test.", sort_order: 1 },
  { id: "ph-build", label: "Build", sow_subtitle: "Foundations", sow_note: null, sort_order: 2 },
  { id: "ph-land", label: "Land", sow_subtitle: "Interview Performance", sow_note: "Up to 8 hours.", sort_order: 5 },
]
const line = (id: string, section: any, body: string, show_for: any = "every_plan", phase_id: string | null = null, sort_order = 1) =>
  ({ id, section, body, show_for, phase_id, sort_order })

function inputs(over: Partial<SowInputs> = {}): SowInputs {
  return {
    clientName: "Aiden Park", practiceName: "Workforce Ready Now", packageName: "Know Where to Aim", opening: "Hi Aiden.",
    phases: PHASES,
    deliverables: [
      { name: "Resume", phase_id: "ph-build", not_needed: false, sort_order: 5, bullets: "Full rebuild\nATS-friendly" },
      { name: "DNA Report", phase_id: "ph-know", not_needed: false, sort_order: 2, bullets: "A written report" },
      { name: "DNA Assessment", phase_id: "ph-know", not_needed: false, sort_order: 1, bullets: null },
      { name: "Cover Letter", phase_id: "ph-build", not_needed: true, sort_order: 6, bullets: "Your voice" },
      { name: "Bonus call", phase_id: null, not_needed: false, sort_order: 9, bullets: null },
    ],
    lines: [
      line("l1", "included", "SIGNAL"),
      line("l2", "included", "Playbook", "phase_not_in_plan", "ph-land", 2),
      line("l3", "how_we_work", "Mock interviews are recorded", "phase_in_plan", "ph-land"),
      line("l4", "not_included", "No guarantee"),
    ],
    totalCents: 80000,
    payment: { mode: "full" },
    ...over,
  }
}

async function main() {
  console.log("the document")
  {
    const doc = composeSow(inputs())
    ok("numbered stages in phase order, with subtitles", doc.stages.map((s) => s.heading).join(" | ") ===
      "Stage One. Know: Your SIGNAL DNA and Career Paths | Stage Two. Build: Foundations | Stage Three. Also included")
    ok("deliverables in package order within a stage", doc.stages[0].deliverables.map((d) => d.name).join() === "DNA Assessment,DNA Report")
    ok("bullets per deliverable; none is an empty list", doc.stages[1].deliverables[0].bullets.join("|") === "Full rebuild|ATS-friendly" && doc.stages[0].deliverables[0].bullets.length === 0)
    ok("a Not needed deliverable is left out", !doc.stages.some((s) => s.deliverables.some((d) => d.name === "Cover Letter")))
    ok("the phase's closing note sits under its stage", doc.stages[0].note === "Not a personality test." && doc.stages[1].note === null)
    ok("a phase with nothing in the plan has no stage", !doc.stages.some((s) => s.heading.includes("Land")))
    ok("Land not in the plan: the Playbook line shows", doc.sections.find((s) => s.key === "included")!.lines.join() === "SIGNAL,Playbook")
    ok("and the Land-only line does not; its emptied section is left out", !doc.sections.some((s) => s.key === "how_we_work"))
    ok("sections in their fixed order", doc.sections.map((s) => s.key).join() === "included,not_included")
    ok("full payment reads as one line", doc.payment.payments.length === 1 && doc.payment.payments[0].label === "$800, due in full when you click Let's Go")

    const withLand = composeSow(inputs({ deliverables: [...inputs().deliverables, { name: "Mock Interview", phase_id: "ph-land", not_needed: false, sort_order: 7, bullets: null }] }))
    ok("Land in the plan: the Playbook line hides and the Land line shows",
      withLand.sections.find((s) => s.key === "included")!.lines.join() === "SIGNAL" && withLand.sections.some((s) => s.key === "how_we_work"))
    ok("and Land is numbered in plan order", withLand.stages.map((s) => s.heading.split(".")[0]).join() === "Stage One,Stage Two,Stage Three,Stage Four"
      && withLand.stages[2].heading === "Stage Three. Land: Interview Performance")
    const split = composeSow(inputs({ payment: { mode: "split", payments: [{ amount_cents: 87500, days: 0 }, { amount_cents: 87500, days: 45 }] } }))
    ok("split payments read in words", split.payment.payments.map((p) => p.label).join(" | ") ===
      "Payment 1: $875, due at signing | Payment 2: $875, due 45 days after signing")
  }

  console.log("\npayment rules")
  {
    const half = { mode: "split" as const, parts: [{ percent: 50, days: 0 }, { percent: 50, days: 45 }] }
    const d = defaultPaymentFor(half, 175000)
    ok("Run the Search: half at day 0, half at day 45", d.mode === "split" && d.payments.map((p) => `${p.amount_cents}@${p.days}`).join() === "87500@0,87500@45")
    const odd = defaultPaymentFor(half, 100050)
    ok("an odd total: whole dollars first, the rest last, adds up", odd.mode === "split" && odd.payments[0].amount_cents === 50000 && odd.payments[1].amount_cents === 50050)
    ok("no default is full up front", defaultPaymentFor(null, 50000).mode === "full")
    ok("a split must add up to the total", !checkPayment({ mode: "split", payments: [{ amount_cents: 100, days: 0 }, { amount_cents: 100, days: 30 }] }, 300).ok)
    ok("and passes when it does", checkPayment({ mode: "split", payments: [{ amount_cents: 100, days: 0 }, { amount_cents: 200, days: 30 }] }, 300).ok)
    ok("one payment is not a split", !checkPayment({ mode: "split", payments: [{ amount_cents: 300, days: 0 }] }, 300).ok)
    ok("seven payments is too many", !checkPayment({ mode: "split", payments: Array.from({ length: 7 }, () => ({ amount_cents: 1, days: 0 })) }, 7).ok)
    ok("payments in date order", !checkPayment({ mode: "split", payments: [{ amount_cents: 100, days: 30 }, { amount_cents: 200, days: 0 }] }, 300).ok)
    ok("no $0 payment", !checkPayment({ mode: "split", payments: [{ amount_cents: 0, days: 0 }, { amount_cents: 300, days: 30 }] }, 300).ok)
    ok("days are whole and not negative", !checkPayment({ mode: "split", payments: [{ amount_cents: 100, days: -1 }, { amount_cents: 200, days: 30 }] }, 300).ok
      && !checkPayment({ mode: "split", payments: [{ amount_cents: 100, days: 1.5 }, { amount_cents: 200, days: 30 }] }, 300).ok)
    ok("unknown terms refused", !checkPayment({ mode: "barter" }, 300).ok)
  }

  console.log("\nthe package price")
  {
    ok("Not needed deliverables are not charged for", packageTotalCents([{ fee_cents: 10000 }, { fee_cents: 5000, not_needed: true }], null) === 10000)
    ok("the discount never takes it below $0", packageTotalCents([{ fee_cents: 10000 }, { fee_cents: 5000, not_needed: true }], 30000) === 0)
  }

  console.log("\nsaving a client's SOW")
  {
    const db = makeFakeDb({
      coach_clients: [{ id: "cc-1", coach_profile_id: "coach-1", name: "Aiden Park", client_profile_id: null }],
      client_profiles: [{ id: "coach-1", coach_org: "Workforce Ready Now" }],
      coach_packages: [{ id: "pkg-rts", default_payment: { mode: "split", parts: [{ percent: 50, days: 0 }, { percent: 50, days: 45 }] } }],
      coach_client_engagements: [
        { id: "eng-1", coach_client_id: "cc-1", name: "Run the Search", discount_cents: 30000, source_package_id: "pkg-rts", proposal_status: "draft" },
        { id: "eng-ok", coach_client_id: "cc-1", name: "Done", discount_cents: null, source_package_id: null, proposal_status: "approved" },
        { id: "eng-x", coach_client_id: "cc-other", name: "Theirs", discount_cents: null, source_package_id: null, proposal_status: "draft" },
      ],
      coach_client_engagement_deliverables: [
        { id: "d1", engagement_id: "eng-1", name: "DNA Report", phase_id: "ph-know", not_needed: false, sort_order: 1, fee_cents: 100000, source_milestone_id: "m1" },
        { id: "d2", engagement_id: "eng-1", name: "Resume", phase_id: "ph-build", not_needed: false, sort_order: 2, fee_cents: 105000, source_milestone_id: "m2" },
        { id: "d3", engagement_id: "eng-1", name: "Cover Letter", phase_id: "ph-build", not_needed: true, sort_order: 3, fee_cents: 12500, source_milestone_id: "m3" },
      ],
      coach_milestones: [{ id: "m1", sow_bullets: "A written report" }, { id: "m2", sow_bullets: null }, { id: "m3", sow_bullets: "x" }],
      coach_phases: PHASES.map((p) => ({ ...p, coach_profile_id: "coach-1" })),
      coach_sow_lines: [],
      coach_sow_settings: [{ coach_profile_id: "coach-1", default_opening: "Hi [First Name],\n\nThank you for your time." }],
      client_sows: [],
    })
    const c = db.client as any
    const first = await getClientSow(c, "cc-1", "eng-1")
    ok("reads", first.ok, first.ok ? "" : first.error)
    if (!first.ok) return
    ok("the package total skips Not needed and takes the discount", first.data.package_total_cents === 175000 && first.data.total_cents === 175000)
    ok("an unsaved SOW starts from the package's default: half now, half at 45 days", first.data.payment.mode === "split"
      && first.data.payment.payments.map((p) => `${p.amount_cents}@${p.days}`).join() === "87500@0,87500@45")
    ok("reading writes nothing", db.tables.client_sows.length === 0 && !first.data.saved)
    ok("a deliverable without bullets is a warning", first.data.warnings.some((w) => w.includes("No SOW bullets for Resume")))
    ok("the document names the client", first.data.document.client_name === "Aiden Park" && first.data.document.stages.length === 2)
    ok("a new SOW starts with the default opening, first name filled", first.data.opening === "Hi Aiden,\n\nThank you for your time."
      && first.data.document.opening === first.data.opening)

    const saved = await saveClientSow(c, { coachClientId: "cc-1", engagementId: "eng-1", actor: "coach-1", input: {
      opening: "  Welcome, Aiden.  ", price_override_cents: 160000,
      payment: { mode: "split", payments: [{ amount_cents: 80000, days: 0 }, { amount_cents: 80000, days: 30 }] },
    } })
    ok("saves the opening, a price for this client and a split", saved.ok && saved.data.saved && saved.data.opening === "Welcome, Aiden."
      && saved.data.total_cents === 160000 && saved.data.document.payment.total_cents === 160000, saved.ok ? "" : saved.error)
    ok("one row per package", db.tables.client_sows.length === 1 && db.tables.client_sows[0].status === "draft")
    const again = await saveClientSow(c, { coachClientId: "cc-1", engagementId: "eng-1", actor: "coach-1", input: { opening: null, price_override_cents: null, payment: { mode: "full" } } })
    ok("saving again updates the same row; no price means the package total", again.ok && db.tables.client_sows.length === 1 && again.data.total_cents === 175000)
    db.tables.coach_sow_settings[0].default_opening = "A new default"
    const kept = await getClientSow(c, "cc-1", "eng-1")
    ok("a saved SOW keeps its own opening (here, cleared) when the default changes", kept.ok && kept.data.opening === null)

    const bad = (input: unknown) => saveClientSow(c, { coachClientId: "cc-1", engagementId: "eng-1", actor: "coach-1", input })
    ok("a split that doesn't add up to the price is refused", !(await bad({ price_override_cents: 160000, payment: { mode: "split", payments: [{ amount_cents: 87500, days: 0 }, { amount_cents: 87500, days: 45 }] } })).ok)
    ok("a negative price is refused", !(await bad({ price_override_cents: -1, payment: { mode: "full" } })).ok)
    ok("an opening over 3,000 characters is refused", !(await bad({ opening: "x".repeat(3001), payment: { mode: "full" } })).ok)
    ok("an approved package's SOW can't be changed", !(await saveClientSow(c, { coachClientId: "cc-1", engagementId: "eng-ok", actor: "coach-1", input: { payment: { mode: "full" } } })).ok)
    ok("another client's package is not found", !(await getClientSow(c, "cc-1", "eng-x")).ok)
    db.tables.client_sows[0].status = "sent"
    ok("a sent SOW is not edited in place", !(await bad({ payment: { mode: "full" } })).ok)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
