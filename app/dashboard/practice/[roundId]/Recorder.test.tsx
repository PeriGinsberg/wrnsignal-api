// The recorder's one rule: a cancelled take is never uploaded.
//
// This is a regression test for a real bug. Cancel (then called Restart) set a
// shared `discardRef` to true, called stop(), and synchronously started the
// next recorder, which reset the flag to false. MediaRecorder fires `onstop`
// asynchronously, so by the time the discarded take's handler ran the flag
// said "keep it" and the take was uploaded and the question locked.
//
// The fakes below reproduce exactly that timing: `stop()` schedules `onstop`
// on a later task rather than calling it inline. A test with a synchronous
// stop() would have passed against the broken code.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, act, cleanup } from "@testing-library/react"
import { Recorder, formatClock, pickMimeType } from "./Recorder"

class FakeMediaRecorder {
  static isTypeSupported = () => true
  state: "inactive" | "recording" = "inactive"
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  mimeType = "video/webm"
  static made: FakeMediaRecorder[] = []

  constructor(_s: MediaStream, _o?: { mimeType?: string }) {
    FakeMediaRecorder.made.push(this)
  }
  start() {
    this.state = "recording"
    // A chunk lands immediately, so a discarded take has real bytes behind it.
    queueMicrotask(() => this.ondataavailable?.({ data: new Blob(["x"]) }))
  }
  stop() {
    this.state = "inactive"
    // ASYNCHRONOUS, like the real thing. This is the whole point of the test.
    setTimeout(() => this.onstop?.(), 0)
  }
}

const tracks = { stopped: 0 }
function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: () => { tracks.stopped++ } }] } as unknown as MediaStream
}

beforeEach(() => {
  FakeMediaRecorder.made = []
  tracks.stopped = 0
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder)
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => fakeStream()) },
  })
  // jsdom has no object URLs.
  vi.stubGlobal("URL", Object.assign(Object.create(URL), {
    createObjectURL: vi.fn(() => `blob:take-${Math.random()}`),
    revokeObjectURL: vi.fn(),
  }))
  // jsdom's <video> has no play().
  Object.defineProperty(globalThis.HTMLMediaElement.prototype, "play", {
    configurable: true, value: vi.fn(async () => {}),
  })
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/**
 * Let the click's async getUserMedia and the fake recorder's timers settle.
 *
 * REAL TIMERS on purpose. The bug under test is a timing one, and faking the
 * clock would let the test choose an interleaving the browser never produces.
 * Five milliseconds is enough for a setTimeout(0) and costs nothing.
 */
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 5)) })
}

const click = async (name: string | RegExp) => {
  await act(async () => { screen.getByRole("button", { name }).click() })
  await settle()
}

describe("a fresh card", () => {
  it("offers one button and nothing else", async () => {
    render(<Recorder seconds={90} locked={false} onRecorded={vi.fn()} />)
    expect(screen.getByRole("button", { name: "Start recording" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /finish/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /re-record/i })).toBeNull()
  })
})

