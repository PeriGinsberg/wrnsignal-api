"use client"

// A Casing Academy case: an interviewer-led simulation, one question at a time.
//
// HOW IT RUNS, because the student does this alone and the baseline only means
// something if every student met the same thing:
//
//   Intro       the scenario and how it works, and a camera check.
//   Question    title, the question, any numbers that come with it. Think
//               time counts down (Start answering skips it); when it ends,
//               recording starts by itself, as an interviewer would expect an
//               answer. The answer has its own limit; Finish ends it early.
//   Saved       the take uploads and the next question appears. No re-takes:
//               a simulation with second attempts is not a baseline.
//   Reflect     five self-assessment questions, saved as they type.
//   Submit      everything goes to the coach.
//
// TWO RECORDINGS PER ANSWER. The video is what the coach watches; an
// audio-only track recorded alongside it is what gets transcribed, because it
// is a twentieth of the size and Whisper takes 25 MB at most. If the camera
// cannot start, the answer is recorded as audio alone rather than lost.
//
// THE CLOCK IS THE STUDENT'S. question_shown_at is when this question first
// appeared on this device (kept across a reload in localStorage, so a refresh
// does not hand out extra think time on paper), and the response times are
// when recording started and stopped. They are recorded, never judged here:
// a long think before a clear answer is a different thing from a long answer.

import { useCallback, useEffect, useRef, useState } from "react"
import { formatClock, pickMimeType } from "./Recorder"

export type CaseQuestion = {
  id: string; position: number; title: string | null; text: string; exhibit: string | null
  seconds: number; prep_seconds: number; answered: boolean
  works: string | null; fix: string | null
}
export type CaseRound = {
  id: string; kind: "case"; title: string; status: "sent" | "submitted" | "feedback_sent" | "draft"
  submitted_at: string | null; coach_name: string; scenario: string; instructions: string[]
  minutes: string | null; total: number; feedback_sent_at: string | null; overall: string | null
  questions: CaseQuestion[]
  self_assessment: { questions: { key: string; question: string }[]; answers: Record<string, string>; done: boolean }
}

type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>

const AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
function pickAudioType(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return ""
  return AUDIO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ""
}

function shownAt(questionId: string): string {
  const k = `case-shown:${questionId}`
  try {
    const v = localStorage.getItem(k)
    if (v) return v
    const now = new Date().toISOString()
    localStorage.setItem(k, now)
    return now
  } catch {
    return new Date().toISOString()
  }
}

export function CasePlayer({ round, authFetch, reload }: { round: CaseRound; authFetch: AuthFetch; reload: () => Promise<void> }) {
  const answeredCount = round.questions.filter((q) => q.answered).length
  const current = round.questions.find((q) => !q.answered) ?? null
  const allAnswered = answeredCount === round.total
  const done = round.status === "submitted" || round.status === "feedback_sent"
  const [started, setStarted] = useState(answeredCount > 0)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={eyebrow}>CASE SIMULATION</span>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2, color: NAVY }}>{round.title}</h1>
        {!done && (
          <Progress answered={answeredCount} total={round.total} reflecting={allAnswered} />
        )}
      </header>

      {done ? (
        <div style={card}>
          <p style={{ ...p, margin: 0, fontWeight: 700, color: "#00757A" }}>
            Submitted. {round.coach_name} will review your answers and recordings before your next session.
          </p>
          {round.feedback_sent_at && round.overall && (
            <div style={{ marginTop: 14 }}>
              <span style={label}>{round.coach_name}&rsquo;s note</span>
              <p style={{ ...p, whiteSpace: "pre-wrap", color: NAVY }}>{round.overall}</p>
            </div>
          )}
        </div>
      ) : !started ? (
        <Intro round={round} onStart={() => setStarted(true)} />
      ) : current ? (
        <>
          <Scenario text={round.scenario} />
          <QuestionCard key={current.id} q={current} n={current.position + 1} total={round.total}
            roundId={round.id} authFetch={authFetch} onSaved={reload} />
        </>
      ) : (
        <SelfAssessment round={round} authFetch={authFetch} reload={reload} />
      )}
    </div>
  )
}

