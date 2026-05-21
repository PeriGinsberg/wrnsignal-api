"use client"

// Cross-client applications-recent surface (Phase 2 Commit 2.3).
//
// Backs the three application-count tile click destinations on Coach
// Home (Total Applications / Interviewing / Offers). The list is keyed
// to applications, not clients — distinct from the My Clients filtered
// view that 2.2 wired for the two client-count tiles.
//
// URL contract: ?status=all|interviewing|offer (default all). Heading
// + filter-chip label reflect the param. Each row deep-links into the
// owning client's Detail page → Job Tracker tab → application anchor.
//
// Beta banner + "Back to Dashboard" come from the coach layout — no
// per-page wiring.

import { useEffect, useMemo, useState, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { getSupabaseBrowser } from "../../../../lib/supabase-browser"
import { T, card, eyebrow } from "../../../../lib/dashboard-theme"
import { BackToDashboard } from "../BackToDashboard"

type StatusFilter = "all" | "interviewing" | "offer"
const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "Recent Applications",
  interviewing: "Recent Interviews",
  offer: "Recent Offers",
}
const CHIP_LABELS: Record<StatusFilter, string> = {
  all: "All applications",
  interviewing: "Interviewing",
  offer: "Offers",
}

type Row = {
  application_id: string
  job_title: string | null
  company: string | null
  application_status: string
  transition_timestamp: string
  client_profile_id: string
  client_name: string
  client_lifecycle_status: string
}

// Mirrors LifecycleStatusPill's palette (read-only here — clients aren't
// editable from this surface, just labeled).
const LIFECYCLE_STYLE: Record<string, { bg: string; color: string }> = {
  Prospect: { bg: "#F4A261", color: "#FFFFFF" },
  Active: { bg: "#2CA58D", color: "#FFFFFF" },
  Inactive: { bg: "#D1D5DB", color: "#333333" },
  Archived: { bg: "#333333", color: "#FFFFFF" },
}

// Mirrors the tracker page application_status pill styling.
const APP_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  saved: { bg: "rgba(255,255,255,0.07)", color: "#51ADE5" },
  applied: { bg: "rgba(254,176,106,0.15)", color: "#FEB06A" },
  interviewing: { bg: "rgba(167,139,250,0.15)", color: "#a78bfa" },
  offer: { bg: "rgba(74,222,128,0.15)", color: "#4ade80" },
  rejected: { bg: "rgba(248,113,113,0.10)", color: "#f87171" },
  withdrawn: { bg: "rgba(255,255,255,0.05)", color: "#94a3b8" },
  coach_recommended: { bg: "rgba(0,245,212,0.10)", color: "#00F5D4" },
}

