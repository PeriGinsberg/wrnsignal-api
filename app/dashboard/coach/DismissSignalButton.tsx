"use client"

// Phase 3 Commit 3.2 — shared dismiss UI for engagement signal rows.
// Exports:
//   - DismissSignalButton    × icon button, hover-only visibility,
//                            stops click propagation
//   - SignalUndoToast        bottom-right toast with Undo button +
//                            5s auto-dismiss
//   - useDismissSignal()     hook that wires the dismiss + restore API
//                            calls and owns the toast state for a surface
//
// Used by:
//   - EngagementSignalsSection on Coach Home
//   - NeedsAttentionSection on Client Dashboard
//   - Required Actions full page (Engagement Signals section)
//
// Coach gestures sync across surfaces because the heuristic engine
// (app/api/_lib/coachEngagementHeuristics.ts) loads the dismissals
// table at the top of every runHeuristics() call and filters dismissed
// signal IDs. The hook's job is purely UX: optimistic remove, toast,
// undo.

import { useCallback, useEffect, useState } from "react"

// Match the engine's emitted shape — kept loose here so the consumer
// can pass any signal type with at least { id, kind }.
type SignalLike = { id: string; kind: string }

// ── Button ─────────────────────────────────────────────────────────

type DismissButtonProps = {
  onClick: () => void
  // Hover-only visibility is driven by the parent row's hover state
  // (the row's onMouseEnter/onMouseLeave should toggle this). Avoids
  // CSS sibling-selector gymnastics with inline styles.
  visible: boolean
  ariaLabel?: string
}

export function DismissSignalButton({
  onClick,
  visible,
  ariaLabel = "Dismiss signal",
}: DismissButtonProps) {
  const [hovered, setHovered] = useState(false)
  // Subtle muted gray → slightly-brighter neutral on hover. NOT brand
  // colors per design lock — "set aside, not delete."
  const baseColor = "rgba(255,255,255,0.35)"
  const hoverColor = "rgba(255,255,255,0.70)"
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={ariaLabel}
      title={ariaLabel}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 4,
        marginLeft: 6,
        lineHeight: 1,
        color: hovered ? hoverColor : baseColor,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 120ms ease, color 120ms ease",
        fontFamily: "inherit",
        fontSize: 16,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      ×
    </button>
  )
}

// ── Toast ──────────────────────────────────────────────────────────

type ToastEntry = {
  signalId: string
  signalKind: string
  // The full signal, kept for restore-to-local. Generic so any
  // consumer's signal type passes through.
  signal: any
  // Bottom-up index for stacking. Newer toasts render higher.
  index: number
}

type SignalUndoToastProps = {
  entries: ToastEntry[]
  onUndo: (entry: ToastEntry) => void
  onDismissToast: (signalId: string) => void
}

export function SignalUndoToast({
  entries,
  onUndo,
  onDismissToast,
}: SignalUndoToastProps) {
  if (entries.length === 0) return null
  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        display: "flex",
        flexDirection: "column-reverse",
        gap: 8,
        zIndex: 200,
        pointerEvents: "none",
      }}
    >
      {entries.map((e) => (
        <div
          key={e.signalId}
          style={{
            background: "rgba(13,31,53,0.96)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "10px 14px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            minWidth: 280,
            maxWidth: 380,
            boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
            pointerEvents: "auto",
          }}
        >
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.88)", flex: 1 }}>
            Dismissed engagement signal.
          </span>
          <button
            onClick={() => onUndo(e)}
            style={{
              background: "rgba(81,173,229,0.15)",
              border: "1px solid rgba(81,173,229,0.35)",
              color: "#51ADE5",
              borderRadius: 6,
              padding: "4px 12px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Undo
          </button>
          <button
            onClick={() => onDismissToast(e.signalId)}
            aria-label="Close toast"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 2,
              color: "rgba(255,255,255,0.45)",
              fontSize: 14,
              fontWeight: 700,
              fontFamily: "inherit",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

// ── Hook ───────────────────────────────────────────────────────────
//
// Owns the toast state for a single surface. The consumer wires:
//   - authFetch              the surface's existing bearer-token fetch
//   - onLocalRemove(id)      remove the signal from the surface's local
//                            array on optimistic dismiss + on confirmed
//                            success (idempotent)
//   - onLocalRestore(signal) put it back on Undo (or after error revert)
//
// Returns:
//   - dismiss(signal)        click handler for the × button
//   - toastNode              JSX to render at the bottom of the surface
//
// 5-second auto-dismiss per entry. Each dismissal stacks (no merging).
// Auto-dismiss = silently commit; user did NOT click Undo.

export function useDismissSignal<S extends SignalLike>(opts: {
  authFetch: (url: string, init?: RequestInit) => Promise<Response>
  onLocalRemove: (signalId: string) => void
  onLocalRestore: (signal: S) => void
}) {
  const { authFetch, onLocalRemove, onLocalRestore } = opts
  const [entries, setEntries] = useState<ToastEntry[]>([])
  const [counter, setCounter] = useState(0)

  // Garbage collect a toast entry after 5s. Stored timeouts so unmount
  // doesn't dangle. The hook recreates the timer per added entry; we
  // don't need to chase down which timer maps to which entry because
  // each timeout independently calls dismissToast(signalId).
  useEffect(() => {
    if (entries.length === 0) return
    const timers = entries.map((e) =>
      setTimeout(() => {
        setEntries((prev) => prev.filter((x) => x.signalId !== e.signalId))
      }, 5000),
    )
    return () => {
      for (const t of timers) clearTimeout(t)
    }
    // entries.length captures the count-of-toasts change; re-run on add/remove.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.length])

  const dismiss = useCallback(
    async (signal: S) => {
      // Optimistic remove + push the toast entry so Undo is available
      // even mid-flight on the dismiss API call.
      onLocalRemove(signal.id)
      const idx = counter
      setCounter((c) => c + 1)
      setEntries((prev) => [
        ...prev,
        { signalId: signal.id, signalKind: signal.kind, signal, index: idx },
      ])
      try {
        const res = await authFetch("/api/coach/engagement-signals/dismiss", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signal_key: signal.id }),
        })
        if (!res.ok) {
          // Revert: restore to local + drop the toast so the user isn't
          // misled into thinking it dismissed.
          onLocalRestore(signal)
          setEntries((prev) => prev.filter((x) => x.signalId !== signal.id))
        }
      } catch {
        onLocalRestore(signal)
        setEntries((prev) => prev.filter((x) => x.signalId !== signal.id))
      }
    },
    [authFetch, onLocalRemove, onLocalRestore, counter],
  )

  const onUndo = useCallback(
    async (entry: ToastEntry) => {
      // Optimistically restore + clear the toast. Then fire the restore
      // API. On API error, re-dismiss locally so state is consistent
      // with what's actually persisted.
      onLocalRestore(entry.signal as S)
      setEntries((prev) => prev.filter((x) => x.signalId !== entry.signalId))
      try {
        const res = await authFetch("/api/coach/engagement-signals/restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signal_key: entry.signalId }),
        })
        if (!res.ok) {
          onLocalRemove(entry.signalId)
        }
      } catch {
        onLocalRemove(entry.signalId)
      }
    },
    [authFetch, onLocalRemove, onLocalRestore],
  )

  const onDismissToast = useCallback((signalId: string) => {
    setEntries((prev) => prev.filter((x) => x.signalId !== signalId))
  }, [])

  return {
    dismiss,
    toastNode: <SignalUndoToast entries={entries} onUndo={onUndo} onDismissToast={onDismissToast} />,
    pendingDismissalCount: entries.length,
  }
}