function Progress({ answered, total, reflecting }: { answered: number; total: number; reflecting: boolean }) {
  const pct = Math.round(((answered + (reflecting ? 0.5 : 0)) / (total + 1)) * 100)
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 15, color: MUTED }}>
        {reflecting ? `All ${total} questions answered. Last step: your self-assessment.` : `${answered} of ${total} questions answered`}
      </span>
      <div style={{ height: 6, background: "rgba(8,32,63,0.10)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: TEAL, transition: "width 300ms" }} />
      </div>
    </div>
  )
}

function Intro({ round, onStart }: { round: CaseRound; onStart: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [check, setCheck] = useState<"idle" | "on" | "ok" | "error">("idle")
  const [err, setErr] = useState("")

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])
  useEffect(() => stop, [stop])

  const test = async () => {
    setErr("")
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: true })
      streamRef.current = s
      if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.muted = true; await videoRef.current.play().catch(() => {}) }
      setCheck("on")
    } catch (e: any) {
      setCheck("error")
      setErr(e?.name === "NotAllowedError"
        ? "SIGNAL needs your camera and microphone. Allow them in your browser's address bar, then try again."
        : `Could not start the camera: ${e?.message ?? e}. You can still do the case: answers will be recorded as audio if the camera will not start.`)
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={card}>
        <span style={label}>The case</span>
        {round.scenario.split(/\n\n+/).map((t, i) => <p key={i} style={{ ...p, color: NAVY }}>{t}</p>)}
      </div>
      <div style={card}>
        <span style={label}>How this works{round.minutes ? ` (${round.minutes})` : ""}</span>
        <ul style={{ margin: "8px 0 0", paddingLeft: 20, display: "grid", gap: 8 }}>
          {round.instructions.map((t, i) => <li key={i} style={{ ...p, margin: 0, color: NAVY }}>{t}</li>)}
        </ul>
      </div>
      <div style={card}>
        <span style={label}>Check your camera and microphone</span>
        <div style={{ position: "relative", width: "100%", maxWidth: 420, aspectRatio: "16 / 9", background: "#0D1829", borderRadius: 12, overflow: "hidden", marginTop: 10 }}>
          <video ref={videoRef} playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", visibility: check === "on" ? "visible" : "hidden" }} />
          {check !== "on" && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "rgba(255,255,255,0.75)", fontSize: 15, padding: 16, textAlign: "center" }}>
              {check === "ok" ? "Camera works. It turns off until each answer." : "Nothing is recorded during the check."}
            </div>
          )}
        </div>
        {err && <p style={{ ...p, color: ERROR }} role="alert">{err}</p>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
          {check === "on"
            ? <button type="button" style={btn("secondary")} onClick={() => { stop(); setCheck("ok") }}>Looks good, turn it off</button>
            : <button type="button" style={btn("secondary")} onClick={() => void test()}>{check === "ok" ? "Check again" : "Check camera"}</button>}
        </div>
      </div>
      <div style={{ ...card, background: PEACH, borderColor: "rgba(255,107,0,0.25)" }}>
        <p style={{ ...p, margin: 0, color: NAVY }}>
          When you press Start the case, question 1 appears and its think time begins. Make sure you have 25 quiet minutes.
        </p>
        <div style={{ marginTop: 12 }}>
          <button type="button" style={btn("primary")} onClick={() => { stop(); onStart() }}>Start the case</button>
        </div>
      </div>
    </div>
  )
}

function Scenario({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ ...card, padding: "12px 16px" }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 15, fontWeight: 700, color: BLUE_INK }}>
        {open ? "Hide the case set-up" : "Show the case set-up"}
      </button>
      {open && text.split(/\n\n+/).map((t, i) => <p key={i} style={{ ...p, color: NAVY }}>{t}</p>)}
    </div>
  )
}

type Phase = "prep" | "starting" | "recording" | "saving" | "error"

