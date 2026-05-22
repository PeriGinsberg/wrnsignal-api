"use client"

// useDropdownPlacement — viewport-collision-aware placement for inline
// pill/menu dropdowns. Returns "down" (default) or "up" depending on
// available space below vs. above the trigger element.
//
// Surfaced by Erin testing of TC-628: a status pill rendered near the
// bottom of the page opened its dropdown downward and got clipped,
// leaving the coach unable to see all options. This hook detects the
// collision and flips the dropdown above the trigger when there's not
// enough room below.
//
// Usage pattern (caller switches `top` for `bottom` based on placement):
//
//   const wrapRef = useRef<HTMLDivElement>(null)
//   const placement = useDropdownPlacement(wrapRef, open, 144)
//   ...
//   <div style={{
//     position: "absolute",
//     [placement === "up" ? "bottom" : "top"]: "calc(100% + 4px)",
//     ...
//   }}>
//
// estimatedHeight is a hardcoded guess (item count × row height +
// padding). Measuring the actual rendered height would be more
// accurate but requires a two-pass render (invisible measure, then
// position) — the estimate is good enough for our short menus and
// avoids the complexity. Document the estimate at the call site.

import { useLayoutEffect, useState, type RefObject } from "react"

export type DropdownPlacement = "down" | "up"

export function useDropdownPlacement(
  triggerRef: RefObject<HTMLElement | null>,
  open: boolean,
  estimatedHeight: number,
): DropdownPlacement {
  const [placement, setPlacement] = useState<DropdownPlacement>("down")

  useLayoutEffect(() => {
    if (!open) return
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // getBoundingClientRect returns viewport-relative coords, so this
    // works correctly even when the trigger is inside a scrollable
    // parent (the rect already accounts for scroll offset).
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    // Flip up only when both conditions hold: not enough room below
    // AND enough room above. If neither side fits, fall back to "down"
    // — the menu can scroll within the viewport, which is acceptable
    // for very small viewports.
    if (spaceBelow < estimatedHeight && spaceAbove > estimatedHeight) {
      setPlacement("up")
    } else {
      setPlacement("down")
    }
  }, [open, triggerRef, estimatedHeight])

  return placement
}
