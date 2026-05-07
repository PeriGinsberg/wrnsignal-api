"use client"

// Personas self-service is hidden during the Cohort 1 pilot
// (decision 2026-05-07). Coaches manage personas on behalf of clients
// from the Profile & Personas tab on each client's coach view.
// Re-enable post-Cohort 1 if product decides to give clients direct
// persona control again — restore from git history.

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function PersonasPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/dashboard")
  }, [router])
  return null
}
