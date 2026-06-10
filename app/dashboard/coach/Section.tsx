import type { ReactNode } from "react"
import { T, card } from "@/lib/dashboard-theme"

// Generic section wrapper: card container + title + optional count + optional
// right-aligned header slot. Extracted from prospects/[id]/page.tsx — shared by
// the prospect + client detail pages and several in-page sections.
export function Section({
  title,
  count,
  headerRight,
  children,
}: {
  title: string
  count?: string
  headerRight?: ReactNode
  children: ReactNode
}) {
  return (
    <div style={{ ...card, padding: 20, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: T.TEXT, letterSpacing: -0.2 }}>
          {title}
        </span>
        {count && (
          <span style={{ fontSize: 12, color: T.DIM, fontWeight: 700 }}>{count}</span>
        )}
        {headerRight && <span style={{ marginLeft: "auto" }}>{headerRight}</span>}
      </div>
      {children}
    </div>
  )
}
