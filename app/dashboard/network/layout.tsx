"use client"

// Shared shell for the Network Tracker area: a tab strip across the three
// lenses on the same data. The URL is the state — the active tab is derived
// from the pathname, and each tab is a real route (deep-linkable, and the
// dashboard nav-highlight works). Children render their own <main>.
//   Dashboard /dashboard/network              — worklist + metrics (front door)
//   Contacts  /dashboard/network/contacts     — full roster, standalone included
//   Companies /dashboard/network/companies    — board by priority (Phase 5b)

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { T } from "../../../lib/dashboard-theme"
import { rememberOrigin } from "./backTarget"
import { VIEW_LABELS } from "./vocab"

const TABS = [
  { href: "/dashboard/network", label: VIEW_LABELS.dashboard.tab, exact: true },
  { href: "/dashboard/network/contacts", label: VIEW_LABELS.contacts.tab, exact: false },
  { href: "/dashboard/network/companies", label: VIEW_LABELS.companies.tab, exact: false },
  { href: "/dashboard/network/profile", label: VIEW_LABELS.profile.tab, exact: false },
  { href: "/dashboard/network/templates", label: VIEW_LABELS.templates.tab, exact: false },
]

export default function NetworkLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // Record where the user is so a contact record can send them back there.
  // Done in the LAYOUT so every lens is covered by one hook — including any
  // added later — rather than instrumenting each list page and forgetting one.
  // Reads location directly instead of useSearchParams() so the layout does not
  // need a Suspense boundary; this only ever runs client-side in an effect.
  useEffect(() => {
    rememberOrigin(window.location.pathname + window.location.search)
  }, [pathname])

  function isActive(href: string, exact: boolean) {
    if (exact) return pathname === href
    return pathname === href || pathname.startsWith(href + "/")
  }

  return (
    <div>
      <nav
        style={{
          display: "flex",
          gap: 4,
          borderBottom: `1px solid ${T.BORDER_SOFT}`,
          padding: "0 24px",
        }}
      >
        {TABS.map((t) => {
          const active = isActive(t.href, t.exact)
          return (
            <a
              key={t.href}
              href={t.href}
              style={{
                padding: "14px 14px 12px",
                fontSize: 13,
                fontWeight: 800,
                color: active ? T.TEXT : T.MUTED,
                textDecoration: "none",
                borderBottom: `2px solid ${active ? T.WRN_ORANGE : "transparent"}`,
                marginBottom: -1,
              }}
            >
              {t.label}
            </a>
          )
        })}
      </nav>
      {children}
    </div>
  )
}