function QuestionCard({ q, n, total, roundId, authFetch, onSaved }: {
  q: CaseQuestion; n: number; total: number; roundId: string; authFetch: AuthFetch; onSaved: () => Promise<void>
}) {
  const [phase, setPhase] = useState<Phase>(q.prep_seconds > 0 ? "prep" : "starting")
  const [msLeft, setMsLeft] = useState((q.prep_seconds > 0 ? q.prep_seconds : q.seconds) * 1000)
  const [err, setErr] = useState("")
  const [audioOnly, setAudioOnly] = useState(false)
  const shown = useRef<string>("")
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recs = useRef<{ main: MediaRecorder | null; audio: MediaRecorder | null }>({ main: null, audio: null })
  const tick = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAt = useRef<number>(0)
  const pending = useRef<{ main?: Blob; mainMime?: string; audio?: Blob; audioMime?: string; endedAt?: string; durationMs?: number } | null>(null)

  useEffect(() => { shown.current = shownAt(q.id) }, [q.id])

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])
  useEffect(() => () => { if (tick.current) clearInterval(tick.current); stopTracks() }, [stopTracks])

  const upload = useCallback(async () => {
    const pd = pending.current
    if (!pd?.main) return
    setPhase("saving"); setErr("")
    try {
      const put = async (blob: Blob, mime: string) => {
        const r = await authFetch(`/api/me/practice-rounds/${roundId}/upload-url`, { method: "POST", body: JSON.stringify({ question_id: q.id, mime }) })
        const j = await r.json()
        if (!r.ok || !j?.ok) throw new Error(j?.error ?? "Could not get an upload link")
        const res = await fetch(j.signed_url, { method: "PUT", headers: { "Content-Type": mime, "x-upsert": "true" }, body: blob })
        if (!res.ok) throw new Error(`Upload failed (${res.status})`)
        return j.path as string
      }
      const mainPath = await put(pd.main, pd.mainMime!)
      // The transcript copy is a nice-to-have on top of the answer itself:
      // if it fails, the answer is still saved and transcribed from the video.
      let audioPath: string | null = null
      if (pd.audio && pd.audio.size > 0) {
        try { audioPath = await put(pd.audio, pd.audioMime!) } catch (e) { console.warn("[case] audio copy did not upload", e) }
      }
      const reg = await authFetch(`/api/me/practice-rounds/${roundId}`, {
        method: "POST",
        body: JSON.stringify({
          action: "take", question_id: q.id, storage_path: mainPath, audio_path: audioPath,
          mime: pd.mainMime, duration_ms: pd.durationMs,
          question_shown_at: shown.current, response_started_at: new Date(startedAt.current).toISOString(),
          response_ended_at: pd.endedAt,
        }),
      })
      const rj = await reg.json()
      if (!reg.ok || !rj?.ok) throw new Error(rj?.error ?? "Could not save that answer")
      pending.current = null
      await onSaved()
    } catch (e: any) {
      setPhase("error")
      setErr(`Your answer is recorded but did not save: ${e?.message ?? e}. Check your connection and press Try again. Nothing is lost while this page stays open.`)
    }
  }, [authFetch, onSaved, q.id, roundId])

  // One start per answer. The think-time effect, the no-think-time effect and
  // the button can all ask, and React runs effects twice in development.
  const starting = useRef(false)
  const startRecording = useCallback(async () => {
    if (starting.current) return
    starting.current = true
    if (tick.current) clearInterval(tick.current)
    setPhase("starting"); setErr("")
    let stream: MediaStream
    let onlyAudio = false
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: true,
      })
    } catch (e: any) {
      if (e?.name === "NotAllowedError") {
        setPhase("error")
        setErr("SIGNAL needs your camera and microphone to record this answer. Allow them in your browser's address bar, then press Start answering.")
        starting.current = false
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        onlyAudio = true
      } catch (e2: any) {
        setPhase("error")
        setErr(`No microphone could be started: ${e2?.message ?? e2}. Plug one in or switch device, then press Start answering.`)
        starting.current = false
        return
      }
    }
    setAudioOnly(onlyAudio)
    streamRef.current = stream
    if (videoRef.current && !onlyAudio) {
      videoRef.current.srcObject = stream
      videoRef.current.muted = true
      await videoRef.current.play().catch(() => {})
    }

    const mainMime = onlyAudio ? pickAudioType() : pickMimeType()
    const audioMime = pickAudioType()
    const mainChunks: Blob[] = []
    const audioChunks: Blob[] = []
    let main: MediaRecorder
    try {
      main = mainMime ? new MediaRecorder(stream, { mimeType: mainMime }) : new MediaRecorder(stream)
    } catch (e: any) {
      stopTracks(); starting.current = false; setPhase("error"); setErr(`This browser refused to start recording: ${e?.message ?? e}`); return
    }
    let audio: MediaRecorder | null = null
    if (!onlyAudio && stream.getAudioTracks().length) {
      try {
        const as = new MediaStream(stream.getAudioTracks())
        audio = audioMime ? new MediaRecorder(as, { mimeType: audioMime }) : new MediaRecorder(as)
      } catch { audio = null }
    }
    recs.current = { main, audio }
    pending.current = {}
    let stopsLeft = audio ? 2 : 1
    const finished = () => {
      stopsLeft--
      if (stopsLeft > 0) return
      stopTracks()
      void upload()
    }
    main.ondataavailable = (ev) => { if (ev.data?.size) mainChunks.push(ev.data) }
    main.onstop = () => {
      const type = (main.mimeType || mainMime || (onlyAudio ? "audio/webm" : "video/webm")).split(";")[0]
      pending.current = { ...pending.current, main: new Blob(mainChunks, { type }), mainMime: type, endedAt: new Date().toISOString(), durationMs: Date.now() - startedAt.current }
      finished()
    }
    if (audio) {
      const a = audio
      a.ondataavailable = (ev) => { if (ev.data?.size) audioChunks.push(ev.data) }
      a.onstop = () => {
        const type = (a.mimeType || audioMime || "audio/webm").split(";")[0]
        pending.current = { ...pending.current, audio: new Blob(audioChunks, { type }), audioMime: type }
        finished()
      }
    }

    startedAt.current = Date.now()
    main.start(1000)
    audio?.start(1000)
    setMsLeft(q.seconds * 1000)
    setPhase("recording")
    tick.current = setInterval(() => {
      const left = q.seconds * 1000 - (Date.now() - startedAt.current)
      setMsLeft(left)
      if (left <= 0) stop()
    }, 200)
  }, [q.seconds, stopTracks, upload])

  /** Finish, or time up: both are an answer. */
  const stop = useCallback(() => {
    if (tick.current) clearInterval(tick.current)
    const { main, audio } = recs.current
    if (main && main.state !== "inactive") main.stop()
    if (audio && audio.state !== "inactive") audio.stop()
    recs.current = { main: null, audio: null }
  }, [])

  // Think time: count down from when the question first appeared, so a reload
  // does not reset it, then start recording by itself.
  useEffect(() => {
    if (phase !== "prep") return
    const t0 = new Date(shownAt(q.id)).getTime()
    const leftNow = () => q.prep_seconds * 1000 - (Date.now() - t0)
    // Already over (a reload after the think time ran out): straight to recording.
    if (leftNow() <= 0) { void startRecording(); return }
    setMsLeft(leftNow())
    tick.current = setInterval(() => {
      const left = leftNow()
      setMsLeft(left)
      if (left <= 0) { if (tick.current) clearInterval(tick.current); void startRecording() }
    }, 200)
    return () => { if (tick.current) clearInterval(tick.current) }
  }, [phase, q.id, q.prep_seconds, startRecording])

  // No think time: start as soon as the card is up.
  const autoStarted = useRef(false)
  useEffect(() => {
    if (phase === "starting" && q.prep_seconds <= 0 && !autoStarted.current) {
      autoStarted.current = true
      void startRecording()
    }
  }, [phase, q.prep_seconds, startRecording])

  const low = phase === "recording" && msLeft <= 15_000
  const limit = phase === "prep" ? q.prep_seconds * 1000 : q.seconds * 1000
  const pct = Math.max(0, Math.min(100, (msLeft / limit) * 100))

  return (
    <div style={{ ...card, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <span style={label}>Question {n} of {total}{q.title ? `: ${q.title}` : ""}</span>
        <span style={{ fontSize: 14, color: MUTED }}>
          {q.prep_seconds > 0 ? `Up to ${q.prep_seconds}s to think, then ` : ""}{formatClock(q.seconds * 1000)} to answer
        </span>
      </div>
      {q.exhibit && (
        <div style={{ background: PALE, borderRadius: 12, padding: "14px 16px", border: "1px solid rgba(0,155,255,0.25)" }}>
          <span style={{ ...label, color: "#00569A" }}>Information for this question</span>
          {q.exhibit.split("\n").map((l, i) => (
            <p key={i} style={{ margin: i ? "6px 0 0" : "8px 0 0", fontSize: 17, lineHeight: 1.45, color: NAVY, fontWeight: 600 }}>{l}</p>
          ))}
        </div>
      )}
      <p style={{ margin: 0, fontSize: 21, lineHeight: 1.4, color: NAVY, fontWeight: 650 }}>&ldquo;{q.text}&rdquo;</p>

      <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", maxHeight: 360, background: "#0D1829", borderRadius: 12, overflow: "hidden" }}>
        <video ref={videoRef} playsInline muted
          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", visibility: phase === "recording" && !audioOnly ? "visible" : "hidden" }} />
        {!(phase === "recording" && !audioOnly) && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 16, textAlign: "center", color: "rgba(255,255,255,0.8)", fontSize: 16, lineHeight: 1.45 }}>
            {phase === "prep" ? <span><strong style={{ fontSize: 34, display: "block", color: "#fff", fontVariantNumeric: "tabular-nums" }}>{formatClock(msLeft)}</strong>Think time. Recording starts when it runs out.</span>
              : phase === "starting" ? "Starting your camera..."
              : phase === "recording" ? "Recording audio. The camera could not start, so this answer is audio only."
              : phase === "saving" ? "Saving your answer..."
              : "Recording stopped."}
          </div>
        )}
        {phase === "recording" && (
          <div aria-live="polite" style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 8, alignItems: "center", background: "rgba(4,6,15,0.66)", color: "#fff", padding: "6px 12px", borderRadius: 999, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#C0322F" }} />
            <span style={{ color: low ? "#FF9B80" : "#fff" }}>{formatClock(msLeft)}</span>
          </div>
        )}
      </div>

      {(phase === "prep" || phase === "recording") && (
        <div style={{ height: 5, background: "rgba(8,32,63,0.10)", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: phase === "prep" ? BLUE : low ? ORANGE : TEAL, transition: "width 200ms linear" }} />
        </div>
      )}

      {err && <p style={{ ...p, margin: 0, color: ERROR }} role="alert">{err}</p>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {phase === "prep" && <button type="button" style={btn("primary")} onClick={() => void startRecording()}>Start answering now</button>}
        {phase === "recording" && <button type="button" style={btn("primary")} onClick={stop}>Finish answer ({formatClock(msLeft)} left)</button>}
        {phase === "error" && pending.current?.main && <button type="button" style={btn("primary")} onClick={() => void upload()}>Try again</button>}
        {phase === "error" && !pending.current?.main && <button type="button" style={btn("primary")} onClick={() => void startRecording()}>Start answering</button>}
        {phase === "recording" && <span style={{ fontSize: 15, color: MUTED }}>Lead with your main point. Stop when you have made it.</span>}
      </div>
    </div>
  )
}

