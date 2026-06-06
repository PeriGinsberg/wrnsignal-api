"use client"

// Services domain tab island (spec §4 Move 2 / §7). Structurally mirrors
// ProspectsTabs. Both Deliverables (the milestones catalog) and Packages (bundles
// of deliverables with live pricing) are LIVE. URL ?tab= is source of truth;
// default lands on Deliverables. Reuses SettingsTabs (the bar) + SettingsBlock
// (the card wrapper).

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { SettingsTabs, type SettingsTab } from "../SettingsTabs"
import { SettingsBlock } from "../SettingsBlock"
import { DeliverablesTab } from "./DeliverablesTab"
import { PackagesTab } from "./PackagesTab"

const TABS: SettingsTab[] = [
  { key: "deliverables", label: "Deliverables" },
  { key: "packages", label: "Packages" },
]
const DEFAULT_TAB = "deliverables"

export function ServicesTabs() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const known = new Set(TABS.filter((t) => !t.disabled).map((t) => t.key))
  const urlTab = searchParams.get("tab")
  const active = urlTab && known.has(urlTab) ? urlTab : DEFAULT_TAB

  function select(key: string) {
    router.replace(`${pathname}?tab=${key}`, { scroll: false })
  }

  return (
    <div>
      <SettingsTabs tabs={TABS} activeKey={active} onSelect={select} />
      {active === "deliverables" && (
        <SettingsBlock title="Deliverables">
          <DeliverablesTab />
        </SettingsBlock>
      )}
      {active === "packages" && (
        <SettingsBlock title="Packages">
          <PackagesTab />
        </SettingsBlock>
      )}
    </div>
  )
}
