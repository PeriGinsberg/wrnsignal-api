// lib/practice/questionBank.ts
//
// The twenty behavioural questions from Session 2, as the coach's starting
// point when building a practice round.
//
// READ FROM THE TEMPLATE, NOT RETYPED. The bank is authored in
// session-2-telling-your-stories.json and the client has already matched their
// stories against it; a second hand-typed copy here would drift from that the
// first time a question was reworded, and the coach would be practising a
// question the client never prepared for.

import sessionTwo from "../workbook/templates/session-2-telling-your-stories.json"

export type BankQuestion = {
  /** The template's key, e.g. "q07". Stable, and what the client matched on. */
  id: string
  text: string
  trait: string
}

/**
 * The Section 8 question labels, parsed back into question and trait.
 *
 * The template stores them as "Tell me about a time... [Resilience]", which is
 * what the client reads. The trailing bracket is the trait, and it is worth
 * splitting out so the coach can pick a spread rather than four questions that
 * all test composure.
 */
function parseLabel(label: string): { text: string; trait: string } {
  const m = label.match(/^(.*?)\s*\[([^\]]+)\]\s*$/)
  if (!m) return { text: label.trim(), trait: "" }
  return { text: m[1].trim(), trait: m[2].trim() }
}

let cache: BankQuestion[] | null = null

export function questionBank(): BankQuestion[] {
  if (cache) return cache
  const out: BankQuestion[] = []
  const sections = (sessionTwo as any).sections ?? []
  for (const s of sections) {
    for (const b of s.blocks ?? []) {
      if (b?.type !== "select" || typeof b.key !== "string") continue
      // Section 8's keys are "s2.match.q01.story"; the bank is exactly those.
      const m = b.key.match(/^s2\.match\.(q\d+)\.story$/)
      if (!m) continue
      const { text, trait } = parseLabel(String(b.label ?? ""))
      if (text) out.push({ id: m[1], text, trait })
    }
  }
  cache = out.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  return cache
}

/** Every distinct trait in the bank, for grouping the picker. */
export function bankTraits(): string[] {
  return [...new Set(questionBank().map((q) => q.trait).filter(Boolean))].sort()
}
