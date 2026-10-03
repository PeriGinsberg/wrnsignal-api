// Settings > Services > Phases.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"

vi.mock("../../../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

import { PhasesTab } from "./PhasesTab"
import { ServicesTabs } from "./ServicesTabs"

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/coach/settings/services",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=phases"),
}))

const DEFAULTS = ["Know", "Build", "Prove", "Search", "Land"].map((label, i) => ({
  id: `ph-${i}`, phase_key: label.toLowerCase(), label, sort_order: i + 1, active: true, is_custom: false,
}))
let puts: any[]
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } })

beforeEach(() => {
  puts = []
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body))
      puts.push(body)
      return json({ ok: true, phases: body.phases.map((p: any, i: number) => ({ id: p.id ?? `new-${i}`, phase_key: "k", label: p.label, sort_order: i + 1, active: p.active, is_custom: !p.id })) })
    }
    return json({ ok: true, phases: DEFAULTS, milestones: [] })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const names = () => screen.getAllByLabelText(/^Phase \d+ name$/).map((el) => (el as HTMLInputElement).value)

describe("Phases settings", () => {
  it("is a tab under Services, next to Deliverables and Packages", async () => {
    render(<ServicesTabs />)
    expect(screen.getByRole("button", { name: "Phases" })).toBeTruthy()
    await screen.findByDisplayValue("Know")
  })

  it("starts with Know, Build, Prove, Search, Land", async () => {
    render(<PhasesTab />)
    await screen.findByDisplayValue("Know")
    expect(names()).toEqual(["Know", "Build", "Prove", "Search", "Land"])
  })

  it("renames, reorders, switches off and adds, then saves them all at once", async () => {
    render(<PhasesTab />)
    await screen.findByDisplayValue("Know")
    fireEvent.change(screen.getByLabelText("Phase 1 name"), { target: { value: "Discover" } })
    fireEvent.click(screen.getByRole("button", { name: "Move Build up" }))
    fireEvent.click(screen.getByRole("button", { name: "Land active" }))
    fireEvent.change(screen.getByLabelText("New phase name"), { target: { value: "Grow" } })
    fireEvent.click(screen.getByRole("button", { name: "+ Add phase" }))
    expect(names()).toEqual(["Build", "Discover", "Prove", "Search", "Land", "Grow"])
    fireEvent.click(screen.getByRole("button", { name: "Save phases" }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].phases).toEqual([
      { id: "ph-1", label: "Build", active: true },
      { id: "ph-0", label: "Discover", active: true },
      { id: "ph-2", label: "Prove", active: true },
      { id: "ph-3", label: "Search", active: true },
      { id: "ph-4", label: "Land", active: false },
      { label: "Grow", active: true },
    ])
    expect(await screen.findByText("Phases saved.")).toBeTruthy()
  })

  it("has no delete: phases are switched off instead", async () => {
    render(<PhasesTab />)
    await screen.findByDisplayValue("Know")
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull()
  })

  it("Save is off until something changes", async () => {
    render(<PhasesTab />)
    await screen.findByDisplayValue("Know")
    expect((screen.getByRole("button", { name: "Save phases" }) as HTMLButtonElement).disabled).toBe(true)
  })
})
