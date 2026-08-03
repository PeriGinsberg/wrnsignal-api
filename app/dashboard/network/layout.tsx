"use client"

// Shared shell for the Network Tracker area.
//
// Redesign step 3 (2026-08-03): the tab strip is GONE. Networking's views now
// nest under the one left nav (Companies, Contacts), so a strip here was a
// second nav saying the same thing one indent away. Removing it is what lets a
// redesigned page own its full width and start with its own heading.
//
// What is left is the origin-tracking effect, which is why this layout still
// exists rather than being deleted outright.
//
// The routes the strip used to carry, and where they went:
//   /dashboard/network            the old Summary. Dropped per the build plan;
//                                 the Dashboard is the single "what needs you"
//                                 surface. Still routable, not yet redesigned.
//   /dashboard/network/contacts   in the left nav
//   /dashboard/network/companies  in the left nav
//   /dashboard/network/profile    TEMPORARY entry in the left nav, until My
//                                 Profile absorbs the networking fields
//   /dashboard/network/templates  cut for phase one, route still reachable by
//                                 URL so nothing is destroyed

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { rememberOrigin } from "./backTarget"

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

  return <>{children}</>
}
