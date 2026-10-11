"use client"

// One question, one camera, one ninety-second answer.
//
// THE STATES, because this is used once, alone, by somebody who is nervous:
//
//   Start recording  turns the camera on AND begins recording. One press, not
//                    two. Arming the camera and then waiting for a second
//                    press gave people a live picture of themselves and
//                    nothing happening, which reads as broken.
//   Cancel           stops, turns the camera OFF, and throws the take away.
//                    Nothing is uploaded and nothing is stored. The card is
//                    left showing Re-record.
//   Re-record        throws the take away and puts the card back on Start
//                    recording. It does NOT film: the camera and the timer
//                    wait for them to press Start recording, so they get a
//                    breath between takes.
//   Finish           stops and turns the camera off, then plays the take back
//                    on the card. Nothing is uploaded yet.
//   Use this answer  uploads the take they just watched and LOCKS the question.
//   Re-record        (after watching) the same: take gone, back to Start.
//
// WHY THEY WATCH IT FIRST. Seeing yourself answer is the coaching: people judge
// their own eye contact, pace and filler words better on playback than from
// memory. So a take is only ever stored after the client has had the chance to
// see it and chosen it. The timer running out lands on the same playback.
//
// WHY CANCEL TURNS THE CAMERA OFF. It is the button somebody presses when they
// want to stop being filmed. Leaving the light on because the next take would
// start faster answers a question nobody asked.
//
// Locking is the point of Use this answer. "Submit" at the bottom sends the
// round; this button is how the client says "that one is my answer", and a question that
// could still be re-recorded after they said that would make Submit mean
// something different for each card.
//
// THE BUG THIS SHAPE EXISTS TO PREVENT. The previous version kept one
// `discardRef` shared by every recorder it made. Cancel set it true, called
// stop(), and then synchronously started the next recorder, which set it back
// to false -- all before the first recorder's `onstop` had fired. By the time
// the discarded take's handler ran, the flag said "keep it", so Cancel
// uploaded the take it was meant to throw away. The discard decision now
// belongs to ONE recorder, in its own closure, where nothing else can reach
// it; the chunk buffer does too, for the same reason.
//
// WHAT CAN GO WRONG HERE IS THE BROWSER. getUserMedia needs a secure context
// and a permission that can be refused; MediaRecorder's container differs by
// browser and iOS Safari produces mp4 rather than webm. So the codec is
// negotiated from what the browser reports, never assumed, and every failure
// says what happened in words rather than leaving a dead button.

import { useCallback, useEffect, useRef, useState } from "react"

export type RecorderState = "idle" | "ready" | "recording" | "cancelled" | "review" | "uploading" | "done" | "error"

/** A finished take waiting for the client to watch it and decide. */
type Take = { blob: Blob; mime: string; durationMs: number; url: string }

/** The containers worth asking for, best first. */
const CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
]

/**
 * What this browser will actually record.
 *
 * Returns "" when nothing is supported or MediaRecorder is missing entirely,
 * which means "let the browser choose" and is what older Safari wants.
 */
export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return ""
  return CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ""
}

