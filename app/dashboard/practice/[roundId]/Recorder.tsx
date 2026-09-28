"use client"

// One question, one camera, one ninety-second answer.
//
// THE TIMER IS THE POINT. Session 2 teaches a ninety-second story, so the
// recorder enforces it rather than asking the client to watch a clock while
// they talk. It stops itself at the limit; the last ten seconds turn the
// countdown red because a hard stop with no warning feels like a fault.
//
// WHAT CAN GO WRONG HERE IS THE BROWSER, not the code. getUserMedia needs a
// secure context and a permission the client can refuse; MediaRecorder's
// supported container differs by browser, and iOS Safari produces mp4 rather
// than webm. So the codec is negotiated from what the browser actually
// reports, never assumed, and every failure path says what happened in words
// rather than leaving a dead button.

import { useCallback, useEffect, useRef, useState } from "react"

export type RecorderState = "idle" | "ready" | "recording" | "uploading" | "done" | "error"

/**
 * The best container this browser will actually record.
 *
 * Ordered by preference, not by popularity: VP9 is smaller than VP8 for the
 * same quality, and mp4 is last because only Safari needs it and only Safari
 * offers it. An empty string means "let the browser choose", which is the
 * correct fallback and what older Safari wants.
 */
export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return ""
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ]
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c
    } catch {
      // Safari has historically thrown here rather than returning false.
    }
  }
  return ""
}

export function formatClock(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000))
  return `0:${String(s).padStart(2, "0")}`
}

export function Recorder({
  seconds,
  disabled,
  onRecorded,
}: {
  seconds: number
  disabled?: boolean
  /** Called with the finished blob. Upload is the caller's business. */
  onRecorded: (blob: Blob, mime: string, durationMs: number) => Promise<void>
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number>(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [state, setState] = useState<RecorderState>("idle")
  const [error, setError] = useState<string>("")
  const [msLeft, setMsLeft] = useState(seconds * 1000)

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  // The camera light staying on after the client has finished is alarming and
  // is a real complaint about tools like this, so the stream is released on
  // unmount as well as on stop.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      stopTracks()
    }
  }, [stopTracks])

  const arm = useCallback(async () => {
    setError("")
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("error")
      setError("This browser cannot record video. Try Chrome, Safari or Edge, and make sure the page is on https.")
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: true,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true
        await videoRef.current.play().catch(() => {})
      }
      setState("ready")
    } catch (e: any) {
      setState("error")
      // NotAllowedError is a refusal, NotFoundError is no camera. They need
      // different things from the client, so they get different sentences.
      const name = String(e?.name ?? "")
      setError(
        name === "NotAllowedError"
          ? "SIGNAL needs permission to use your camera and microphone. Allow it in your browser, then press Start over."
          : name === "NotFoundError"
            ? "No camera or microphone found on this device."
            : `Could not start the camera: ${e?.message ?? e}`,
      )
    }
  }, [])

  const finish = useCallback(async () => {
    const rec = recorderRef.current
    if (!rec || rec.state === "inactive") return
    rec.stop()
  }, [])

  const start = useCallback(() => {
    const stream = streamRef.current
    if (!stream) return
    const mime = pickMimeType()
    let rec: MediaRecorder
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    } catch (e: any) {
      setState("error")
      setError(`This browser refused to start recording: ${e?.message ?? e}`)
      return
    }
    chunksRef.current = []
    recorderRef.current = rec

    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data)
    }
    rec.onstop = async () => {
      if (tickRef.current) clearInterval(tickRef.current)
      const durationMs = Date.now() - startedAtRef.current
      const type = rec.mimeType || mime || "video/webm"
      const blob = new Blob(chunksRef.current, { type })
      chunksRef.current = []
      stopTracks()
      setState("uploading")
      try {
        await onRecorded(blob, type.split(";")[0], durationMs)
        setState("done")
      } catch (e: any) {
        setState("error")
        setError(`That recorded, but did not upload: ${e?.message ?? e}`)
      }
    }

    startedAtRef.current = Date.now()
    setMsLeft(seconds * 1000)
    // A timeslice means we get data as it goes rather than one blob at the
    // end, which is what stops a long answer being lost if the tab is closed
    // mid-recording on some browsers.
    rec.start(1000)
    setState("recording")

    tickRef.current = setInterval(() => {
      const left = seconds * 1000 - (Date.now() - startedAtRef.current)
      setMsLeft(left)
      if (left <= 0) void finish()
    }, 200)
  }, [finish, onRecorded, seconds, stopTracks])

  const low = msLeft <= 10_000
  const pct = Math.max(0, Math.min(100, (msLeft / (seconds * 1000)) * 100))

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          position: "relative", width: "100%", aspectRatio: "16 / 9",
          background: "#0D1829", borderRadius: 12, overflow: "hidden",
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }}
        />
        {state === "recording" && (
          <div
            aria-live="polite"
            style={{
              position: "absolute", top: 10, right: 10, display: "flex", alignItems: "center", gap: 8,
              background: "rgba(4,6,15,0.66)", color: "#fff", padding: "6px 12px", borderRadius: 999,
              fontVariantNumeric: "tabular-nums", fontWeight: 800,
            }}
          >
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#C0322F", display: "inline-block" }} />
            <span style={{ color: low ? "#FF9B80" : "#fff" }}>{formatClock(msLeft)}</span>
          </div>
        )}
        {state === "idle" && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "rgba(255,255,255,0.7)", fontSize: 15, padding: 20, textAlign: "center" }}>
            Press Start over to turn on your camera.
          </div>
        )}
      </div>

      {state === "recording" && (
        <div style={{ height: 4, background: "rgba(8,32,63,0.12)", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: low ? "#C0322F" : "#00B3B3", transition: "width 200ms linear" }} />
        </div>
      )}

      {error && (
        <p style={{ margin: 0, fontSize: 14, lineHeight: "20px", color: "#C0322F" }} role="alert">{error}</p>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {(state === "idle" || state === "error" || state === "done") && (
          <button type="button" onClick={() => void arm()} disabled={disabled}
            style={btn(state === "done" ? "secondary" : "primary")}>
            {state === "done" ? "Record it again" : "Start over"}
          </button>
        )}
        {state === "ready" && (
          <button type="button" onClick={start} style={btn("primary")}>Record</button>
        )}
        {state === "recording" && (
          <button type="button" onClick={() => void finish()} style={btn("primary")}>
            Stop ({formatClock(msLeft)} left)
          </button>
        )}
        {state === "uploading" && <span style={{ fontSize: 15 }}>Uploading your answer...</span>}
        {state === "done" && <span style={{ fontSize: 15, color: "#00757A", fontWeight: 700 }}>Recorded</span>}
      </div>
    </div>
  )
}

function btn(kind: "primary" | "secondary"): React.CSSProperties {
  return {
    padding: "11px 18px",
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
    minHeight: 44,
    border: kind === "primary" ? "none" : "1px solid rgba(8,32,63,0.25)",
    background: kind === "primary" ? "#08203F" : "transparent",
    color: kind === "primary" ? "#fff" : "#08203F",
  }
}
