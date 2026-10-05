// The Drive workspace link on a client record, with Copy.

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"

vi.mock("../../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } }),
}))

import { DriveWorkspaceLink } from "./DriveWorkspaceLink"

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("Drive workspace link", () => {
  it("shows the workspace and copies its link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true, folder: null, workspace: { id: "f1", url: "https://drive.google.com/drive/folders/f1" } })))
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    render(<DriveWorkspaceLink coachClientId="cc-1" />)
    expect(await screen.findByText("https://drive.google.com/drive/folders/f1")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://drive.google.com/drive/folders/f1"))
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy()
  })

  it("shows nothing before Let's Go", async () => {
    const f = vi.fn(async () => json({ ok: true, folder: null, workspace: null }))
    vi.stubGlobal("fetch", f)
    render(<DriveWorkspaceLink coachClientId="cc-1" />)
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(screen.queryByTestId("drive-workspace")).toBeNull()
  })
})
