"use client"

// Prospects domain tab island (spec §4 Move 2 / §5). Owns the ?tab= URL state
// and renders the active tab's content. One live tab today — Pipeline (the
// existing MyPipelineSection, unchanged). URL is source of truth so tabs are
// shareable + refresh-stable; switching is client-side (router.replace), no
// server round-trip.

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { SettingsTabs, type SettingsTab } from "../SettingsTabs"
import { SettingsBlock } from "../SettingsBlock"
import { MyPipelineSection } from "./MyPipelineSection"

const TABS: SettingsTab[] = [
  { key: "pipeline", label: "Pipeline" },
  // Future: { key: "capture", label: "Capture defaults", disabled: true }, etc.
]
const DEFAULT_TAB = "pipeline"

export function ProspectsTabs() {
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
      {active === "pipeline" && (
        <SettingsBlock title="My Pipeline">
          <MyPipelineSection />
        </SettingsBlock>
      )}
    </div>
  )
}
