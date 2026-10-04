// lib/sow/build.ts
//
// A client's SOW, built from their package: the pure rules, no database. The
// service (./client.ts) gathers the inputs; the coach's preview and the
// prospect's page (Step 4) render the result with app/sow/SowView.tsx.
//
// What shows:
//   - one numbered stage per phase that has an included deliverable, in the
//     coach's phase order ("Stage One. Know: Your SIGNAL DNA and Career Paths");
//     deliverables with no phase come last, under "Also included"
//   - in each stage its deliverables in package order, each with its bullets,
//     then the phase's closing note
//   - Not needed deliverables are left out (removed ones no longer exist)
//   - the standard sections, each line filtered by the phases in the plan;
//     an empty section is left out
//   - the payment: the total (the client's price, else the package total) and
//     the terms

import { SOW_SECTIONS, SOW_SECTION_LABEL, bulletList, lineShows, type SowLine, type SowSection } from "./model"

// ── Payment ──────────────────────────────────────────────────────────────────

export type SowPayment =
  | { mode: "full" }
  | { mode: "split"; payments: { amount_cents: number; days: number }[] }

/** A package's starting terms: null is full up front. */
export type DefaultPayment = { mode: "split"; parts: { percent: number; days: number }[] } | null

export const SPLIT_MIN = 2
export const SPLIT_MAX = 6
export const PAYMENT_DAYS_MAX = 365

/**
 * A package's default terms as amounts for this total. Percentages are rounded
 * down to whole dollars and the last payment takes what is left, so the
 * payments always add up to the total.
 */
export function defaultPaymentFor(def: DefaultPayment | undefined, totalCents: number): SowPayment {
  if (!def || def.mode !== "split" || !Array.isArray(def.parts) || def.parts.length < SPLIT_MIN) return { mode: "full" }
  let left = totalCents
  const payments = def.parts.map((p, i) => {
    const amount = i === def.parts.length - 1 ? left : Math.floor((totalCents * p.percent) / 100 / 100) * 100
    left -= amount
    return { amount_cents: amount, days: p.days }
  })
  return { mode: "split", payments }
}

/** Check terms against a total. The message is for the coach. */
export function checkPayment(input: unknown, totalCents: number): { ok: true; value: SowPayment } | { ok: false; error: string } {
  const p = (input ?? {}) as Record<string, unknown>
  if (p.mode === "full") return { ok: true, value: { mode: "full" } }
  if (p.mode !== "split") return { ok: false, error: "Payment must be full up front or split." }
  if (!Array.isArray(p.payments) || p.payments.length < SPLIT_MIN || p.payments.length > SPLIT_MAX) {
    return { ok: false, error: `A split has ${SPLIT_MIN} to ${SPLIT_MAX} payments.` }
  }
  const payments: { amount_cents: number; days: number }[] = []
  for (const [i, raw] of p.payments.entries()) {
    const r = (raw ?? {}) as Record<string, unknown>
    const amount = r.amount_cents
    const days = r.days
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return { ok: false, error: `Payment ${i + 1} needs an amount above $0.` }
    if (typeof days !== "number" || !Number.isInteger(days) || days < 0 || days > PAYMENT_DAYS_MAX) {
      return { ok: false, error: `Payment ${i + 1} needs a whole number of days from 0 to ${PAYMENT_DAYS_MAX}.` }
    }
    if (i > 0 && days < payments[i - 1].days) return { ok: false, error: "Payments must be in date order." }
    payments.push({ amount_cents: amount, days })
  }
  const sum = payments.reduce((s, x) => s + x.amount_cents, 0)
  if (sum !== totalCents) {
    return { ok: false, error: `The payments add up to ${money(sum)}, not the total of ${money(totalCents)}.` }
  }
  return { ok: true, value: { mode: "split", payments } }
}

export function money(cents: number): string {
  const dollars = cents / 100
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2, maximumFractionDigits: 2 })}`
}

/** When a payment falls due, in words. */
export function dueLabel(days: number): string {
  if (days === 0) return "due at signing"
  return `due ${days} day${days === 1 ? "" : "s"} after signing`
}

// ── The document ─────────────────────────────────────────────────────────────

export type SowInputs = {
  clientName: string
  practiceName: string | null
  packageName: string
  opening: string | null
  phases: { id: string; label: string; sow_subtitle: string | null; sow_note: string | null; sort_order: number }[]
  deliverables: { name: string; phase_id: string | null; not_needed: boolean; sort_order: number; bullets: string | null }[]
  lines: SowLine[]
  totalCents: number
  payment: SowPayment
}

export type SowDocument = {
  client_name: string
  practice_name: string | null
  package_name: string
  opening: string | null
  stages: { heading: string; deliverables: { name: string; bullets: string[] }[]; note: string | null }[]
  sections: { key: SowSection; label: string; lines: string[] }[]
  payment: { total_cents: number; mode: "full" | "split"; payments: { amount_cents: number; days: number; label: string }[] }
}

const NUMBER_WORDS = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"]
export const stageWord = (n: number) => NUMBER_WORDS[n - 1] ?? String(n)

export function composeSow(input: SowInputs): SowDocument {
  const included = input.deliverables.filter((d) => !d.not_needed).sort((a, b) => a.sort_order - b.sort_order)
  const phases = [...input.phases].sort((a, b) => a.sort_order - b.sort_order)
  const known = new Set(phases.map((p) => p.id))
  const inPlan = new Set(included.map((d) => d.phase_id).filter((id): id is string => !!id && known.has(id)))

  const groups: { label: string; subtitle: string | null; note: string | null; items: typeof included }[] = []
  for (const p of phases) {
    const items = included.filter((d) => d.phase_id === p.id)
    if (items.length) groups.push({ label: p.label, subtitle: p.sow_subtitle, note: p.sow_note, items })
  }
  const loose = included.filter((d) => !d.phase_id || !known.has(d.phase_id))
  if (loose.length) groups.push({ label: "Also included", subtitle: null, note: null, items: loose })

  const stages = groups.map((g, i) => ({
    heading: `Stage ${stageWord(i + 1)}. ${g.label}${g.subtitle ? `: ${g.subtitle}` : ""}`,
    deliverables: g.items.map((d) => ({ name: d.name, bullets: bulletList(d.bullets) })),
    note: g.note,
  }))

  const sections = SOW_SECTIONS.map((key) => ({
    key,
    label: SOW_SECTION_LABEL[key],
    lines: input.lines
      .filter((l) => l.section === key && lineShows(l, inPlan))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => l.body),
  })).filter((s) => s.lines.length > 0)

  const payments = input.payment.mode === "split"
    ? input.payment.payments.map((p, i) => ({ ...p, label: `Payment ${i + 1}: ${money(p.amount_cents)}, ${dueLabel(p.days)}` }))
    : [{ amount_cents: input.totalCents, days: 0, label: `${money(input.totalCents)}, due in full at signing` }]

  return {
    client_name: input.clientName,
    practice_name: input.practiceName,
    package_name: input.packageName,
    opening: input.opening,
    stages,
    sections,
    payment: { total_cents: input.totalCents, mode: input.payment.mode, payments },
  }
}
