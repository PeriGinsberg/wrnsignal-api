"use client"

// MetricsWindowToggle — three-segment time-window control for the
// coach metric tiles (Phase 5).
//
// Renders on Coach Home (above MetricsBar) and Client Dashboard
// (above MetricsTiles). Value is persisted to localStorage under
// `coach_metrics_window` so the coach's preference survives navigation
// and reload, and is shared across both surfaces — the coach's window
// preference is global, not per-surface.
//
// API contract: the parent passes the value as a `?window=7d|30d|all`
// query param to /api/coach/home and /api/coach/clients/[id]/metrics.
// Both endpoints default to "30d" if the param is missing or invalid,
// preserving backward compatibility for any other callers.

import { useEffect, useState } from "react"
import { T } from "../../../lib/dashboard-theme"

export type MetricsWindow = "7d" | "30d" | "all"

const STORAGE_KEY = "coach_metrics_window"
const VALID_VALUES: readonly MetricsWindow[] = ["7d", "30d", "all"] as const

const OPTIONS: Array<{ value: MetricsWindow; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
]

// Lazy initializer keeps the first paint on the same value the
// useEffect-based fetch will use, eliminating a double-fetch on
// initial mount. Wrapped in typeof window check so SSR-time render
// falls back to the default ("30d") rather than throwing.
function readStoredWindow(): MetricsWindow {
  if (typeof window === "undefined") return "30d"
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (v && (VALID_VALUES as readonly string[]).includes(v)) {
      return v as MetricsWindow
    }
  } catch {
    // localStorage can throw in private browsing / quota-exceeded cases.
    // Falling back to default is safer than surfacing the error.
  }
  return "30d"
}

// Hook for parent pages — handles localStorage read on mount + write
// on change. Returns the same shape as useState.
//
// Pattern note: starts as "30d" on server-render, syncs to the stored
// value in a useEffect after mount. The double-render is intentional
// — touching localStorage in the useState initializer would create a
// hydration mismatch (server says "30d", client says "7d"). The
// useEffect approach is the React-recommended way to read browser-only
// storage in a client component that's still SSR'd by Next.js.
export function useMetricsWindow(): [MetricsWindow, (v: MetricsWindow) => void] {
  const [value, setValueState] = useState<MetricsWindow>("30d")

  useEffect(() => {
    setValueState(readStoredWindow())
  }, [])

  const setValue = (v: MetricsWindow) => {
    setValueState(v)
    if (typeof window === "undefined") return
    try {
      window.localStorage.setItem(STORAGE_KEY, v)
    } catch {
      // Same private-browsing guard as the read path.
    }
  }

  return [value, setValue]
}

// Subtitle text helper. Re-exported so callers don't have to import
// the OPTIONS array just for this lookup.
export function windowSubtitle(w: MetricsWindow): string {
  if (w === "7d") return "Past 7 days"
  if (w === "30d") return "Past 30 days"
  return "All time"
}

type Props = {
  value: MetricsWindow
  onChange: (v: MetricsWindow) => void
}

export function MetricsWindowToggle({ value, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="Metrics time window"
      style={{
        display: "inline-flex",
        background: "rgba(255,255,255,0.04)",
        border: `1px solid ${T.BORDER_SOFT}`,
        borderRadius: 10,
        padding: 3,
        gap: 2,
      }}
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.4,
              padding: "7px 14px",
              borderRadius: 7,
              border: "none",
              cursor: "pointer",
              background: active ? "#2CA58D" : "transparent",
              color: active ? "#04060F" : T.MUTED,
              transition: "background 120ms ease, color 120ms ease",
            }}
            onMouseEnter={(e) => {
              if (!active) {
                ;(e.currentTarget.style as any).background = "rgba(255,255,255,0.04)"
                ;(e.currentTarget.style as any).color = T.TEXT
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                ;(e.currentTarget.style as any).background = "transparent"
                ;(e.currentTarget.style as any).color = T.MUTED
              }
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
