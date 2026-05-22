"use client"

// Coach-managed lifecycle status pill. Used on:
//   - app/dashboard/coach/page.tsx (Coach Home — top-5 row)
//   - app/dashboard/coach/clients/page.tsx (My Clients full roster row)
//   - app/dashboard/coach/clients/[clientId]/dashboard/ClientHeaderStrip.tsx
//
// Click the pill → 4-option dropdown → PATCH /api/coach/clients/[id]
// with { lifecycle_status }. Optimistic update via onChange callback;
// caller is responsible for rolling back on error.
//
// Internal column name: lifecycle_status. User-facing label: "Set Status".
// Never surface the word "lifecycle" in the UI.

import { useEffect, useRef, useState } from "react"
import { useDropdownPlacement } from "./useDropdownPlacement"

// Estimated dropdown height for placement detection. 4 options × ~28px
// row + 8px padding = ~120px. Bumped to 144 to leave headroom for the
// browser's variable font-rendering. See useDropdownPlacement.ts for
// why a hardcoded estimate is used instead of measuring.
const DROPDOWN_HEIGHT_ESTIMATE = 144

export type LifecycleStatus = "Prospect" | "Active" | "Inactive" | "Archived"

export const LIFECYCLE_STATUS_VALUES: LifecycleStatus[] = [
  "Prospect",
  "Active",
  "Inactive",
  "Archived",
]

// Brand palette per Phase 1 spec.
//   Prospect — Orange #F4A261  (tension / early-stage)
//   Active   — Teal   #2CA58D  (direction / positive engagement)
//   Inactive — M.Gray #D1D5DB  (clarity / paused)        dark text
//   Archived — D.Gray #333333  (clarity / closed)        white text
const PILL_STYLES: Record<
  LifecycleStatus,
  { bg: string; color: string }
> = {
  Prospect: { bg: "#F4A261", color: "#FFFFFF" },
  Active: { bg: "#2CA58D", color: "#FFFFFF" },
  Inactive: { bg: "#D1D5DB", color: "#333333" },
  Archived: { bg: "#333333", color: "#FFFFFF" },
}

type Props = {
  value: LifecycleStatus
  // Async getter — caller passes the bearer token at click time so the
  // pill doesn't need to know about auth plumbing. Returns null when the
  // user isn't signed in (pill stays read-only in that case).
  getToken: () => Promise<string | null>
  clientProfileId: string
  onChange?: (next: LifecycleStatus) => void
  // Visual size variant. Row treatment is "sm"; header strip is "md".
  size?: "sm" | "md"
}

export function LifecycleStatusPill({
  value,
  getToken,
  clientProfileId,
  onChange,
  size = "sm",
}: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const placement = useDropdownPlacement(wrapRef, open, DROPDOWN_HEIGHT_ESTIMATE)

  useEffect(() => {
    if (!open) return
    function onClickAway(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onClickAway)
    return () => document.removeEventListener("mousedown", onClickAway)
  }, [open])

  const style = PILL_STYLES[value] ?? PILL_STYLES.Active
  const padY = size === "md" ? 6 : 4
  const padX = size === "md" ? 14 : 10
  const fontSize = size === "md" ? 12 : 11

  async function setStatus(next: LifecycleStatus) {
    if (next === value) {
      setOpen(false)
      return
    }
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) {
        alert("Not signed in.")
        return
      }
      const res = await fetch(`/api/coach/clients/${clientProfileId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ lifecycle_status: next }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j?.error || "Failed to update status.")
        return
      }
      onChange?.(next)
    } catch {
      alert("Network error updating status.")
    } finally {
      setSaving(false)
      setOpen(false)
    }
  }

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (!saving) setOpen((v) => !v)
        }}
        title="Set Status"
        disabled={saving}
        style={{
          background: style.bg,
          color: style.color,
          fontSize,
          fontWeight: 900,
          padding: `${padY}px ${padX}px`,
          borderRadius: 999,
          border: "none",
          cursor: saving ? "wait" : "pointer",
          whiteSpace: "nowrap",
          opacity: saving ? 0.6 : 1,
          fontFamily: "inherit",
          letterSpacing: 0.2,
        }}
      >
        {value} ▾
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            [placement === "up" ? "bottom" : "top"]: "calc(100% + 4px)",
            left: 0,
            background: "#0D1F35",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8,
            boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
            padding: 4,
            minWidth: 140,
            zIndex: 50,
          }}
        >
          {LIFECYCLE_STATUS_VALUES.map((opt) => {
            const s = PILL_STYLES[opt]
            const isCurrent = opt === value
            return (
              <button
                key={opt}
                onClick={() => setStatus(opt)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  background: "none",
                  border: "none",
                  padding: "6px 8px",
                  borderRadius: 6,
                  cursor: "pointer",
                  textAlign: "left",
                  fontFamily: "inherit",
                  color: "rgba(255,255,255,0.92)",
                  fontSize: 12,
                  fontWeight: isCurrent ? 900 : 700,
                  opacity: isCurrent ? 1 : 0.85,
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background =
                    "rgba(255,255,255,0.06)"
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background = "none"
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: s.bg,
                  }}
                />
                {opt}
                {isCurrent && (
                  <span style={{ marginLeft: "auto", color: "rgba(255,255,255,0.45)" }}>
                    ✓
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
