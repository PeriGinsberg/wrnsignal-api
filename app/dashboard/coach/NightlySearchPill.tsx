"use client"

// "Nightly Search" pill: the client is included in the nightly job-sourcing
// run (lib/match/nightlySearch.ts). Same size and shape as LifecycleStatusPill
// ("sm" on list rows, "md" in the client header strip), without the dropdown:
// it reports state, it doesn't set it. Used on:
//   - app/dashboard/coach/clients/page.tsx (My Clients rows)
//   - app/dashboard/coach/clients/[clientId]/dashboard/ClientHeaderStrip.tsx

export function NightlySearchPill({ size = "sm" }: { size?: "sm" | "md" }) {
  const padY = size === "md" ? 6 : 4
  const padX = size === "md" ? 14 : 10
  const fontSize = size === "md" ? 12 : 11
  return (
    <span
      title="Included in the nightly job search"
      style={{
        background: "var(--sig-pill-nightly-bg, #E0117A)",
        color: "var(--sig-pill-nightly-ink, #FFFFFF)",
        fontSize,
        fontWeight: 900,
        padding: `${padY}px ${padX}px`,
        borderRadius: 999,
        whiteSpace: "nowrap",
        letterSpacing: 0.2,
        lineHeight: "normal",
      }}
    >
      Nightly Search
    </span>
  )
}
