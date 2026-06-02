"use client"

// My Settings area shell (Step 4c).
//
// My Settings hosts several methodology-config DOMAINS over time (Prospects,
// Clients, Interviewing, …). This layout is the area chrome: a persistent
// left-hand sub-nav listing the domains + a content pane that renders the
// active domain sub-page (its own route under /dashboard/coach/settings/*).
//
// The sub-nav reuses the dashboard nav-item visual language (the same
// active/default treatment as the global left nav in app/dashboard/layout.tsx)
// rather than inventing a new one. Future domains become new routes + a new
// SUB_NAV entry; no restructure needed.

import { usePathname } from "next/navigation"
import { T, eyebrow } from "../../../../lib/dashboard-theme"
import { BackToDashboard } from "../BackToDashboard"

type SubNavItem = {
  key: string
  label: string
  href?: string
  // Disabled domains are shown but greyed (roadmap visibility) — not clickable.
  disabled?: boolean
}

const SUB_NAV: SubNavItem[] = [
  { key: "prospects", label: "Prospects", href: "/dashboard/coach/settings/prospects" },
  { key: "clients", label: "Clients", disabled: true },
  { key: "interviewing", label: "Interviewing", disabled: true },
]

export default function CoachSettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div>
      <BackToDashboard />

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
          My Settings
        </h1>
        <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8 }}>
          Configure how you work — independent of any one client or prospect.
        </p>
      </div>

      <div style={{ display: "flex", gap: 28, alignItems: "flex-start" }}>
        {/* Left sub-nav */}
        <nav style={{ width: 196, flexShrink: 0 }}>
          <div style={{ ...eyebrow, fontSize: 11, letterSpacing: 1.2, color: "rgba(255,255,255,0.42)", padding: "0 8px", marginBottom: 8 }}>
            DOMAINS
          </div>
          {SUB_NAV.map((item) => {
            const active = !!item.href && pathname.startsWith(item.href)
            const baseStyle: React.CSSProperties = {
              display: "block",
              padding: "10px 12px",
              marginBottom: 4,
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 900,
              textDecoration: "none",
              boxSizing: "border-box",
            }
            if (item.disabled) {
              return (
                <div
                  key={item.key}
                  style={{
                    ...baseStyle,
                    border: `1px solid ${T.BORDER_SOFT}`,
                    background: "transparent",
                    color: T.DIM,
                    cursor: "default",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{item.label}</span>
                  <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase", color: T.DIM }}>
                    Soon
                  </span>
                </div>
              )
            }
            return (
              <a
                key={item.key}
                href={item.href}
                style={{
                  ...baseStyle,
                  border: active ? `1px solid ${T.NAV_ACTIVE_BORDER}` : `1px solid ${T.BORDER_SOFT}`,
                  background: active ? T.NAV_ACTIVE_BG : T.NAV_DEFAULT_BG,
                  color: active ? T.WRN_ORANGE : T.TEXT,
                }}
              >
                {item.label}
              </a>
            )
          })}
        </nav>

        {/* Content pane — the active domain sub-page */}
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
    </div>
  )
}
