// Loading shell for coach surfaces (Phase 4.3).
//
// Replaces the bare `<p>Loading...</p>` text that previously rendered
// on every coach page during initial mount. The text-only version was
// the source of the post-save "blank screen" flash diagnosed during
// Phase 4.1.5: when a save handler called loadAll() it flipped
// setLoading(true), unmounting the whole page tree and replacing the
// post-save success state with this dim line for the duration of the
// refetch. With LoadingShell only firing on the genuine initial mount
// (loadAll now supports a silent: true option), the flash is retired —
// but the initial-mount experience still deserves something better
// than a single line of grey text, hence this component.
//
// Visual: vertically-centered teal spinner + dim "Loading" subtext in
// a flex column. Pure CSS, no new deps. minHeight default 240px keeps
// the shell from collapsing flush against the page chrome.

import { SavingSpinner } from "./SavingSpinner"
import { T } from "../../../lib/dashboard-theme"

type Props = {
  minHeight?: number
  label?: string
}

export function LoadingShell({ minHeight = 240, label = "Loading" }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        minHeight,
        padding: 24,
      }}
    >
      <SavingSpinner size={22} />
      <span style={{ fontSize: 12, color: T.DIM, letterSpacing: 0.5 }}>{label}</span>
    </div>
  )
}
