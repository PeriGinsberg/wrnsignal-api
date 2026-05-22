// Visibility icon for coach annotations (Phase 4.2).
// Renders an eye glyph for client-visible notes and a lock glyph for
// coach-private notes. Used on the Job Tracker per-application
// annotation list so the coach can scan note privacy at a glance
// without needing to expand or read note metadata.
//
// Inline SVG (no lucide-react dep) to match the pattern set by
// SavingSpinner.tsx — single source of truth, zero install footprint.

type Props = {
  visible: boolean
  size?: number
}

export function NoteVisibilityIcon({ visible, size = 12 }: Props) {
  // Color convention:
  //   - Visible to client → WRN Teal (positive/direction, matches the
  //     teal save-state spinner family).
  //   - Coach-private → WRN Goldenrod. Brand convention in the WRN
  //     methodology workbook is amber = coach-facing/internal content.
  //     Avoids the "red = error" mismatch (a private note isn't
  //     destructive; it's deliberate-internal) and contrasts against
  //     the dark navy background better than a dim gray.
  const teal = "#2CA58D"
  const goldenrod = "#E1A92E"
  const color = visible ? teal : goldenrod
  const labelText = visible ? "Visible to client" : "Coach-private note"

  return (
    <span
      role="img"
      aria-label={labelText}
      title={labelText}
      style={{
        display: "inline-flex",
        alignItems: "center",
        verticalAlign: "middle",
        flexShrink: 0,
      }}
    >
      {visible ? <EyeSvg size={size} color={color} /> : <LockSvg size={size} color={color} />}
    </span>
  )
}

function EyeSvg({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function LockSvg({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  )
}
