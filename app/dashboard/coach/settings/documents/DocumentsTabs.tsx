"use client"

// Documents domain tab island. Structurally mirrors ProspectsTabs / ServicesTabs
// (owns the ?tab= URL state so it's ready to host sub-tabs later), but there is a
// single view today — Categories (the document-category management UI) — so the
// SettingsTabs bar is suppressed while only one tab is live. Add a second entry
// to TABS and the bar appears automatically; nothing else changes.

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { SettingsTabs, type SettingsTab } from "../SettingsTabs"
import { SettingsBlock } from "../SettingsBlock"
import { DocumentsTab } from "./DocumentsTab"

const TABS: SettingsTab[] = [
  { key: "categories", label: "Categories" },
  // Future sub-tabs go here; the bar appears once there are 2+ live tabs.
]
const DEFAULT_TAB = "categories"

export function DocumentsTabs() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const liveTabs = TABS.filter((t) => !t.disabled)
  const known = new Set(liveTabs.map((t) => t.key))
  const urlTab = searchParams.get("tab")
  const active = urlTab && known.has(urlTab) ? urlTab : DEFAULT_TAB

  function select(key: string) {
    router.replace(`${pathname}?tab=${key}`, { scroll: false })
  }

  return (
    <div>
      {liveTabs.length > 1 && <SettingsTabs tabs={TABS} activeKey={active} onSelect={select} />}
      {active === "categories" && (
        <SettingsBlock title="Document Categories">
          <DocumentsTab />
        </SettingsBlock>
      )}
    </div>
  )
}
