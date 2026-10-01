// The public consult booking form, as a visitor sees it.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { BookingForm } from "./BookingForm"

let posted: any[]
beforeEach(() => {
  posted = []
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    posted.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ ok: true, redirect: "https://calendly.com/peri-workforcereadynow/30min?name=Jamie+Rivera&email=jamie%40example.com", event_id: "consult-abc" }), { status: 200 })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (window as any).fbq })

function fillStudent() {
  fireEvent.click(screen.getByRole("radio", { name: "I'm the student or job seeker" }))
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jamie" } })
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Rivera" } })
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "jamie@example.com" } })
  fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "555-0101" } })
}

describe("booking form", () => {
  it("is branded: the WRN logo and the banner headline", () => {
    render(<BookingForm />)
    expect(screen.getByAltText("Workforce Ready Now")).toBeTruthy()
    expect(screen.getByText("WORKFORCE READY NOW")).toBeTruthy()
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Book your free consult.")
    expect(screen.getByText("free consult")).toBeTruthy()
    expect(screen.queryByText(/talking with/)).toBeNull()
  })

  it("asks a parent about the student", () => {
    render(<BookingForm />)
    expect(screen.queryByLabelText("Student's email")).toBeNull()
    fireEvent.click(screen.getByRole("radio", { name: "I'm a parent or guardian" }))
    expect(screen.getByLabelText("Student's first name")).toBeTruthy()
    expect(screen.getByLabelText("Student's email")).toBeTruthy()
    expect(screen.getByLabelText(/Student's phone/).textContent ?? "").toBe("")
    expect(screen.getByText("Your details")).toBeTruthy()
  })

  it("offers the five situations and asks Other to say more", () => {
    render(<BookingForm />)
    const labels = ["Seeking internship support", "New graduate (0-1 year)", "Early career (2-5 years)", "Seasoned professional", "Other"]
    for (const l of labels) expect(screen.getByRole("radio", { name: l })).toBeTruthy()
    fireEvent.click(screen.getByRole("radio", { name: "Other" }))
    expect(screen.getByLabelText("Please tell us more")).toBeTruthy()
  })

  it("lists services with Early Career Planning first", () => {
    render(<BookingForm />)
    const boxes = screen.getAllByRole("checkbox")
    expect(boxes[0].closest("label")!.textContent).toBe("Early Career Planning")
    expect(boxes.at(-1)!.closest("label")!.textContent).toBe("All of the above")
  })

  it("asks who referred them only for a referral source, and Other to specify", () => {
    render(<BookingForm />)
    const source = screen.getByLabelText("How did you hear about us?")
    fireEvent.change(source, { target: { value: "friend_family" } })
    expect(screen.getByLabelText(/Who referred you\?/)).toBeTruthy()
    fireEvent.change(source, { target: { value: "other" } })
    expect(screen.queryByLabelText(/Who referred you\?/)).toBeNull()
    expect(screen.getByLabelText("Please specify")).toBeTruthy()
  })

  it("has the optional student section with school, graduation year and major", () => {
    render(<BookingForm />)
    expect(screen.getByText("For current students and recent graduates (optional)")).toBeTruthy()
    expect(screen.getByLabelText("School")).toBeTruthy()
    expect(screen.getByLabelText("Graduation year")).toBeTruthy()
    expect(screen.getByLabelText("Major")).toBeTruthy()
  })

  it("submits, fires the Meta Lead with the server's event id, and opens the calendar", async () => {
    const fbq = vi.fn()
    ;(window as any).fbq = fbq
    render(<BookingForm trackLeads />)
    fillStudent()
    fireEvent.change(screen.getByLabelText("How did you hear about us?"), { target: { value: "past_client" } })
    fireEvent.change(screen.getByLabelText(/Who referred you\?/), { target: { value: "Dana Lee" } })
    fireEvent.click(screen.getByRole("button", { name: "Continue to pick a time →" }))
    expect(await screen.findByText("Thanks, Jamie!")).toBeTruthy()
    expect(posted[0]).toMatchObject({
      submitter: "student", first_name: "Jamie", email: "jamie@example.com", source_category: "past_client",
      referred_by_name: "Dana Lee", website: "",
    })
    expect(typeof posted[0].elapsed_ms).toBe("number")
    expect(posted[0]).not.toHaveProperty("student_email")
    expect(fbq).toHaveBeenCalledWith("track", "Lead", { content_name: "Initial consult booking form" }, { eventID: "consult-abc" })
    expect(screen.getByRole("link", { name: "Open the calendar" }).getAttribute("href")).toContain("calendly.com/peri-workforcereadynow/30min")
  })

  it("fires no Meta Lead outside production", async () => {
    const fbq = vi.fn()
    ;(window as any).fbq = fbq
    render(<BookingForm />)
    fillStudent()
    fireEvent.click(screen.getByRole("button", { name: "Continue to pick a time →" }))
    expect(await screen.findByText("Thanks, Jamie!")).toBeTruthy()
    expect(fbq).not.toHaveBeenCalled()
  })

  it("shows the server's message and keeps the form", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "Please enter a valid email address." }), { status: 400 })))
    render(<BookingForm />)
    fillStudent()
    fireEvent.click(screen.getByRole("button", { name: "Continue to pick a time →" }))
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.getByRole("alert").textContent).toBe("Please enter a valid email address.")
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue to pick a time →" })).toBeTruthy())
  })
})
