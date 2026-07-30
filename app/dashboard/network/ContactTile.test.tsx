// The tile's whole job is to be the SAME mark everywhere a person appears, so
// what is worth pinning is not the hex but the fact that it is derived from the
// one shared rule rather than a second copy of it.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { ContactTile, initialsOf } from "./ContactTile"
import { stagePillStyle } from "./vocab"

afterEach(cleanup)

// jsdom re-serialises every colour, so an expectation written as a token string
// never matches the DOM's form. Rendering the expected style through the SAME
// path is what makes the comparison honest rather than a string-format test.
function reference(stage: string) {
  render(<span data-testid={`ref-${stage}`} style={stagePillStyle(stage)} />)
  const el = screen.getByTestId(`ref-${stage}`)
  return { color: el.style.color, background: el.style.background }
}

const c = (over: Record<string, unknown> = {}) =>
  ({ first_name: "Jordan", last_name: "Alvarez", stage: "replied", ...over }) as
    { first_name: string; last_name: string; stage: string }

describe("the contact tile", () => {
  it("takes its colour from the same rule the stage pill uses", () => {
    render(<ContactTile contact={c({ stage: "replied" })} />)
    const el = screen.getByTestId("contact-tile")
    // stagePillStyle is the single derivation. If the tile ever grows its own,
    // this stops matching.
    const expected = reference("replied")
    expect(el.style.color).toBe(expected.color)
    expect(el.style.background).toBe(expected.background)
  })

  it("gives a not-started contact the flat neutral, and a worked one its phase colour", () => {
    render(<ContactTile contact={c({ stage: "identified" })} testId="idle-tile" />)
    render(<ContactTile contact={c({ stage: "chat_done" })} testId="worked-tile" />)

    const idle = screen.getByTestId("idle-tile").style.color
    const worked = screen.getByTestId("worked-tile").style.color

    // identified maps to the idle phase, whose colour IS the neutral, so the
    // grey is a consequence of the phase rule rather than a special case.
    expect(idle).toBe(reference("identified").color)
    expect(worked).toBe(reference("chat_done").color)
    expect(idle).not.toBe(worked)
  })

  it("shows two letters, and copes with a missing half of the name", () => {
    expect(initialsOf({ first_name: "Jordan", last_name: "Alvarez" })).toBe("JA")
    expect(initialsOf({ first_name: "Jordan", last_name: "" })).toBe("J")
    expect(initialsOf({ first_name: "", last_name: "" })).toBe("?")
    expect(initialsOf({ first_name: null, last_name: null })).toBe("?")

    render(<ContactTile contact={c()} />)
    expect(screen.getByTestId("contact-tile").textContent).toBe("JA")
  })

  it("scales as a rounded square, so the header can run a larger one", () => {
    render(<ContactTile contact={c()} size={46} testId="big" />)
    const el = screen.getByTestId("big")
    expect(el.style.width).toBe("46px")
    expect(el.style.height).toBe("46px")
    expect(el.style.borderRadius).toBe("14px")   // 30% of the edge, not a circle
  })
})
