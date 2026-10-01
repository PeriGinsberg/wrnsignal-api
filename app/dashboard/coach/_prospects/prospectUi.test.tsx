// The prospect workflow's shared pieces: lead source (with Other and Referred
// by), parent contact, and the confirm-the-chain dialog with the lost reason.

import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { useState } from "react"
import { LeadSourceBadge, LeadSourceFields, ParentFields, leadSourcePayload, type LeadSourceValue } from "./leadSourceUi"
import { ChainConfirmDialog, LostReasonFields, lostInputValid, type LostInput } from "./dialogs"

afterEach(() => cleanup())

function Lead({ initial }: { initial: Partial<LeadSourceValue> }) {
  const [v, setV] = useState<LeadSourceValue>({ source_category: "", source_detail: "", referred_by_name: "", referred_by_email: "", ...initial })
  return (
    <>
      <LeadSourceFields idPrefix="t" value={v} onChange={setV} />
      <output data-testid="payload">{JSON.stringify(leadSourcePayload(v))}</output>
    </>
  )
}

describe("LeadSourceFields", () => {
  it("offers the eight sources, in order", () => {
    render(<Lead initial={{}} />)
    const select = screen.getByLabelText("HOW DID THEY HEAR ABOUT US?") as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Select…", "A friend or family member", "A past client of Peri's", "Facebook group or online community",
      "Instagram or TikTok", "Google search", "Saw an ad", "A free guide or resource I downloaded", "Other",
    ])
  })
  it("asks for Referred by only for a friend/family member or a past client", () => {
    render(<Lead initial={{}} />)
    const select = screen.getByLabelText("HOW DID THEY HEAR ABOUT US?")
    expect(screen.queryByLabelText(/REFERRED BY/)).toBeNull()
    fireEvent.change(select, { target: { value: "past_client" } })
    expect(screen.getByLabelText(/REFERRED BY/)).toBeTruthy()
    expect(screen.getByLabelText(/THEIR EMAIL/)).toBeTruthy()
    fireEvent.change(select, { target: { value: "google_search" } })
    expect(screen.queryByLabelText(/REFERRED BY/)).toBeNull()
  })
  it("asks Other to specify", () => {
    render(<Lead initial={{}} />)
    fireEvent.change(screen.getByLabelText("HOW DID THEY HEAR ABOUT US?"), { target: { value: "other" } })
    fireEvent.change(screen.getByLabelText("PLEASE SPECIFY"), { target: { value: "Career fair" } })
    expect(JSON.parse(screen.getByTestId("payload").textContent!)).toEqual({ source_category: "other", source_detail: "Career fair" })
  })
  it("sends referred-by with a referral source, and never with another", () => {
    render(<Lead initial={{ source_category: "friend_family", referred_by_name: " Dana ", referred_by_email: "" }} />)
    expect(JSON.parse(screen.getByTestId("payload").textContent!)).toEqual({
      source_category: "friend_family", source_detail: null, referred_by_name: "Dana", referred_by_email: null,
    })
    cleanup()
    render(<Lead initial={{ source_category: "ad", referred_by_name: "Dana" }} />)
    expect(JSON.parse(screen.getByTestId("payload").textContent!)).not.toHaveProperty("referred_by_name")
  })
  it("keeps showing an older source until a new one is picked", () => {
    render(<Lead initial={{ source_category: "website" }} />)
    const select = screen.getByLabelText("HOW DID THEY HEAR ABOUT US?") as HTMLSelectElement
    expect(select.value).toBe("website")
    expect(screen.getByRole("option", { name: "Website (older option)" })).toBeTruthy()
  })
})

describe("LeadSourceBadge and ParentFields", () => {
  it("shows Other's text inside the badge", () => {
    render(<LeadSourceBadge source="other" detail="Career fair" />)
    expect(screen.getByText("Other: Career fair")).toBeTruthy()
  })
  it("parent contact has name, email and phone, all optional", () => {
    const onChange = vi.fn()
    render(<ParentFields idPrefix="t" value={{ parent_name: "", parent_email: "", parent_phone: "" }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText(/PARENT EMAIL/), { target: { value: "pat@x.com" } })
    expect(onChange).toHaveBeenCalledWith({ parent_name: "", parent_email: "pat@x.com", parent_phone: "" })
    expect(screen.getAllByText("(optional)")).toHaveLength(3)
  })
})

describe("ChainConfirmDialog", () => {
  it("lists what will happen and runs only on Confirm", async () => {
    const onConfirm = vi.fn().mockResolvedValue({ ok: true })
    const onClose = vi.fn()
    render(<ChainConfirmDialog title="Consult booked" steps={["Creates the prep task", "Adds it to History"]}
      confirmLabel="Confirm booking" onConfirm={onConfirm} onClose={onClose} />)
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Creates the prep task", "Adds it to History"])
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Confirm booking" }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
  it("keeps Confirm off until the inputs are valid", () => {
    render(<ChainConfirmDialog title="x" steps={["a"]} confirmLabel="Go" canConfirm={false} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect((screen.getByRole("button", { name: "Go" }) as HTMLButtonElement).disabled).toBe(true)
  })
  it("shows a refusal and stays open", async () => {
    const onClose = vi.fn()
    render(<ChainConfirmDialog title="x" steps={["a"]} confirmLabel="Go"
      onConfirm={vi.fn().mockResolvedValue({ ok: false, error: "Reopen the prospect first." })} onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: "Go" }))
    expect(await screen.findByText("Reopen the prospect first.")).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe("LostReasonFields", () => {
  function Lost() {
    const [v, setV] = useState<LostInput>({ lost_reason: "", lost_reason_detail: "", lost_notes: "" })
    return <><LostReasonFields value={v} onChange={setV} /><output data-testid="valid">{String(lostInputValid(v))}</output></>
  }
  it("offers the six reasons and needs one", () => {
    render(<Lost />)
    const select = screen.getByLabelText("REASON") as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "Select…", "Not a fit", "Price", "Timing", "Chose another option", "No response", "Other",
    ])
    expect(screen.getByTestId("valid").textContent).toBe("false")
    fireEvent.change(select, { target: { value: "timing" } })
    expect(screen.getByTestId("valid").textContent).toBe("true")
  })
  it("Other needs its text", () => {
    render(<Lost />)
    fireEvent.change(screen.getByLabelText("REASON"), { target: { value: "other" } })
    expect(screen.getByTestId("valid").textContent).toBe("false")
    fireEvent.change(screen.getByLabelText("PLEASE SPECIFY"), { target: { value: "Moved abroad" } })
    expect(screen.getByTestId("valid").textContent).toBe("true")
  })
})
