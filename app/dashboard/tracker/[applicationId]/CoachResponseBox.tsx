"use client"

// "Let your coach know if you're interested." — the client's answer to a job
// their coach sourced for them.
//
// WHAT THIS REPLACES. Response buttons existed until 2026-08-04, when the Job
// Tracker rebuild deleted the inline accordion that housed them. That commit
// justified every other removal; this one went unlisted, and the result was a
// Required Action on the Coaching Hub that deep-linked to a page with no way to
// answer it. The action could never clear.
//
// The only thing that COULD clear it was "Mark all seen" on the tracker banner
// — a text button that wrote client_status 'interested' for every sourced job
// at once, telling the coach the client wanted things they had never looked at.
// That control is gone. This is the replacement, and the difference is the
// point: one job, named, with the answer the client actually gave.
//
// WHY IT SITS AT THE VERY TOP. Above the header and the action hero, because it
// is the only thing on the page addressed to someone else. Everything below is
// the client's own record of their own job; this is a question from their coach
// that is still open.
//
// COLOUR. Both choices are peach buttons — peach is action and only action, and
// declining is as much an action as accepting. They differ by TIER (filled vs
// outlined), which is what the tiers are for, so "Not interested" is available
// without being promoted. Not coral: nothing here is overdue or wrong. Not
// navy: navy is structure, and the hero below already owns it.

import { useCallback, useEffect, useState } from "react"
import { LIGHT as S, action as actionStyle, surfaceCard } from "../../../../lib/theme/surfaces"
import { authFetch } from "../../network/authFetch"
import { RESPONSE_CHOICES } from "../../../../lib/coachRecommendations"

type Rec = { id: string; application_id: string | null; client_status: string | null }

export function CoachResponseBox({
  applicationId,
  onResponded,
}: {
  applicationId: string
  /** Lets the page refetch so the History drawer picks up the new entry. */
  onResponded?: () => void
}) {
  const [rec, setRec] = useState<Rec | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    // Silent on failure. This box is an extra on a page that works without it;
    // an error banner for "we couldn't check whether your coach sent this"
    // would be noise on every non-coached job.
    try {
      const res = await authFetch("/api/coach/my-recommendations")
      if (!res.ok) return
      const j = await res.json().catch(() => null)
      const found = (j?.recommendations || []).find(
        (r: Rec) => r.application_id === applicationId && r.client_status === "new",
      )
      if (found) setRec(found)
    } catch {
      /* see above */
    }
  }, [applicationId])

  useEffect(() => { void load() }, [load])

  async function respond(value: string) {
    if (!rec || busy) return
    setBusy(value)
    setErr(null)
    const res = await authFetch(`/api/coach/my-recommendations/${rec.id}/respond`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_status: value }),
    }).catch(() => null)

    if (!res || !res.ok) {
      // The box STAYS on failure. Its predecessor swallowed errors and left the
      // client believing they had answered; the coach would have seen nothing.
      setBusy(null)
      setErr("That didn't save. Try again.")
      return
    }
    setRec(null)
    onResponded?.()
  }

  if (!rec) return null

  return (
    <section
      data-testid="coach-response-box"
      style={{ ...surfaceCard(S), padding: "18px 22px", marginTop: 14 }}
    >
      <p style={{ margin: 0, color: S.text.primary, fontSize: 16, fontWeight: 800 }}>
        Let your coach know if you&apos;re interested.
      </p>

      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        {RESPONSE_CHOICES.map((c, i) => (
          <button
            key={c.value}
            onClick={() => void respond(c.value)}
            disabled={!!busy}
            style={{
              ...actionStyle(S, i === 0 ? "primary" : "optional"),
              padding: "10px 18px", borderRadius: 10, fontSize: 14.5,
              fontFamily: "inherit", cursor: busy ? "default" : "pointer",
              opacity: busy && busy !== c.value ? 0.55 : 1,
            }}
          >
            {busy === c.value ? "Saving…" : c.label}
          </button>
        ))}
      </div>

      {err && (
        <p style={{ margin: "12px 0 0", color: S.meaning.error.ink, fontSize: 13.5, fontWeight: 700 }}>
          {err}
        </p>
      )}
    </section>
  )
}
