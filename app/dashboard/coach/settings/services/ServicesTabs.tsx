"use client"

// Services domain tab island (spec §4 Move 2 / §7). Structurally mirrors
// ProspectsTabs. Both tabs — Deliverables and Packages — are "Soon" today
// (no content; future phases), so there is no live/selectable tab: the bar
// shows both greyed "Soon" tabs and the content area shows an empty state.
// URL ?tab= plumbing is kept identical to Prospects so a tab goes live by
// flipping disabled:false later. Reuses SettingsTabs from Step 2.

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { T } from "../../../../../lib/dashboard-theme"
import { SettingsTabs, type SettingsTab } from "../SettingsTabs"

const TABS: SettingsTab[] = [
  { key: "deliverables", label: "Deliverables", disabled: true },
  { key: "packages", label: "Packages", disabled: true },
]

export function ServicesTabs() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Honor ?tab= only if it points at an ENABLED tab (none yet). Otherwise no
  // tab is active — we do NOT force-select a disabled tab.
  const known = new Set(TABS.filter((t) => !t.disabled).map((t) => t.key))
  const urlTab = searchParams.get("tab")
  const active = urlTab && known.has(urlTab) ? urlTab : ""

  function select(key: string) {
    router.replace(`${pathname}?tab=${key}`, { scroll: false })
  }

  return (
    <div>
      <SettingsTabs tabs={TABS} activeKey={active} onSelect={select} />
      <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>
        Deliverables and Packages are coming soon.
      </p>
    </div>
  )
}
