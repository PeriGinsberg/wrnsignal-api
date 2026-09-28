"use client"

// One question, one camera, one ninety-second answer.
//
// THREE STATES AND NO MORE, because this is used once, alone, by somebody who
// is nervous:
//
//   Start      turns the camera on AND begins recording. One press, not two.
//              Arming the camera and then waiting for a second press gave
//              people a live picture of themselves and nothing happening,
//              which reads as broken.
//   Restart    throws this take away and begins again. The camera stays on, so
//              it is instant.
//   Finished   stops, uploads, and LOCKS the question. No more recording.
//
// Locking is the point of Finished. "Submit" at the bottom sends the round;
// this button is how the client says "that one is my answer", and a question
// that could still be re-recorded after they said that would make Submit mean
// something different for each card.
//
// WHAT CAN GO WRONG HERE IS THE BROWSER. getUserMedia needs a secure context
// and a permission that can be refused; MediaRecorder's container differs by
// browser and iOS Safari produces mp4 rather than webm. So the codec is
// negotiated from what the browser reports, never assumed, and every failure
// says what happened in words rather than leaving a dead button.

import { useCallback, useEffect, useRef, useState } from "react"

export type RecorderState = "idle" | "recording" | "uploading" | "done" | "error"

/**
 * The best container this browser will actually record.
 *
 * Ordered by preference, not popularity: VP9 is smaller than VP8 at the same
 * quality, and mp4 is last because only Safari needs it and only Safari offers
 * it. An empty string means "let the browser choose", which is the correct
 * fallback and what older Safari wants.
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

/**
 * Minutes and seconds, always.
 *
 * It used to print `0:${seconds}`, so ninety seconds read "0:90" and a
 * countdown went 0:90, 0:89 ... which is not a time anybody recognises.
 */
export function formatClock(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function Recorder({
  seconds,
  locked,
  onRecorded,
}: {
  seconds: number
  /** Already answered and finished. The recorder does not offer to run again. */
  locked?: boolean
  onRecorded: (blob: Blob, mime: string, durationMs: number) => Promise<void>
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number>(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Set while Restart is tearing a recorder down, so its onstop knows the take
  // is being thrown away rather than kept.
  const discardRef = useRef(false)

  const [state, setState] = useState<RecorderState>("idle")
  const [error, setError] = useState<string>("")
  const [msLeft, setMsLeft] = useState(seconds * 1000)

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  // A camera light still on after they finish is alarming, and is the usual
  // complaint about tools like this.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      stopTracks()
    }
  }, [stopTracks])

  const beginRecording = useCallback(
    (stream: MediaStream) => {
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
      discardRef.current = false

      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data)
      }
      rec.onstop = async () => {
        if (tickRef.current) clearInterval(tickRef.current)
        const chunks = chunksRef.current
        chunksRef.current = []
        if (discardRef.current) return  // Restart: the bytes go nowhere.

        const durationMs = Date.now() - startedAtRef.current
        const type = rec.mimeType || mime || "video/webm"
        const blob = new Blob(chunks, { type })
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
      // A timeslice means data arrives as it goes rather than in one blob at
      // the end, so a tab closed mid-answer does not lose everything.
      rec.start(1000)
      setState("recording")

      if (tickRef.current) clearInterval(tickRef.current)
      tickRef.current = setInterval(() => {
        const left = seconds * 1000 - (Date.now() - startedAtRef.current)
        setMsLeft(left)
        if (left <= 0) {
          const r = recorderRef.current
          if (r && r.state !== "inactive") r.stop()
        }
      }, 200)
    },
    [onRecorded, seconds, stopTracks],
  )

  /** Start: camera on and recording, in one press. */
  const start = useCallback(async () => {
    setError("")
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("error")
      setError("This browser cannot record video. Try Safari or Chrome, and make sure the page is on https.")
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
      beginRecording(stream)
    } catch (e: any) {
      setState("error")
      const name = String(e?.name ?? "")
      setError(
        name === "NotAllowedError"
          ? "SIGNAL needs permission to use your camera and microphone. Allow it in your browser, then press Start."
          : name === "NotFoundError"
            ? "No camera or microphone found on this device."
            : `Could not start the camera: ${e?.message ?? e}`,
      )
    }
  }, [beginRecording])

  /** Restart: throw this take away and go again, camera already warm. */
  const restart = useCallback(() => {
    const rec = recorderRef.current
    const stream = streamRef.current
    if (!rec || !stream) return
    discardRef.current = true
    if (rec.state !== "inactive") rec.stop()
    if (tickRef.current) clearInterval(tickRef.current)
    beginRecording(stream)
  }, [beginRecording])

  /** Finished: stop, upload, and lock the question. */
  const finish = useCallback(() => {
    const rec = recorderRef.current
    if (!rec || rec.state === "inactive") return
    discardRef.current = false
    rec.stop()
  }, [])

  if (locked && state !== "uploading") {
    return (
      <p style={{ margin: 0, fontSize: 15, color: "#00757A", fontWeight: 700 }}>
        Answered. This one is locked in.
      </p>
    )
  }

  const low = msLeft <= 10_000
  const pct = Math.max(0, Math.min(100, (msLeft / (seconds * 1000)) * 100))
  const showVideo = state === "recording" || state === "uploading"

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
          style={{
            width: "100%", height: "100%", objectFit: "cover",
            transform: "scaleX(-1)",
            // Hidden rather than unmounted: the element has to exist before
            // getUserMedia resolves so the stream has somewhere to go.
            visibility: showVideo ? "visible" : "hidden",
          }}
        />
        {!showVideo && (
          <div
            style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center",
              justifyContent: "center", padding: "16px 20px",
              color: "rgba(255,255,255,0.72)", fontSize: 15, lineHeight: "22px",
              textAlign: "center", overflowWrap: "anywhere",
            }}
          >
            {state === "done"
              ? "Answer saved."
              : "Press Start. Your camera comes on and recording begins straight away."}
          </div>
        )}
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
      </div>

      {state === "recording" && (
        <div style={{ height: 4, background: "rgba(8,32,63,0.12)", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: low ? "#C0322F" : "#00B3B3", transition: "width 200ms linear" }} />
        </div>
      )}

      {error && (
        <p style={{ margin: 0, fontSize: 15, lineHeight: "22px", color: "#C0322F" }} role="alert">{error}</p>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {(state === "idle" || state === "error") && (
          <button type="button" onClick={() => void start()} style={btn("primary")}>Start</button>
        )}
        {state === "recording" && (
          <>
            <button type="button" onClick={finish} style={btn("primary")}>
              Finished ({formatClock(msLeft)} left)
            </button>
            <button type="button" onClick={restart} style={btn("secondary")}>Restart</button>
          </>
        )}
        {state === "uploading" && <span style={{ fontSize: 15 }}>Saving your answer...</span>}
        {state === "done" && (
          <span style={{ fontSize: 15, color: "#00757A", fontWeight: 700 }}>Answered. This one is locked in.</span>
        )}
      </div>
    </div>
  )
}

function btn(kind: "primary" | "secondary"): React.CSSProperties {
  return {
    padding: "12px 20px",
    borderRadius: 10,
    fontSize: 16,
    fontWeight: 800,
    cursor: "pointer",
    fontFamily: "inherit",
    minHeight: 48,
    border: kind === "primary" ? "none" : "1px solid rgba(8,32,63,0.25)",
    background: kind === "primary" ? "#08203F" : "transparent",
    color: kind === "primary" ? "#fff" : "#08203F",
  }
}