describe("cancel", () => {
  it("never uploads the take it threw away", async () => {
    const onRecorded = vi.fn(async () => {})
    render(<Recorder seconds={90} locked={false} onRecorded={onRecorded} />)

    await act(async () => { screen.getByRole("button", { name: "Start recording" }).click() })
    await settle()
    await act(async () => { screen.getByRole("button", { name: "Cancel" }).click() })
    await settle()

    // THE BUG. Before the fix this was 1: the discarded take uploaded once the
    // next recorder had reset the shared flag.
    expect(onRecorded).not.toHaveBeenCalled()
  })

  it("turns the camera off", async () => {
    render(<Recorder seconds={90} locked={false} onRecorded={vi.fn()} />)
    await act(async () => { screen.getByRole("button", { name: "Start recording" }).click() })
    await settle()
    expect(tracks.stopped).toBe(0)
    await act(async () => { screen.getByRole("button", { name: "Cancel" }).click() })
    await settle()
    expect(tracks.stopped).toBeGreaterThan(0)
  })

  it("leaves the card on Re-record, not on Start", async () => {
    render(<Recorder seconds={90} locked={false} onRecorded={vi.fn()} />)
    await act(async () => { screen.getByRole("button", { name: "Start recording" }).click() })
    await settle()
    await act(async () => { screen.getByRole("button", { name: "Cancel" }).click() })
    await settle()

    expect(screen.getByRole("button", { name: "Re-record" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Start recording" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()
  })
})

describe("re-record after cancel", () => {
  it("does not turn the camera on until Start recording", async () => {
    render(<Recorder seconds={90} locked={false} onRecorded={vi.fn()} />)
    await click("Start recording")
    await click("Cancel")
    await click("Re-record")

    expect(FakeMediaRecorder.made.length).toBe(1)
    expect(screen.getByRole("button", { name: "Start recording" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /^Finish/ })).toBeNull()
  })
})

describe("cancel, re-record, finish", () => {
  it("stores exactly one take, the last one", async () => {
    const onRecorded = vi.fn(async () => {})
    render(<Recorder seconds={90} locked={false} onRecorded={onRecorded} />)

    await act(async () => { screen.getByRole("button", { name: "Start recording" }).click() })
    await settle()
    await act(async () => { screen.getByRole("button", { name: "Cancel" }).click() })
    await settle()
    await act(async () => { screen.getByRole("button", { name: "Re-record" }).click() })
    await settle()
    await click("Start recording")
    await act(async () => { screen.getByRole("button", { name: /^Finish/ }).click() })
    await settle()
    await click("Use this answer")

    // Two recorders were made and only the second one's take was kept.
    expect(FakeMediaRecorder.made.length).toBe(2)
    expect(onRecorded).toHaveBeenCalledTimes(1)
  })

  it("locks the question once the upload lands", async () => {
    render(<Recorder seconds={90} locked={false} onRecorded={vi.fn(async () => {})} />)
    await act(async () => { screen.getByRole("button", { name: "Start recording" }).click() })
    await settle()
    await act(async () => { screen.getByRole("button", { name: /^Finish/ }).click() })
    await settle()
    await click("Use this answer")

    expect(screen.getByText(/locked in/i)).toBeTruthy()
    expect(screen.queryByRole("button")).toBeNull()
  })
})

describe("watching the take before keeping it", () => {
  it("Finish plays the take back and uploads nothing", async () => {
    const onRecorded = vi.fn(async () => {})
    render(<Recorder seconds={90} locked={false} onRecorded={onRecorded} />)
    await click("Start recording")
    await click(/^Finish/)

    expect(onRecorded).not.toHaveBeenCalled()
    const playback = screen.getByLabelText("Your recorded answer") as HTMLVideoElement
    expect(playback.getAttribute("src")).toMatch(/^blob:take-/)
    expect(playback.hasAttribute("controls")).toBe(true)
    expect(playback.muted).toBe(false)
    expect(screen.getByRole("button", { name: "Use this answer" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Re-record" })).toBeTruthy()
    // The camera is off while they watch.
    expect(tracks.stopped).toBeGreaterThan(0)
  })

  it("Re-record after watching throws that take away and waits on Start recording", async () => {
    const onRecorded = vi.fn(async () => {})
    render(<Recorder seconds={90} locked={false} onRecorded={onRecorded} />)
    await click("Start recording")
    await click(/^Finish/)
    await click("Re-record")

    // Take gone, and NOT filming: no new recorder, no camera request, no Finish.
    expect(screen.queryByLabelText("Your recorded answer")).toBeNull()
    expect(FakeMediaRecorder.made.length).toBe(1)
    expect((navigator.mediaDevices.getUserMedia as any).mock.calls.length).toBe(1)
    expect(screen.queryByRole("button", { name: /^Finish/ })).toBeNull()
    expect(screen.getByText(/press start recording when you are ready/i)).toBeTruthy()

    await click("Start recording")
    await click(/^Finish/)
    await click("Use this answer")

    expect(FakeMediaRecorder.made.length).toBe(2)
    expect(onRecorded).toHaveBeenCalledTimes(1)
  })

  it("a failed upload keeps the take on screen to try again", async () => {
    const onRecorded = vi.fn().mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(undefined)
    render(<Recorder seconds={90} locked={false} onRecorded={onRecorded} />)
    await click("Start recording")
    await click(/^Finish/)
    await click("Use this answer")

    expect(screen.getByRole("alert").textContent).toMatch(/network down/)
    expect(screen.getByLabelText("Your recorded answer")).toBeTruthy()
    await click("Use this answer")
    expect(onRecorded).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/locked in/i)).toBeTruthy()
  })
})

describe("the clock", () => {
  it("is minutes and seconds, not a count of seconds", () => {
    expect(formatClock(90_000)).toBe("1:30")
    expect(formatClock(87_000)).toBe("1:27")
    expect(formatClock(0)).toBe("0:00")
    expect(formatClock(-500)).toBe("0:00")
  })

  it("picks a codec the browser admits to supporting", () => {
    expect(pickMimeType()).toBe("video/webm;codecs=vp9,opus")
  })
})
