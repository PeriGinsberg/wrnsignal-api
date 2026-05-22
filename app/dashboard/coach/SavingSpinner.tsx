"use client"

// Canonical saving-state spinner for Coaches Center save flows
// (Phase 4 Commit 4.1.5). Pure CSS inline keyframes — matches the
// pattern from app/dashboard/accept-invite, with the WRN-family color
// set to teal #2CA58D per the brand "direction/positive action" rule
// (orange reserved for tension/correction).
//
// Used by 8 save flows across the Coaches Center:
//   - AddNotePanel             save note
//   - Tracker card             + Add coaching note (annotate)
//   - Coach rec edit           save changes
//   - Source a Job             run SIGNAL analysis (step 2)
//   - Source a Job             send to dashboard (step 4)
//   - Profile & Personas       save resume
//   - NotesTab                 inline edit save
//   - Invite modal             send invite
//   - CreateClientModal        create account & send invite
//
// Single keyframes definition rendered alongside the spinner so we don't
// rely on a global stylesheet. Multiple instances on a page share the
// same animation name — fine, the keyframes is idempotent.
//
// Usage:
//   <SavingSpinner />              default 12px, teal
//   <SavingSpinner size={14} />    larger
//   <SavingSpinner color="#fff" /> override color (rare)

export type SavingSpinnerProps = {
  size?: number
  color?: string
}

export function SavingSpinner({ size = 12, color = "#2CA58D" }: SavingSpinnerProps) {
  return (
    <>
      <style>{`@keyframes coachSavingSpin { to { transform: rotate(360deg) } }`}</style>
      <span
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: size,
          height: size,
          borderRadius: "50%",
          border: `2px solid rgba(255,255,255,0.25)`,
          borderTopColor: color,
          animation: "coachSavingSpin 0.8s linear infinite",
          flexShrink: 0,
        }}
      />
    </>
  )
}
