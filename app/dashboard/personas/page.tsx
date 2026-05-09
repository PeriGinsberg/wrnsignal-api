"use client"

// Standalone personas pages were superseded by the persona section on
// /dashboard (My Account) — that's where persona self-edit lives now.
// Redirecting here keeps the old URL working and avoids duplicating the
// editor surface. Coach-managed personas live at
// /dashboard/coach/clients/[id] (Profile & Personas tab).

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function PersonasPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/dashboard")
  }, [router])
  return null
}
