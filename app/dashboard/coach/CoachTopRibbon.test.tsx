// The Coaches Dashboard ribbon: nothing listed before two characters, matches
// after, Enter opens the only or highlighted match, "No clients found." when
// none, and the two buttons call their flows.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))
vi.mock("../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

import { CoachTopRibbon } from "./CoachTopRibbon"

const ROSTER = [
  { id: "1", name: "Lily Chen", href: "/dashboard/coach/clients/p1" },
  { id: "2", name: "Liam Brown", href: "/dashboard/coach/coach-clients/cc2" },
]
let calls: string[] = []

beforeEach(() => {
  push.mockReset()
  calls = []
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url)
    const q = new URL(url, "http://x").searchParams.get("q")!.toLowerCase()
    const clients = ROSTER.filter((c) => c.name.toLowerCase().split(" ").some((w) => w.startsWith(q)))
    return { ok: true, json: async () => ({ ok: true, clients }) } as Response
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const box = () => document.querySelector('input[role="combobox"]') as HTMLInputElement
// Options are read straight from the DOM: the role query helper throws on this
// combobox in jsdom ("object null is not iterable") though the markup is right.
const opts = () => [...document.querySelectorAll('[role="option"]')] as HTMLElement[]
const type = (v: string) => { fireEvent.focus(box()); fireEvent.change(box(), { target: { value: v } }) }

describe("CoachTopRibbon", () => {
  it("lists nothing and does not search before two characters", async () => {
    render(<CoachTopRibbon onAddClient={() => {}} onAddProspect={() => {}} />)
    type("l")
    await new Promise((r) => setTimeout(r, 300))
    expect(calls).toHaveLength(0)
    expect(document.querySelector('[role="listbox"]')).toBeNull()
  })

  it("shows matches after two characters", async () => {
    render(<CoachTopRibbon onAddClient={() => {}} onAddProspect={() => {}} />)
    type("li")
    await waitFor(() => expect(opts().map((o) => o.textContent)).toEqual(["Lily Chen", "Liam Brown"]))
  })

  it("Enter opens the only match", async () => {
    render(<CoachTopRibbon onAddClient={() => {}} onAddProspect={() => {}} />)
    type("chen")
    await waitFor(() => expect(opts()).toHaveLength(1))
    fireEvent.keyDown(box(), { key: "Enter" })
    expect(push).toHaveBeenCalledWith("/dashboard/coach/clients/p1")
  })

  it("arrow keys highlight, Enter opens the highlighted match", async () => {
    render(<CoachTopRibbon onAddClient={() => {}} onAddProspect={() => {}} />)
    type("li")
    await waitFor(() => expect(opts()).toHaveLength(2))
    fireEvent.keyDown(box(), { key: "ArrowDown" })
    fireEvent.keyDown(box(), { key: "ArrowDown" })
    fireEvent.keyDown(box(), { key: "Enter" })
    expect(push).toHaveBeenCalledWith("/dashboard/coach/coach-clients/cc2")
  })

  it("Enter with several matches and none highlighted does nothing", async () => {
    render(<CoachTopRibbon onAddClient={() => {}} onAddProspect={() => {}} />)
    type("li")
    await waitFor(() => expect(opts()).toHaveLength(2))
    fireEvent.keyDown(box(), { key: "Enter" })
    expect(push).not.toHaveBeenCalled()
  })

  it("clicking a match opens it", async () => {
    render(<CoachTopRibbon onAddClient={() => {}} onAddProspect={() => {}} />)
    type("liam")
    await waitFor(() => expect(opts()).toHaveLength(1))
    fireEvent.mouseDown(opts()[0])
    expect(push).toHaveBeenCalledWith("/dashboard/coach/coach-clients/cc2")
  })

  it("says No clients found.", async () => {
    render(<CoachTopRibbon onAddClient={() => {}} onAddProspect={() => {}} />)
    type("zz")
    await waitFor(() => expect(screen.getByText("No clients found.")).toBeTruthy())
  })

  it("the buttons call their flows", () => {
    const addClient = vi.fn()
    const addProspect = vi.fn()
    render(<CoachTopRibbon onAddClient={addClient} onAddProspect={addProspect} />)
    fireEvent.click(screen.getByRole("button", { name: "+ Add Client" }))
    fireEvent.click(screen.getByRole("button", { name: "+ Add Prospect" }))
    expect(addClient).toHaveBeenCalledOnce()
    expect(addProspect).toHaveBeenCalledOnce()
  })
})
