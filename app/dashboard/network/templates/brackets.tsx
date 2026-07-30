"use client"

// Two kinds of bracket, two colours, following the same meaning→colour rule the rest of
// the networking function uses, applied inside a message body.
//
//   [NAME], [CITY], [CURRENT_ROLE]  auto-resolving  → calm, "this fills itself in"
//   [MUTUAL], [OPTION 1], prose     fill-at-send    → warm, "attention: you write this"
//
// Warm is "act here" everywhere else on the function (overdue, required-empty),
// and a blank you have to fill IS the part of the message that needs you. The
// split itself is not re-derived here: classifyVariable() in the 8b renderer is
// the one authority on which bracket is which.

import { T } from "../../../../lib/dashboard-theme"
import { classifyVariable, UNRESOLVED_PLACEHOLDER } from "../../../../lib/network-tracker/templates"

export type Segment = { text: string; kind: "plain" | "auto" | "fill" }

/** Split a body (or a rendered preview) into coloured runs. */
export function splitBrackets(text: string): Segment[] {
  const out: Segment[] = []
  // The placeholder is what an auto-resolving bracket becomes in the preview
  // when the profile has no value yet, and still an "it fills itself in" slot, so
  // it takes the same calm colour rather than reading as prose.
  const re = new RegExp(`(\\[[^\\]]+\\]|${UNRESOLVED_PLACEHOLDER})`, "g")
  let last = 0
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    if (at > last) out.push({ text: text.slice(last, at), kind: "plain" })
    const token = m[0]
    if (token === UNRESOLVED_PLACEHOLDER) out.push({ text: token, kind: "auto" })
    else out.push({ text: token, kind: classifyVariable(token.slice(1, -1)) === "fill" ? "fill" : "auto" })
    last = at + token.length
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: "plain" })
  return out
}

const COLOR: Record<Segment["kind"], string | undefined> = {
  plain: undefined,
  auto: T.MUTED,        // calm: no action implied
  fill: T.WRN_ORANGE,   // warm: this one is yours to write
}

/** The runs as coloured spans. Text content is unchanged, so anything reading
 *  textContent (or copying) still gets the exact body. */
export function BracketText({ text }: { text: string }) {
  return (
    <>
      {splitBrackets(text).map((s, i) => (
        <span
          key={i}
          data-bracket={s.kind === "plain" ? undefined : s.kind}
          style={s.kind === "fill"
            ? { color: COLOR.fill, fontWeight: 700 }
            : { color: COLOR[s.kind] }}
        >
          {s.text}
        </span>
      ))}
    </>
  )
}
