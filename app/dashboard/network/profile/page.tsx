"use client"

// /dashboard/network/profile — kept as a REDIRECT, not deleted.
//
// The networking profile is now a section of My Profile (redesign step 8), so
// this route has no screen of its own. It stays because the URL is reachable
// from outside the nav: the send panel's "Fill your networking profile" prompt
// links here, and so does anything a student or coach bookmarked while it was
// a real page. Deleting it would 404 those.

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function NetworkProfileRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/dashboard/profile?section=networking")
  }, [router])
  return null
}
