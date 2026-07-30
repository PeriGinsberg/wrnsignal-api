"use client"

// A "?" that answers one specific confusion in one or two plain sentences.
//
// Popover, never a modal: the whole point is not leaving the thing you were
// looking at. Closes on outside click, on Escape, and on a second click of the
// "?" itself.

import { useEffect, useRef, useState } from "react"
import { T, card } from "../../../../lib/dashboard-theme"

export function HelpTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        data-testid={`help-${label}`}
        style={{
          width: 16, height: 16, borderRadius: 999, flex: "0 0 auto",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: "none", border: `1px solid ${T.BORDER}`, color: T.DIM,
          fontSize: 10, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", padding: 0,
        }}
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          data-testid={`help-panel-${label}`}
          style={{
            ...card, position: "absolute", zIndex: 30, top: "calc(100% + 7px)", left: 0,
            width: 268, padding: "11px 13px", boxShadow: T.SHADOW_POPUP,
            color: T.TEXT, fontSize: 12, lineHeight: "18px", fontWeight: 400,
            textTransform: "none", letterSpacing: 0,
          }}
        >
          {children}
        </span>
      )}
    </span>
  )
}
