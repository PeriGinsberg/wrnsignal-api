// lib/email/cc.ts
//
// The CC on an email a coach writes to a client (Message, a step release, the
// welcome email, the SOW): the parent when ticked, plus any addresses the
// coach types. Typed fresh on each send; nothing is remembered.
//
// Pure, so the compose boxes use the same split and check as the server.

export const CC_MAX = 10
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/

/** What a coach typed: addresses separated by commas, semicolons or spaces. */
export function splitCc(raw: string): string[] {
  return raw.split(/[\s,;]+/).filter(Boolean)
}

/** The first typed address that isn't one, for the compose box to point at. */
export function badCc(raw: string): string | null {
  return splitCc(raw).find((a) => !EMAIL.test(a)) ?? null
}

/**
 * The CC line to send: the parent (when ticked) and the typed addresses, in
 * that order, each once, never the client's own address. Null when empty.
 */
export function resolveCc(args: {
  ccParent: unknown
  cc: unknown
  parentEmail: string | null
  to: string
}): { ok: true; cc: string | null } | { ok: false; error: string } {
  const parent = args.parentEmail?.trim() || null
  if (args.ccParent === true && !parent) return { ok: false, error: "There is no parent email on this record to copy." }
  if (args.cc != null && typeof args.cc !== "string") return { ok: false, error: "CC must be a list of email addresses." }
  const typed = splitCc(args.cc ?? "")
  const bad = typed.find((a) => !EMAIL.test(a))
  if (bad) return { ok: false, error: `"${bad}" in CC isn't an email address.` }

  const seen = new Set([args.to.trim().toLowerCase()])
  const out: string[] = []
  for (const a of [...(args.ccParent === true ? [parent!] : []), ...typed]) {
    const k = a.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(a)
  }
  if (out.length > CC_MAX) return { ok: false, error: `CC can have at most ${CC_MAX} addresses.` }
  return { ok: true, cc: out.length ? out.join(", ") : null }
}