function SelfAssessment({ round, authFetch, reload }: { round: CaseRound; authFetch: AuthFetch; reload: () => Promise<void> }) {
  const qs = round.self_assessment.questions
  const [answers, setAnswers] = useState<Record<string, string>>(() => ({ ...round.self_assessment.answers }))
  const [saved, setSaved] = useState("")
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  const dirty = useRef(false)

  const save = useCallback(async (a: Record<string, string>) => {
    const r = await authFetch(`/api/me/practice-rounds/${round.id}`, { method: "POST", body: JSON.stringify({ action: "self_assessment", answers: a }) })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j?.ok) throw new Error(j?.error ?? "Could not save")
    setSaved(new Date().toLocaleTimeString())
  }, [authFetch, round.id])

  useEffect(() => {
    if (!dirty.current) return
    const t = setTimeout(() => { save(answers).catch((e) => setErr(String(e?.message ?? e))) }, 900)
    return () => clearTimeout(t)
  }, [answers, save])

  const complete = qs.every((q) => (answers[q.key] ?? "").trim())
  const submit = async () => {
    setBusy(true); setErr("")
    try {
      await save(answers)
      const r = await authFetch(`/api/me/practice-rounds/${round.id}`, { method: "POST", body: JSON.stringify({ action: "submit" }) })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? "Could not submit")
      await reload()
    } catch (e: any) {
      setErr(String(e?.message ?? e))
    }
    setBusy(false)
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...card, background: PALE, borderColor: "rgba(0,155,255,0.25)" }}>
        <span style={label}>Case complete</span>
        <p style={{ ...p, color: NAVY, marginBottom: 0 }}>
          All {round.total} answers are saved. Before you send it, take five minutes to look back. Be honest: this is for you and {round.coach_name}, and it shapes Sunday&rsquo;s session.
        </p>
      </div>
      {qs.map((q, i) => (
        <div key={q.key} style={card}>
          <label htmlFor={`sa-${q.key}`} style={{ display: "flex", gap: 12, alignItems: "baseline", fontSize: 18, fontWeight: 650, color: NAVY, lineHeight: 1.4 }}>
            <span style={num}>{i + 1}</span>{q.question}
          </label>
          <textarea id={`sa-${q.key}`} rows={3} value={answers[q.key] ?? ""}
            onChange={(e) => { dirty.current = true; setAnswers((a) => ({ ...a, [q.key]: e.target.value })) }}
            style={{ marginTop: 10, width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 16, lineHeight: "24px", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(8,32,63,0.22)", color: NAVY, resize: "vertical" }} />
        </div>
      ))}
      {err && <p style={{ ...p, color: ERROR }} role="alert">{err}</p>}
      <div style={{ ...card, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" disabled={!complete || busy} onClick={() => void submit()}
          style={{ ...btn("primary"), ...(complete ? {} : { background: "rgba(8,32,63,0.18)", color: "rgba(8,32,63,0.55)", cursor: "not-allowed" }) }}>
          {busy ? "Sending..." : `Send to ${round.coach_name}`}
        </button>
        <span style={{ fontSize: 15, color: MUTED }}>
          {complete ? (saved ? `Saved at ${saved}.` : "Ready to send.") : "Answer all five to send. Your answers save as you type."}
        </span>
      </div>
    </div>
  )
}

const NAVY = "#08203F"
const BLUE = "#009BFF"
const BLUE_INK = "#00569A"
const TEAL = "#00B3B3"
const ORANGE = "#FF6B00"
const PEACH = "#FFEEDC"
const PALE = "#E8FBFD"
const MUTED = "#46607A"
const ERROR = "#C0322F"
const p: React.CSSProperties = { fontSize: 16, lineHeight: "24px", color: MUTED, margin: "8px 0 0" }
const eyebrow: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: BLUE }
const label: React.CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: BLUE_INK, display: "block" }
const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid rgba(8,32,63,0.12)", borderRadius: 14, padding: "clamp(14px, 3.5vw, 20px)" }
const num: React.CSSProperties = { flexShrink: 0, width: 28, height: 28, borderRadius: "50%", background: "#DCEDF9", color: BLUE_INK, display: "inline-grid", placeItems: "center", fontWeight: 900, fontSize: 14 }
function btn(kind: "primary" | "secondary"): React.CSSProperties {
  return {
    padding: "12px 20px", borderRadius: 10, fontSize: 16, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", minHeight: 48,
    border: kind === "primary" ? "none" : "1px solid rgba(8,32,63,0.25)",
    background: kind === "primary" ? NAVY : "transparent", color: kind === "primary" ? "#fff" : NAVY,
  }
}
