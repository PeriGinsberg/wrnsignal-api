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
import { T } from "../../../../../lib/dashboard-theme"
import { SPACE, TYPE } from "../../../../../lib/theme/surfaces"
import {
  APP_STATUSES,
  APP_STATUS_STYLE,
  type ApplicationStatus,
} from "../../../../_lib/applicationStatuses"
import { useDropdownPlacement } from "../../useDropdownPlacement"

// Estimated dropdown height for placement detection. 6 options × ~28px
// row + 8px padding = ~176px. Bumped to 200 to leave headroom. See
// useDropdownPlacement.ts for why a hardcoded estimate is used.
const DROPDOWN_HEIGHT_ESTIMATE = 200

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
          fontSize: TYPE.label,
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
            fontSize: TYPE.label,
            color: T.ERROR,
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
            [placement === "up" ? "bottom" : "top"]: "calc(100% + 4px)",
            left: 0,
            // A POPUP IS A CARD. This was a hard-coded dark panel carrying
            // color: T.TEXT, and T.TEXT is a variable that resolves navy on
            // the light surface, so the options were navy on dark navy. It
            // only renders while the pill is open, which is why walking the
            // pages with a contrast probe never saw it.
            background: T.CARD,
            border: `1px solid ${T.BORDER}`,
            borderRadius: 8,
            boxShadow: T.SHADOW_POPUP,
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
                  color: T.TEXT,
                  fontSize: TYPE.secondary,
                  fontWeight: isCurrent ? 900 : 700,
                  opacity: isCurrent ? 1 : 0.85,
                }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLButtonElement).style.background =
                    T.BORDER_SOFT
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
                  <span style={{ marginLeft: "auto", color: T.MUTED }}>
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
