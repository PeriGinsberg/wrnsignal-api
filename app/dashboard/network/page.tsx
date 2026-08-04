"use client"

// /dashboard/network — a REDIRECT to Contacts.
//
// This route used to be the networking Daily Worklist, and it was still the
// destination of the "Networking" nav item, so clicking Networking landed on an
// unconverted dark screen in the middle of a light app. That is the "old
// screen" a tester hits first, from the nav, on the way to everything else.
//
// The build plan drops the per-area Summary outright: the Dashboard is the
// single "what needs you" surface, and a second worklist answers the same
// question in different words. Contacts is the right landing because it is the
// area's actual workspace.
//
// The old component is kept at LegacyWorklist.tsx, unrouted. It is the only
// reader of GET /api/network/worklist, so deleting it would strand an endpoint
// before anyone has confirmed the Dashboard covers every case it did.

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function NetworkIndexRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/dashboard/network/contacts")
  }, [router])
  return null
}
