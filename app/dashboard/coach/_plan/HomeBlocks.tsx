"use client"

// Coach Home's plan blocks: follow-ups due on client tasks, and clients by
// phase. Coach Home wraps each in its Section. Data: /api/coach/home/plan-blocks
// (lib/plan/home.ts). The third block, My active tasks, is the To-Do card.

import { useEffect, useState } from "react"
import Link from "next/link"
import { T } from "../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../lib/supabase-browser"

export type FollowUp = { task_id: string; task: string; client: string; href: string; released_at: string; days_waiting: number }
export type PhaseBucket = { key: string; label: string; clients: { coach_client_id: string; name: string; href: string }[] }
export type PlanBlocks = { follow_ups: FollowUp[]; clients_by_phase: PhaseBucket[] }

export function usePlanBlocks(): { data: PlanBlocks | null; error: string | null } {
  const [data, setData] = useState<PlanBlocks | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void (async () => {
      try {
        const { data: { session } } = await getSupabaseBrowser().auth.getSession()
        const token = session?.access_token || sessionStorage.getItem("signal_handoff_token")
        const res = await fetch("/api/coach/home/plan-blocks", { headers: { Authorization: `Bearer ${token}` } })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j?.ok) { setError(j?.error || "Couldn't load"); return }
        setData({ follow_ups: j.follow_ups, clients_by_phase: j.clients_by_phase })
      } catch {
        setError("Couldn't load")
      }
    })()
  }, [])
  return { data, error }
}

const muted = { color: T.MUTED, fontSize: 13, margin: "10px 0 0 0" } as const

/**
 * Each phase pill gets its own colour, in phase order, so the row reads at a
 * glance. Not started is always grey. Text stays navy on the light tints.
 */
const PHASE_PILL_COLORS = ["#009BFF", "#00B3B3", "#F5821F", "#7C5CFF", "#E5487F", "#2E9E4F", "#C9A227"]
const NOT_STARTED_COLOR = "#8A94A3"
export function pillColor(key: string, index: number): string {
  return key === "not_started" ? NOT_STARTED_COLOR : PHASE_PILL_COLORS[index % PHASE_PILL_COLORS.length]
}
const tint = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

export function FollowUpsBlock({ items, error }: { items: FollowUp[] | null; error: string | null }) {
  if (error) return <p style={{ ...muted, color: T.ERROR }}>{error}</p>
  if (!items) return null
  if (!items.length) return <p style={muted}>No client tasks have been waiting 3 days or more.</p>
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      {items.map((f) => (
        <Link key={f.task_id} href={f.href} data-testid="follow-up" style={{
          display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10,
          border: `1px solid ${T.BORDER_SOFT}`, textDecoration: "none", color: T.TEXT,
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 0 }}>
            {f.client}<span style={{ fontWeight: 400, color: T.MUTED }}> · {f.task}</span>
          </span>
          <span style={{ fontSize: 12, fontWeight: 800, color: T.INK_EMPHASIS, whiteSpace: "nowrap" }}>
            Waiting {f.days_waiting} days
          </span>
        </Link>
      ))}
    </div>
  )
}

export function ClientsByPhaseBlock({ buckets, error }: { buckets: PhaseBucket[] | null; error: string | null }) {
  const [picked, setPicked] = useState<string | null>(null)
  if (error) return <p style={{ ...muted, color: T.ERROR }}>{error}</p>
  if (!buckets) return null
  if (!buckets.some((b) => b.clients.length)) return <p style={muted}>No clients yet.</p>
  const shown = buckets.find((b) => b.key === picked) ?? null
  return (
    <div style={{ marginTop: 8 }}>
      <div role="group" aria-label="Filter clients by phase" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {buckets.map((b, i) => {
          const on = picked === b.key
          const color = pillColor(b.key, i)
          return (
            <button
              key={b.key}
              type="button"
              aria-pressed={on}
              onClick={() => setPicked(on ? null : b.key)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 999,
                border: `${on ? 2 : 1}px solid ${color}`, background: tint(color, on ? 0.22 : 0.1),
                color: "#08203F", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                boxShadow: on ? `0 0 0 3px ${tint(color, 0.18)}` : "none",
              }}
            >
              {b.label}
              <span style={{
                fontSize: 12, fontWeight: 900, color: "#fff", background: color, borderRadius: 999,
                minWidth: 20, padding: "1px 7px", textAlign: "center",
              }}>{b.clients.length}</span>
            </button>
          )
        })}
      </div>
      {shown && (
        <div data-testid="phase-clients" style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
          {shown.clients.length === 0 ? (
            <p style={muted}>No clients in {shown.label}.</p>
          ) : shown.clients.map((c) => (
            <Link key={c.coach_client_id} href={c.href} style={{ fontSize: 13, color: T.TEXT, textDecoration: "none", padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.BORDER_SOFT}` }}>
              {c.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