function relativeDate(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const diffDays = Math.floor((Date.now() - t) / 86400000)
  if (diffDays <= 0) return "today"
  if (diffDays === 1) return "yesterday"
  if (diffDays < 7) return `${diffDays} days ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

async function getToken() {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

async function authFetch(url: string) {
  const token = await getToken()
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } })
}

export default function ApplicationsRecentPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const statusParam = searchParams.get("status")
  const status: StatusFilter =
    statusParam === "interviewing" || statusParam === "offer" ? statusParam : "all"

  const [rows, setRows] = useState<Row[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const url = `/api/coach/applications-recent?status=${encodeURIComponent(status)}`
    const res = await authFetch(url)
    if (res.status === 403) { setForbidden(true); setLoading(false); return }
    if (res.ok) {
      const j = await res.json()
      setRows(j.rows || [])
    }
    setLoading(false)
  }, [status])

  useEffect(() => { load() }, [load])

  function clearFilter() {
    if (status !== "all") router.push("/dashboard/coach/applications-recent?status=all")
  }

  if (loading) return (
    <div>
      <BackToDashboard />
      <p style={{ color: T.MUTED, fontSize: 13 }}>Loading...</p>
    </div>
  )

  if (forbidden) return (
    <div>
      <BackToDashboard />
      <div style={{ ...card, padding: 40, maxWidth: 480, textAlign: "center" }}>
        <div style={{ ...eyebrow, color: T.ERROR, marginBottom: 12 }}>ACCESS DENIED</div>
        <p style={{ color: T.TEXT, fontSize: 15, fontWeight: 900 }}>Coach access required</p>
      </div>
    </div>
  )

  const list = rows || []

  return (
    <div>
      <BackToDashboard />
      <div style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        background: T.BG,
        paddingBottom: 16,
        marginBottom: 4,
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
          {STATUS_LABELS[status]} <span style={{ color: T.DIM, fontWeight: 400, fontSize: 18 }}>({list.length})</span>
        </h1>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8 }}>
          Cross-client view. Past 30 days.
          {status === "offer" ? " Includes Archived clients." : " Active + Inactive clients."}
        </p>
        {status !== "all" && (
          <div style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(254,176,106,0.10)", border: "1px solid rgba(254,176,106,0.30)",
            color: "#FEB06A", borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 700,
          }}>
            <span>Filtered: {CHIP_LABELS[status]}</span>
            <button
              onClick={clearFilter}
              aria-label="Show all applications"
              title="Show all applications"
              style={{
                background: "none", border: "none", color: "#FEB06A",
                fontSize: 14, fontWeight: 900, cursor: "pointer",
                padding: 0, lineHeight: 1, fontFamily: "inherit",
              }}
            >×</button>
          </div>
        )}
      </div>

      <div style={{ ...card, padding: 20 }}>
        {list.length === 0 ? (
          <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>
            {status === "all"
              ? "No applications from your Active or Inactive clients in the past 30 days."
              : status === "interviewing"
                ? "No interviews from your Active or Inactive clients in the past 30 days."
                : "No offers from your clients in the past 30 days."}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* Column header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1.6fr 1.2fr 0.9fr 0.7fr",
              gap: 12,
              padding: "6px 14px",
              fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
              color: T.DIM,
            }}>
              <span>Client</span>
              <span>Role</span>
              <span>Company</span>
              <span>Status</span>
              <span style={{ textAlign: "right" }}>Date</span>
            </div>
            {list.map((row) => {
              const ls = LIFECYCLE_STYLE[row.client_lifecycle_status] || LIFECYCLE_STYLE.Active
              const ss = APP_STATUS_STYLE[row.application_status] || APP_STATUS_STYLE.saved
              // Two URL hints for the deep-link landing:
              //   - ?expand=app-<id>   tells Client Detail to open this
              //     card in its existing expanded state on mount
              //   - #app-<id>          drives the scrollIntoView useEffect
              //     so the now-expanded card is centered in the viewport
              const href = `/dashboard/coach/clients/${row.client_profile_id}?tab=tracker&expand=app-${row.application_id}#app-${row.application_id}`
              return (
                <div
                  key={row.application_id}
                  onClick={() => router.push(href)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.4fr 1.6fr 1.2fr 0.9fr 0.7fr",
                    gap: 12,
                    padding: "12px 14px",
                    background: "rgba(255,255,255,0.025)",
                    border: `1px solid ${T.BORDER_SOFT}`,
                    borderRadius: 10,
                    cursor: "pointer",
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{
                      fontSize: 13, fontWeight: 700, color: T.TEXT,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>{row.client_name}</span>
                    <span style={{
                      background: ls.bg, color: ls.color,
                      fontSize: 9, fontWeight: 900, padding: "2px 7px", borderRadius: 999,
                      whiteSpace: "nowrap", letterSpacing: 0.2,
                    }}>{row.client_lifecycle_status}</span>
                  </div>
                  <span style={{
                    fontSize: 13, color: T.TEXT,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{row.job_title || "—"}</span>
                  <span style={{
                    fontSize: 13, color: T.MUTED,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{row.company || "—"}</span>
                  <span style={{
                    background: ss.bg, color: ss.color,
                    fontSize: 10, fontWeight: 900, padding: "3px 10px", borderRadius: 999,
                    whiteSpace: "nowrap", justifySelf: "start",
                  }}>{row.application_status}</span>
                  <span style={{ fontSize: 12, color: T.DIM, textAlign: "right" }}>
                    {relativeDate(row.transition_timestamp)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
