"use client"

// /dashboard/network/contacts — a REDIRECT to the merged page.
//
// The roster lives at /dashboard/network now. This route stays because 44 links
// across the dashboard, the nudges and the tracker still point here, and
// rewriting all of them is churn with a chance of missing one. It costs a hop
// on those legacy links and nothing on the nav, which points at the new URL.
//
// The [contactId] child route below it is UNAFFECTED: a contact record is still
// at /dashboard/network/contacts/<id>, exactly as before.

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"

function Redirect() {
  const router = useRouter()
  const sp = useSearchParams()
  useEffect(() => {
    // Filters ride along. Deep links like ?status=overdue come from the
    // dashboard and must survive the hop, or the link silently loses its point.
    const qs = sp.toString()
    router.replace(qs ? `/dashboard/network?${qs}` : "/dashboard/network")
  }, [router, sp])
  return null
}

export default function ContactsRedirect() {
  return (
    <Suspense fallback={null}>
      <Redirect />
    </Suspense>
  )
}
