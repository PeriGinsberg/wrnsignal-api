// The case library. Add a case: write its file next to this one and list it
// here. COACH ONLY: never import this from a "use client" file (see types.ts).

import type { CaseDefinition } from "../types"
import { meridianCardBaseline } from "./meridian-card-baseline"

export const CASES: Record<string, CaseDefinition> = {
  [meridianCardBaseline.id]: meridianCardBaseline,
}

export function getCase(id: string | null | undefined): CaseDefinition | null {
  return id ? CASES[id] ?? null : null
}

/** A case's problems, or [] when it is well formed. Run by the tests and the create script. */
export function caseErrors(c: CaseDefinition): string[] {
  const errs: string[] = []
  const keys = new Set<string>()
  if (!c.questions.length) errs.push(`${c.id}: no questions`)
  for (const q of c.questions) {
    if (keys.has(q.qkey)) errs.push(`${c.id}: duplicate qkey ${q.qkey}`)
    keys.add(q.qkey)
    if (!q.text.trim()) errs.push(`${c.id}.${q.qkey}: no question text`)
    if (q.text.length > 400) errs.push(`${c.id}.${q.qkey}: question text over 400 characters`)
    if (!(q.answer_seconds >= 10 && q.answer_seconds <= 900)) errs.push(`${c.id}.${q.qkey}: answer_seconds out of 10-900`)
    if (q.prep_seconds != null && !(q.prep_seconds >= 0 && q.prep_seconds <= 600)) errs.push(`${c.id}.${q.qkey}: prep_seconds out of 0-600`)
  }
  const sk = new Set<string>()
  for (const s of c.self_assessment) {
    if (sk.has(s.key)) errs.push(`${c.id}: duplicate self-assessment key ${s.key}`)
    sk.add(s.key)
  }
  return errs
}
