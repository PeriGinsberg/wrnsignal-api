"use client"

// Required Actions full list (Sprint 3, 2026-05-08).
// v1: plain unfiltered list, same row format as the Coach Home Dashboard's
// Requires Action section. No grouping, no filtering, no sorting controls,
// no snooze/dismiss. Pulls from /api/coach/home — same heuristic outputs.
// Future iterations (post-pilot) layer on filtering / grouping / actions.

import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowser } from "../../../../lib/supabase-browser"
import { T, card, eyebrow } from "../../../../lib/dashboard-theme"

type ActionItem = {
  id: string
  kind:
    | "no_login"
    | "rec_pending_review"
    | "moved_interviewing"
    | "moved_rejected"
    | "offer_no_followup"
    | "poor_fit_no_rec"
  client_profile_id: string
  client_name: string
  message: string
  days_elapsed: number
}

const RULE_LABEL: Record<ActionItem["kind"], string> = {
  no_login: "Inactive",
  rec_pending_review: "Awaiting review",
  moved_interviewing: "Status change",
  moved_rejected: "Rejection",
  offer_no_followup: "Offer",
  poor_fit_no_rec: "Low-fit app",
}
const RULE_COLOR: Record<ActionItem["kind"], string> = {
  no_login: "#FEB06A",
  rec_pending_review: "#51ADE5",
  moved_interviewing: "#a78bfa",
  moved_rejected: "#E87070",
  offer_no_followup: "#4ade80",
  poor_fit_no_rec: "#FBBF24",
}

async function getToken() {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

async function authFetch(url: string, opts: RequestInit = {}) {
  const token = await getToken()
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  })
}

export default function RequiredActionsPage() {
  const router = useRouter()
  const [items, setItems] = useState<ActionItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await authFetch("/api/coach/home")
    if (res.status === 403) { setForbidden(true); setLoading(false); return }
    if (res.ok) {
      const j = await res.json()
      setItems(j.requiresAction || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading...</p>

  if (forbidden) {
    return (
      <div style={{ ...card, padding: 40, maxWidth: 480, textAlign: "center" }}>
        <div style={{ ...eyebrow, color: T.ERROR, marginBottom: 12 }}>ACCESS DENIED</div>
        <p style={{ color: T.TEXT, fontSize: 15, fontWeight: 900 }}>Coach access required</p>
      </div>
    )
  }

  const list = items || []

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 6 }}>COACHES CENTER</div>
        <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
          Required Actions <span style={{ color: T.DIM, fontWeight: 400, fontSize: 18 }}>({list.length})</span>
        </h1>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8 }}>
          Items needing your attention. Click any row to open that client.
        </p>
      </div>

      <div style={{ ...card, padding: 20 }}>
        {list.length === 0 ? (
          <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>
            Nothing requires your attention right now.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {list.map((item) => (
              <div
                key={item.id}
                onClick={() => router.push(`/dashboard/coach/clients/${item.client_profile_id}`)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "12px 14px",
                  background: "rgba(255,255,255,0.025)",
                  border: `1px solid ${T.BORDER_SOFT}`,
                  borderRadius: 10,
                  cursor: "pointer",
                }}
              >
                <span style={{
                  fontSize: 9, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase",
                  color: RULE_COLOR[item.kind], background: `${RULE_COLOR[item.kind]}1f`,
                  padding: "3px 8px", borderRadius: 6, flexShrink: 0,
                }}>
                  {RULE_LABEL[item.kind]}
                </span>
                <span style={{ fontSize: 13, color: T.TEXT, flex: 1 }}>{item.message}</span>
                <span style={{ fontSize: 11, color: T.DIM, flexShrink: 0 }}>{item.days_elapsed}d</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