/**
 * Milliseconds to m:ss.
 *
 * It used to print `0:${seconds}`, so ninety seconds read "0:90" and the
 * countdown went 0:90, 0:89, which is not a time anybody recognises.
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
  locked: boolean
  onRecorded: (blob: Blob, mime: string, durationMs: number) => Promise<void>
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const startedAtRef = useRef<number>(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  /**
   * Marks the CURRENT recorder's take as one to throw away.
   *
   * A function rather than a boolean, and rebuilt for every recorder: calling
   * it closes over that one instance's own flag, so a later recorder cannot
   * un-discard an earlier one's take. See the note at the top of this file.
   */
  const discardRef = useRef<(() => void) | null>(null)

  const [state, setState] = useState<RecorderState>("idle")
  const [error, setError] = useState<string>("")
  const [msLeft, setMsLeft] = useState(seconds * 1000)
  const [take, setTake] = useState<Take | null>(null)
  // The object URL behind the playback, for revoking on unmount: the state
  // value is stale inside the cleanup.
  const takeUrlRef = useRef<string | null>(null)

  const dropTake = useCallback(() => {
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current)
    takeUrlRef.current = null
    setTake(null)
  }, [])

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  // A camera light still on after they finish is alarming, and is the usual
  // complaint about tools like this.
  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
      stopTracks()
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current)
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

      // PER-RECORDER, both of them. `discarded` cannot be flipped by anything
      // that happens after this recorder is replaced, and `chunks` cannot be
      // emptied out from under this recorder's onstop by the next one.
      let discarded = false
      const chunks: Blob[] = []

      recorderRef.current = rec
      discardRef.current = () => { discarded = true }

      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data)
      }
      rec.onstop = async () => {
        if (tickRef.current) clearInterval(tickRef.current)
        // CANCELLED. Nothing is built, nothing is uploaded, nothing is stored.
        // The camera and the card state are the canceller's business, because
        // this handler also runs for the 90-second timeout.
        if (discarded) return

        const durationMs = Date.now() - startedAtRef.current
        const type = rec.mimeType || mime || "video/webm"
        const blob = new Blob(chunks, { type })
        stopTracks()
        // Playback first. The take is only uploaded when they choose it.
        const url = URL.createObjectURL(blob)
        if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current)
        takeUrlRef.current = url
        setTake({ blob, mime: type.split(";")[0], durationMs, url })
        setState("review")
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
          // Time up is a Finish, not a Cancel: ninety seconds of answer is an
          // answer, and throwing it away because they did not press the button
          // in time would be the cruellest possible reading of the timer.
          const r = recorderRef.current
          if (r && r.state !== "inactive") r.stop()
        }
      }, 200)
    },
    [seconds, stopTracks],
  )

  /** Start, and Re-record: camera on and recording, in one press. */
  const start = useCallback(async () => {
    setError("")
    dropTake()
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
          ? "SIGNAL needs permission to use your camera and microphone. Allow it in your browser, then press Start recording."
          : name === "NotFoundError"
            ? "No camera or microphone found on this device."
            : `Could not start the camera: ${e?.message ?? e}`,
      )
    }
  }, [beginRecording, dropTake])

  /**
   * Cancel: stop, camera off, take thrown away.
   *
   * The discard is marked BEFORE stop() because onstop can fire immediately,
   * and the recorder reference is cleared afterwards so nothing can stop it
   * twice.
   */
  const cancel = useCallback(() => {
    discardRef.current?.()
    const rec = recorderRef.current
    if (rec && rec.state !== "inactive") rec.stop()
    if (tickRef.current) clearInterval(tickRef.current)
    recorderRef.current = null
    discardRef.current = null
    stopTracks()
    setMsLeft(seconds * 1000)
    setError("")
    setState("cancelled")
  }, [seconds, stopTracks])

  /** Re-record: the take is gone and the card waits on Start recording. */
  const reRecord = useCallback(() => {
    dropTake()
    setError("")
    setMsLeft(seconds * 1000)
    setState("ready")
  }, [dropTake, seconds])

  /** Finish: stop, camera off, and play the take back. */
  const finish = useCallback(() => {
    const rec = recorderRef.current
    if (!rec || rec.state === "inactive") return
    rec.stop()
  }, [])

  /**
   * Use this answer: upload the take they watched, and lock the question.
   *
   * A failed upload goes back to the playback with the error, so the take
   * they chose is still there to try again rather than lost.
   */
  const useAnswer = useCallback(async () => {
    if (!take) return
    setError("")
    setState("uploading")
    try {
      await onRecorded(take.blob, take.mime, take.durationMs)
      dropTake()
      setState("done")
    } catch (e: any) {
      setState("review")
      setError(`That did not upload: ${e?.message ?? e}. Press Use this answer to try again.`)
    }
  }, [take, onRecorded, dropTake])

  if (locked && state !== "uploading") {
    return (
      <p style={{ margin: 0, fontSize: 15, color: "#00757A", fontWeight: 700 }}>
        Answered. This one is locked in.
      </p>
    )
  }

  const low = msLeft <= 10_000
  const pct = Math.max(0, Math.min(100, (msLeft / (seconds * 1000)) * 100))
  const showVideo = state === "recording"
  const showTake = (state === "review" || state === "uploading") && !!take

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
        {/* THE PLAYBACK. Its own element: the live preview is mirrored and
            muted, and a take watched back should be neither, so they see and
            hear what the interviewer would. */}
        {showTake && (
          <video
            key={take!.url}
            src={take!.url}
            controls
            playsInline
            aria-label="Your recorded answer"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", background: "#0D1829" }}
          />
        )}
        {!showVideo && !showTake && (
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
              : state === "cancelled"
                ? "Take discarded. Nothing was saved."
                : state === "ready"
                ? "That take is gone. Press Start recording when you are ready."
                : "Press Start recording. Your camera comes on and recording begins straight away."}
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
        {/* A FRESH CARD HAS ONE BUTTON. Anything beside it is a choice offered
            before there is anything to choose between. */}
        {(state === "idle" || state === "ready" || state === "error") && (
          <button type="button" onClick={() => void start()} style={btn("primary")}>Start recording</button>
        )}
        {state === "cancelled" && (
          <button type="button" onClick={reRecord} style={btn("primary")}>Re-record</button>
        )}
        {state === "recording" && (
          <>
            <button type="button" onClick={finish} style={btn("primary")}>
              Finish ({formatClock(msLeft)} left)
            </button>
            <button type="button" onClick={cancel} style={btn("secondary")}>Cancel</button>
          </>
        )}
        {state === "review" && (
          <>
            <button type="button" onClick={() => void useAnswer()} style={btn("primary")}>Use this answer</button>
            <button type="button" onClick={reRecord} style={btn("secondary")}>Re-record</button>
            <span style={{ fontSize: 15, lineHeight: "22px", color: "#08203F", flexBasis: "100%" }}>
              Watch your answer, then keep it or record it again.
            </span>
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
