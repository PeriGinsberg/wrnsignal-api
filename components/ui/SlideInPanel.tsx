"use client"

import { useEffect, type ReactNode } from "react"
import { T } from "@/lib/dashboard-theme"

// Generic right-side slide-in shell. Visual + behavioral treatment mirrors
// app/dashboard/coach/clients/[clientId]/AddNotePanel.tsx (left untouched per
// FRD §6.5.0): same backdrop fade, panel width, translateX animation, z-index
// layering, and Esc-to-close. This is the shell only — it renders a pinned
// header (title + close) and a flex body for arbitrary children. Form logic
// lives in the composing component.
//
// Mid-flight close guarding (e.g. blocking close during a submit) is the
// composing component's responsibility: pass an onClose that no-ops while
// busy. Backdrop click, the × button, and Esc all route through that same
// onClose.

type Props = {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

export function SlideInPanel({ open, onClose, title, children }: Props) {
  // Esc closes (matches AddNotePanel). onClose is the single close path, so
  // a composing component that no-ops onClose while busy also blocks Esc.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(4, 6, 15, 0.55)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.18s ease-out",
          zIndex: 40,
        }}
      />

      {/* Slide-in panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title || "Panel"}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 460,
          maxWidth: "94vw",
          background: T.NAV_BG,
          borderLeft: `1px solid ${T.BORDER}`,
          boxShadow: "-20px 0 60px rgba(0,0,0,0.4)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.22s ease-out",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header (pinned) */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: `1px solid ${T.BORDER_SOFT}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 950, color: T.TEXT, letterSpacing: -0.3 }}>
            {title}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              color: T.MUTED,
              fontSize: 20,
              cursor: "pointer",
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Body — fills remaining height; children manage their own scroll
            area + pinned footer (matching AddNotePanel's layout). */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {children}
        </div>
      </div>
    </>
  )
}
