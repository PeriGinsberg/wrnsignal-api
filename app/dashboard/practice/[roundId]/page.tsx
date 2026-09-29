"use client"

// The client's practice round: one card per question, record each, submit.
//
// A separate page rather than a workbook section, because it is a different
// kind of thing: a short request with media attached, not a document they fill
// in over a week. It lives under /dashboard so the ordinary session guards it,
// which is also why the email can link straight here with no token to leak.

import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { getSupabaseBrowser } from "@/lib/supabase-browser"
import { Recorder } from "./Recorder"

type Question = { id: string; position: number; text: string; answered: boolean; takes: number }
type Round = {
  id: string
  title: string
  status: "draft" | "sent" | "submitted"
  submitted_at: string | null
  coach_name: string
  seconds: number
  questions: Question[]
}

export default function PracticeRoundPage() {
  const { roundId } = useParams<{ roundId: string }>()
  const router = useRouter()
  const [round, setRound] = useState<Round | null>(null)
  const [complete, setComplete] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    const { data: { session } } = await getSupabaseBrowser().auth.getSession()
    const token = session?.access_token
    return fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/me/practice-rounds/${roundId}`)
      const j = await res.json()
      if (!res.ok || !j?.ok) {
        setError(res.status === 404 ? "This practice round is not available." : j?.error ?? "Could not load this round.")
        setRound(null)
      } else {
        setRound(j.round)
        setComplete(!!j.complete)
        setError("")
      }
    } catch {
      setError("Could not reach SIGNAL. Check your connection and reload.")
    }
    setLoading(false)
  }, [authFetch, roundId])

  useEffect(() => { void load() }, [load])

  /**
   * Upload straight to storage, then tell SIGNAL where it went.
   *
   * Two steps on purpose: the function that authorises the write never touches
   * the bytes, so a 30 MB answer does not travel through it.
   */
  const upload = useCallback(
    async (questionId: string, blob: Blob, mime: string, durationMs: number) => {
      const res = await authFetch(`/api/me/practice-rounds/${roundId}/upload-url`, {
        method: "POST",
        body: JSON.stringify({ question_id: questionId, mime }),
      })
      const j = await res.json()
      if (!res.ok || !j?.ok) throw new Error(j?.error ?? "Could not get an upload link")

      const put = await fetch(j.signed_url, {
        method: "PUT",
        headers: { "Content-Type": mime, "x-upsert": "true" },
        body: blob,
      })
      if (!put.ok) throw new Error(`Upload failed (${put.status})`)

      const reg = await authFetch(`/api/me/practice-rounds/${roundId}`, {
        method: "POST",
        body: JSON.stringify({
          action: "take", question_id: questionId, storage_path: j.path, mime, duration_ms: durationMs,
        }),
      })
      const rj = await reg.json()
      if (!reg.ok || !rj?.ok) throw new Error(rj?.error ?? "Could not save that answer")
      await load()
    },
    [authFetch, load, roundId],
  )

  const submit = useCallback(async () => {
    setSubmitting(true)
    try {
      const res = await authFetch(`/api/me/practice-rounds/${roundId}`, {
        method: "POST", body: JSON.stringify({ action: "submit" }),
      })
      const j = await res.json()
      if (!res.ok || !j?.ok) setError(j?.error ?? "Could not submit")
      else await load()
    } catch {
      setError("Could not submit. Check your connection and try again.")
    }
    setSubmitting(false)
  }, [authFetch, load, roundId])

  if (loading) return <Shell><p style={p}>Loading...</p></Shell>
  if (error && !round) return <Shell><p style={{ ...p, color: "#C0322F" }}>{error}</p></Shell>
  if (!round) return null

  const done = round.status === "submitted"

  return (
    <Shell>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 22 }}>
        <span style={eyebrow}>PRACTICE ROUND</span>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2, color: "#08203F" }}>{round.title}</h1>
        <p style={{ ...p, margin: 0 }}>
          {done
            ? `Sent to ${round.coach_name}. They will watch these back and come back to you.`
            : `${round.coach_name} picked ${round.questions.length} question${round.questions.length === 1 ? "" : "s"} for you. Press Start recording and the camera comes on straight away, ${round.seconds} seconds per answer. Cancel throws a take away without saving it, so you can go again as many times as you like. Finish saves that answer and locks it in. When all of them are answered, send the round.`}
        </p>
      </div>

      {done ? (
        <div style={card}>
          <p style={{ ...p, margin: 0, fontWeight: 700, color: "#00757A" }}>Submitted. Nothing else to do here.</p>
        </div>
      ) : (
        <>
          {round.questions.map((q, i) => (
            <div key={q.id} style={{ ...card, marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "baseline", marginBottom: 12 }}>
                <span style={num}>{i + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 18, lineHeight: 1.4, color: "#08203F", fontWeight: 600 }}>{q.text}</p>

                </div>
              </div>
              <Recorder
                seconds={round.seconds}
                locked={q.answered}
                onRecorded={(blob, mime, ms) => upload(q.id, blob, mime, ms)}
              />
            </div>
          ))}

          {error && <p style={{ ...p, color: "#C0322F" }} role="alert">{error}</p>}

          <div style={{ ...card, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={() => void submit()} disabled={!complete || submitting}
              style={{
                padding: "12px 20px", borderRadius: 10, fontSize: 16, fontWeight: 800, minHeight: 44,
                border: "none", cursor: complete ? "pointer" : "not-allowed",
                background: complete ? "#08203F" : "rgba(8,32,63,0.18)",
                color: complete ? "#fff" : "rgba(8,32,63,0.55)", fontFamily: "inherit",
              }}>
              {submitting ? "Sending..." : `Send to ${round.coach_name}`}
            </button>
            <span style={{ fontSize: 15, color: "#46607A" }}>
              {complete
                ? "Every question has an answer."
                : `Record an answer to every question first.`}
            </span>
          </div>
        </>
      )}

      <button type="button" onClick={() => router.push("/dashboard")}
        style={{ marginTop: 20, background: "none", border: "none", color: "#08203F", fontWeight: 700, cursor: "pointer", fontSize: 15, padding: "8px 0", fontFamily: "inherit" }}>
        Back to SIGNAL
      </button>
    </Shell>
  )
}

/**
 * The page paints its own ground rather than inheriting the shell's.
 *
 * This is a CLIENT page, and for a client the layout already resolves light
 * (it is in LIGHT_ROUTES). But `useLight` is also gated on the viewer not
 * being a coach, so a coach opening the same URL to see what their client sees
 * would get these white cards on the dark navy ground. A page that only looks
 * right for one of the two people who can open it is a page that will be
 * screenshotted wrong.
 */
/**
 * The ground is painted by <main> in the dashboard layout, which knows its own
 * padding. This used to cancel that padding with matching negative margins,
 * which was correct exactly until the padding changed for phone widths.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 720, margin: "0 auto" }}>{children}</div>
}

const p: React.CSSProperties = { fontSize: 16, lineHeight: "24px", color: "#46607A" }
const eyebrow: React.CSSProperties = {
  fontSize: 11, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase", color: "#009BFF",
}
const card: React.CSSProperties = {
  background: "#FFFFFF", border: "1px solid rgba(8,32,63,0.12)", borderRadius: 14,
  // Tighter on a phone so the video preview, which is the point of the card,
  // gets the width instead of the padding.
  padding: "clamp(12px, 3.5vw, 18px)",
}
const num: React.CSSProperties = {
  flexShrink: 0, width: 28, height: 28, borderRadius: "50%", background: "#DCEDF9", color: "#00569A",
  display: "grid", placeItems: "center", fontWeight: 900, fontSize: 14,
}
