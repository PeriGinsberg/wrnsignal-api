"use client"

// /dashboard/coach/required-actions — a REDIRECT to /dashboard/coach/tasks.
//
// "Required Actions" became "Tasks" on 2026-09-25. This route stays because
// links to it exist in the nav history, in bookmarks and in sent email, and a
// dead URL is a worse answer than a hop.
//
// NOTHING WAS LOST IN THE MOVE. By the end, this page rendered a heading and
// <TaskList assignee="me" />, which is a strictly poorer version of the Tasks
// page: same rows, no filters, no search, no views. Its second section,
// Engagement Signals, was behind SHOW_ENGAGEMENT_SIGNALS = false here AND on
// the coach dashboard, so it rendered on neither surface and has not rendered
// for some time. Reviving it is a separate decision from renaming this one.

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"

function Redirect() {
  const router = useRouter()
  const sp = useSearchParams()
  useEffect(() => {
    // Query strings ride along, the same as the network/contacts hop, so a
    // deep link does not silently lose what it was pointing at.
    const qs = sp.toString()
    router.replace(qs ? `/dashboard/coach/tasks?${qs}` : "/dashboard/coach/tasks")
  }, [router, sp])
  return null
}

export default function RequiredActionsRedirect() {
  return (
    <Suspense fallback={null}>
      <Redirect />
    </Suspense>
  )
}
