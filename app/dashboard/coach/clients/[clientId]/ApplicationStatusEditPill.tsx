"use client"

// Inline status edit pill for coach-side Job Tracker cards.
//
// Pattern matches the Phase 1 LifecycleStatusPill: click the pill →
// 4-or-more-option popover → pick a value → PATCH the API → optimistic
// local update. Stops click propagation so the surrounding card header
// (which toggles expand/collapse on click) doesn't fire.
//
// Status detection: 'coach_recommended' is intentionally NOT pickable
// (it's a system-set state from the rec-creation flow). When the card's
// CURRENT status is 'coach_recommended', the pill still displays it
// with the canonical color; the dropdown lets the coach pick any of
// the 6 standard values to transition the app forward.

import { useEffect, useRef, useState } from "react"
import {
  APP_STATUSES,
  APP_STATUS_STYLE,
  type ApplicationStatus,
} from "../../../../_lib/applicationStatuses"

type Props = {
  value: string
  getToken: () => Promise<string | null>
  clientProfileId: string
  applicationId: string
  onChange?: (next: ApplicationStatus) => void
}

export function ApplicationStatusEditPill({
  value,
  getToken,
  clientProfileId,
  applicationId,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

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

  // Display the current value with its canonical color, even when the
  // value is 'coach_recommended' (not pickable but still displayable).
  const currentStyle = APP_STATUS_STYLE[value] ?? APP_STATUS_STYLE.saved

  async function setStatus(next: ApplicationStatus) {
    if (next === value) {
      setOpen(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const token = await getToken()
      if (!token) {
        setError("Not signed in.")
        return
      }
      const res = await fetch(
        `/api/coach/clients/${clientProfileId}/applications/${applicationId}/status`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: next }),
        },
      )
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j?.error || "Failed to update status.")
        return
      }
      onChange?.(next)
    } catch {
      setError("Network error updating status.")
    } finally {
      setSaving(false)
      setOpen(false)
    }
  }

  return (
    <div
      ref={wrapRef}
      onClick={(e) => e.stopPropagation()}
      style={{ position: "relative", display: "inline-block" }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          if (!saving) setOpen((v) => !v)
        }}
        title="Change status"
        disabled={saving}
        style={{
          background: currentStyle.bg,
          color: currentStyle.color,
          fontSize: 10,
          fontWeight: 900,
          padding: "3px 10px",
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
      {error && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            fontSize: 10,
            color: "#f87171",
            whiteSpace: "nowrap",
            zIndex: 49,
          }}
        >
          {error}
        </div>
      )}
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            background: "#0D1F35",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8,
            boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
            padding: 4,
            minWidth: 160,
            zIndex: 50,
          }}
        >
          {APP_STATUSES.map((opt) => {
            const s = APP_STATUS_STYLE[opt]
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
                    border: `1px solid ${s.color}`,
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
